"""POST /internal/webhook/gmail — เรียกจาก NestJS หลัง forward payload จาก Pub/Sub (PLAN-V2.md §8.1)

ไม่ใช่ endpoint public — auth ด้วย X-Internal-Secret ผ่าน private network เท่านั้น
NestJS ตอบ 204 ให้ Pub/Sub ไปแล้วตอน forward มา ดังนั้น endpoint นี้ประมวลผลแบบ synchronous ได้
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, verify_internal_secret
from app.schemas.internal import WebhookPayload
from app.services import repo, sync_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal",
    tags=["webhook"],
    dependencies=[Depends(verify_internal_secret)],
)


@router.post("/webhook/gmail", status_code=204)
def receive_gmail_webhook(payload: WebhookPayload, db: Session = Depends(get_db)) -> None:
    user_id = repo.find_user_id_by_gmail_address(db, payload.emailAddress)
    if user_id is None:
        logger.warning("webhook: unknown gmail_address=%s", payload.emailAddress)
        return

    sync_pipeline.sync_user(db, user_id, latest_history_id=payload.historyId)
