"""/internal/cron/* — Railway cron ยิงเข้า NestJS (public, X-Cron-Secret) แล้ว NestJS forward
มาที่นี่ผ่าน private network (PLAN-V2.md §8.2) เหตุผลเดียวกับ webhook: ai service ปิดสนิท
"""

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, verify_internal_secret
from app.models.gmail_token import GmailToken
from app.services import gmail_client, gmail_watch, sync_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/cron",
    tags=["cron"],
    dependencies=[Depends(verify_internal_secret)],
)


@router.post("/renew-watch", status_code=status.HTTP_204_NO_CONTENT)
def renew_watch(db: Session = Depends(get_db)) -> None:
    gmail_watch.renew_all(db)


@router.post("/reconcile", status_code=status.HTTP_204_NO_CONTENT)
def reconcile(db: Session = Depends(get_db)) -> None:
    """เทียบ history_id ที่เก็บกับ Gmail จริง (ผ่าน sync_user) + reply-check ต่อ user

    commit ต่อ user ทันที เหมือน renew_all — user ที่ reconcile fail ไม่ควรทำให้ user อื่น
    ที่สำเร็จไปแล้วหลุดตามไปด้วย
    """
    user_ids = db.execute(select(GmailToken.user_id)).scalars().all()
    for user_id in user_ids:
        try:
            sync_pipeline.sync_user(db, user_id)
            gmail_service = gmail_client.get_service(db, user_id)
            sync_pipeline.check_replies(db, user_id, gmail_service)
            db.commit()
        except Exception:
            logger.exception("reconcile failed for user_id=%s", user_id)
            db.rollback()
