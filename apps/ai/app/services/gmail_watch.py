"""users.watch() lifecycle (PLAN-V2.md §7, §8.2).

watch() หมดอายุใน 7 วันแล้วเงียบไปเลยไม่มี error — ต้องมี cron renew ทุกวัน (renew_all)
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.gmail_token import GmailToken
from app.services import gmail_client


def start_watch(db: Session, user_id: uuid.UUID) -> None:
    service = gmail_client.get_service(db, user_id)
    response = (
        service.users()
        .watch(
            userId="me",
            body={
                "topicName": settings.GMAIL_PUBSUB_TOPIC,
                "labelIds": ["INBOX"],
                "labelFilterBehavior": "INCLUDE",
            },
        )
        .execute()
    )

    token_row = db.get(GmailToken, user_id)
    token_row.history_id = int(response["historyId"])
    token_row.watch_expiration = datetime.fromtimestamp(
        int(response["expiration"]) / 1000, tz=timezone.utc
    )
    token_row.sync_error = None
    db.flush()


def stop_watch(db: Session, user_id: uuid.UUID) -> None:
    service = gmail_client.get_service(db, user_id)
    service.users().stop(userId="me").execute()


def renew_all(db: Session) -> None:
    """cron `/internal/cron/renew-watch` เรียกทุกวัน 03:00 — วน user ทุกคนที่มี gmail_tokens

    TODO(Phase 2): กรองเฉพาะ user ที่ `is_active` ใน users table (Prisma-owned) เมื่อ
    Phase 2 สร้างตารางนั้นแล้ว — ตอนนี้ Phase 1 ยืนได้เองก่อน จึง renew ทุกแถวใน gmail_tokens

    commit() ต่อ user ทันที (ไม่รอ commit เดียวท้าย request แบบ endpoint อื่น) เพื่อให้ user
    ที่ renew สำเร็จแล้วไม่หลุดกลับไปทั้งหมด ถ้า user คนถัดไปในลูป fail
    """
    user_ids = db.execute(select(GmailToken.user_id)).scalars().all()
    for user_id in user_ids:
        try:
            start_watch(db, user_id)
            db.commit()
        except Exception as exc:  # noqa: BLE001 — isolate error ต่อ user ไม่ให้ทั้ง cron ล้ม
            db.rollback()
            token_row = db.get(GmailToken, user_id)
            if token_row is not None:
                token_row.sync_error = str(exc)
                db.commit()
