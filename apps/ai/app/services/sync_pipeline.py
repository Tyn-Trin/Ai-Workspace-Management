"""แกนกลาง fetch → classify → label → persist ที่ webhook path และ reconcile cron ใช้ร่วมกัน
(PLAN-V2.md §8.1, §8.2)
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import gmail_client, gmail_history, notify, repo
from app.services.classifier_graph import get_compiled_graph

logger = logging.getLogger(__name__)


def _parse_received_at(message: dict) -> datetime:
    return datetime.fromtimestamp(int(message["internalDate"]) / 1000, tz=timezone.utc)


def sync_user(db: Session, user_id: uuid.UUID, *, latest_history_id: int | None = None) -> None:
    """ดึง+classify+label อีเมลใหม่ของ user เดียว แล้วอัปเดต watermark (history_id)

    latest_history_id: ถ้ามาจาก webhook payload ให้ส่งมาตรงๆ (ค่าจาก Gmail push ตอนนั้น)
    ถ้าไม่ส่งมา (เรียกจาก reconcile) จะ query users.getProfile() เพื่อเอาค่าปัจจุบันแทน

    ถือ pg_advisory_xact_lock ต่อ user ตลอดฟังก์ชันนี้ — กันประมวลผลซ้อนกับ webhook/reconcile
    อื่นของ user เดียวกัน (release ตอน transaction ของผู้เรียก commit)
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": str(user_id)})

    token_row = repo.get_gmail_token(db, user_id)
    if token_row is None:
        return

    gmail_service = gmail_client.get_service(db, user_id)

    candidate_ids = gmail_history.list_new_message_ids(gmail_service, token_row.history_id)
    new_message_ids = [mid for mid in candidate_ids if not repo.email_exists(db, user_id, mid)]

    if new_message_ids:
        fetched = []
        for message_id in new_message_ids:
            message = gmail_client.get_message_metadata(gmail_service, message_id)
            fetched.append(
                {
                    "gmail_message_id": message_id,
                    "gmail_thread_id": message["threadId"],
                    "sender": gmail_client.extract_header(message, "From"),
                    "subject": gmail_client.extract_header(message, "Subject"),
                    "snippet": message.get("snippet", ""),
                    "received_at": _parse_received_at(message),
                }
            )

        graph = get_compiled_graph()
        state = graph.invoke(
            {
                "user_id": user_id,
                "db": db,
                "gmail_service": gmail_service,
                "emails": [
                    {k: v for k, v in e.items() if k != "received_at"} for e in fetched
                ],
                "results": [],
            }
        )

        received_at_by_message_id = {e["gmail_message_id"]: e["received_at"] for e in fetched}

        for result in state["results"]:
            email_data = result["email"]
            email_row = repo.create_email(
                db,
                user_id,
                gmail_message_id=email_data["gmail_message_id"],
                gmail_thread_id=email_data["gmail_thread_id"],
                sender=email_data["sender"],
                subject=email_data["subject"],
                snippet=email_data["snippet"],
                received_at=received_at_by_message_id[email_data["gmail_message_id"]],
            )
            repo.create_classification(
                db,
                email_row.id,
                user_id,
                result["classification"],
                model=settings.CLAUDE_MODEL,
                input_tokens=result["input_tokens"],
                output_tokens=result["output_tokens"],
                labeled=bool(result["label_ids"]),
            )
            notify.notify_classified(user_id, email_data, result["classification"])

    if latest_history_id is None:
        profile = gmail_service.users().getProfile(userId="me").execute()
        latest_history_id = int(profile["historyId"])

    repo.update_sync_state(db, user_id, history_id=latest_history_id)


def check_replies(db: Session, user_id: uuid.UUID, gmail_service) -> None:
    """reply-check (PLAN-V2.md §8.2): pending email ไหนมี SENT โผล่ใน thread แล้ว → mark replied"""
    for email in repo.list_pending_emails(db, user_id):
        thread = (
            gmail_service.users()
            .threads()
            .get(userId="me", id=email.gmail_thread_id, format="metadata")
            .execute()
        )
        has_sent = any(
            "SENT" in message.get("labelIds", []) for message in thread.get("messages", [])
        )
        if has_sent:
            repo.update_status(db, user_id, email.id, "replied")
