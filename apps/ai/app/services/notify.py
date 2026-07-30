"""F→N: แจ้ง NestJS ให้ push WebSocket หลัง classify เสร็จ (PLAN-V2.md §6.2, §8.1)"""

import logging
import uuid

import httpx

from app.core.config import settings
from app.schemas.classification import EmailClassification

logger = logging.getLogger(__name__)


def notify_classified(user_id: uuid.UUID, email: dict, classification: EmailClassification) -> None:
    try:
        httpx.post(
            f"{settings.BACKEND_INTERNAL_URL}/internal/notify",
            json={
                "userId": str(user_id),
                "email": email,
                "classification": classification.model_dump(),
            },
            headers={"X-Internal-Secret": settings.INTERNAL_SECRET},
            timeout=5.0,
        )
    except httpx.HTTPError:
        # NestJS แจ้งไม่ได้ไม่ควรทำให้ webhook pipeline ทั้งเส้น fail — แค่พลาด WS push รอบนี้
        logger.warning("notify_classified: failed to reach backend for user_id=%s", user_id)
