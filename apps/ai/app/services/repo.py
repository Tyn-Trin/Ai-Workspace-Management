"""DB read/write helpers used by the internal REST + webhook + cron layers.

ไม่ผูกกับ Gmail API โดยตรง (นั่นอยู่ใน gmail_client/gmail_labels/gmail_watch/gmail_history) —
ไฟล์นี้มีแต่ query/insert/update กับตาราง gmail_tokens, emails, classifications

ทุกฟังก์ชันใช้ db.flush() ไม่ใช่ db.commit() — commit จริงเกิดครั้งเดียวที่ท้าย request ใน
app/db/session.py::get_db เพื่อให้ pg_advisory_xact_lock ของ webhook path (PLAN-V2.md §8.1)
ครอบคลุมทั้ง operation ไม่หลุดตั้งแต่ commit แรก
"""

import base64
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.classification import Classification
from app.models.email import Email
from app.models.gmail_token import GmailToken
from app.schemas.classification import EmailClassification
from app.services import token_crypto

# --- gmail_tokens ---


def get_gmail_token(db: Session, user_id: uuid.UUID) -> GmailToken | None:
    return db.get(GmailToken, user_id)


def find_user_id_by_gmail_address(db: Session, gmail_address: str) -> uuid.UUID | None:
    return db.execute(
        select(GmailToken.user_id).where(GmailToken.gmail_address == gmail_address)
    ).scalar_one_or_none()


def upsert_gmail_token(
    db: Session, user_id: uuid.UUID, refresh_token: str, gmail_address: str
) -> GmailToken:
    encrypted, key_id = token_crypto.encrypt(refresh_token)
    token_row = db.get(GmailToken, user_id)
    if token_row is None:
        token_row = GmailToken(user_id=user_id)
        db.add(token_row)

    token_row.encrypted_refresh_token = encrypted
    token_row.encryption_key_id = key_id
    token_row.gmail_address = gmail_address
    db.flush()
    return token_row


def delete_gmail_token(db: Session, user_id: uuid.UUID) -> None:
    token_row = db.get(GmailToken, user_id)
    if token_row is not None:
        db.delete(token_row)
        db.flush()


def update_sync_state(
    db: Session, user_id: uuid.UUID, *, history_id: int, error: str | None = None
) -> None:
    token_row = db.get(GmailToken, user_id)
    if token_row is None:
        return
    token_row.history_id = history_id
    token_row.last_synced_at = datetime.now(timezone.utc)
    token_row.sync_error = error
    db.flush()


# --- emails / classifications ---


def email_exists(db: Session, user_id: uuid.UUID, gmail_message_id: str) -> bool:
    return (
        db.execute(
            select(Email.id).where(
                Email.user_id == user_id, Email.gmail_message_id == gmail_message_id
            )
        ).scalar_one_or_none()
        is not None
    )


def create_email(
    db: Session,
    user_id: uuid.UUID,
    *,
    gmail_message_id: str,
    gmail_thread_id: str,
    sender: str,
    subject: str,
    snippet: str,
    received_at: datetime,
) -> Email:
    email = Email(
        user_id=user_id,
        gmail_message_id=gmail_message_id,
        gmail_thread_id=gmail_thread_id,
        sender=sender,
        subject=subject,
        snippet=snippet,
        received_at=received_at,
    )
    db.add(email)
    db.flush()
    return email


def create_classification(
    db: Session,
    email_id: uuid.UUID,
    user_id: uuid.UUID,
    classification: EmailClassification,
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    labeled: bool,
) -> Classification:
    row = Classification(
        email_id=email_id,
        user_id=user_id,
        category=classification.category,
        priority=classification.priority,
        reason=classification.reason,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        labeled_at=datetime.now(timezone.utc) if labeled else None,
    )
    db.add(row)
    db.flush()
    return row


def _encode_cursor(received_at: datetime, email_id: uuid.UUID) -> str:
    raw = f"{received_at.isoformat()}|{email_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    received_at_str, email_id_str = raw.split("|")
    return datetime.fromisoformat(received_at_str), uuid.UUID(email_id_str)


def list_emails(
    db: Session,
    user_id: uuid.UUID,
    *,
    category: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    received_after: datetime | None = None,
    received_before: datetime | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[tuple[Email, Classification | None]], str | None]:
    """คืน (rows, next_cursor) — next_cursor เป็น None แปลว่าไม่มีหน้าถัดไปแล้ว

    เรียง received_at DESC + id DESC (tie-break) ให้ cursor เสถียรแม้มีอีเมลเวลาเดียวกัน
    received_after/received_before เป็น datetime ขอบเขตที่ caller (api layer) แปลงมาให้แล้ว
    (เช่น "2026-07-01" → 00:00:00 UTC ของวันนั้น) ไม่ทำ date arithmetic ในนี้
    """
    stmt = (
        select(Email, Classification)
        .outerjoin(Classification, Classification.email_id == Email.id)
        .where(Email.user_id == user_id)
    )
    if status is not None:
        stmt = stmt.where(Email.status == status)
    if category is not None:
        stmt = stmt.where(Classification.category == category)
    if priority is not None:
        stmt = stmt.where(Classification.priority == priority)
    if received_after is not None:
        stmt = stmt.where(Email.received_at >= received_after)
    if received_before is not None:
        stmt = stmt.where(Email.received_at <= received_before)

    if cursor is not None:
        cursor_received_at, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Email.received_at < cursor_received_at,
                and_(Email.received_at == cursor_received_at, Email.id < cursor_id),
            )
        )

    stmt = stmt.order_by(Email.received_at.desc(), Email.id.desc()).limit(limit + 1)
    rows = list(db.execute(stmt).all())

    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = _encode_cursor(page[-1][0].received_at, page[-1][0].id) if has_more and page else None
    return page, next_cursor


def list_pending_emails(db: Session, user_id: uuid.UUID) -> list[Email]:
    return list(
        db.execute(
            select(Email).where(Email.user_id == user_id, Email.status == "pending")
        ).scalars()
    )


def get_stats(db: Session, user_id: uuid.UUID) -> dict:
    pending_counts = {"urgent": 0, "normal": 0, "low": 0}
    result = db.execute(
        select(Classification.priority)
        .join(Email, Email.id == Classification.email_id)
        .where(Email.user_id == user_id, Email.status == "pending")
    )
    for (priority,) in result:
        pending_counts[priority.lower()] += 1

    total_today = db.execute(
        select(Email.id).where(Email.user_id == user_id, Email.received_at >= _start_of_today())
    ).all()

    return {"pending": pending_counts, "totalToday": len(total_today)}


def _start_of_today() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def update_status(db: Session, user_id: uuid.UUID, email_id: uuid.UUID, status: str) -> bool:
    email = db.get(Email, email_id)
    if email is None or email.user_id != user_id:
        return False
    email.status = status
    db.flush()
    return True


def bulk_update_status(
    db: Session, user_id: uuid.UUID, email_ids: list[uuid.UUID], status: str
) -> int:
    return sum(update_status(db, user_id, email_id, status) for email_id in email_ids)
