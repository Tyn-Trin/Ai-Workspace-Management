"""Per-user Gmail API access (PLAN-V2.md §3.2).

ห้ามใส่ module-level cache (lru_cache ฯลฯ) ที่นี่ — เวอร์ชัน assessment เดิมแคช
Gmail service ไว้ตัวเดียวระดับ module แล้วคืนของ user คนแรกให้ทุกคนใน multi-tenant
ฟังก์ชันด้านล่างจึงสร้าง Credentials/service ใหม่ทุกครั้งที่เรียก โดยรับ user_id เข้ามาเสมอ
"""

import uuid
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import Resource, build
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.gmail_token import GmailToken
from app.services import token_crypto

METADATA_HEADERS = ["From", "Subject", "Date"]


def _load_credentials(db: Session, user_id: uuid.UUID) -> Credentials:
    token_row = db.get(GmailToken, user_id)
    if token_row is None:
        raise LookupError(f"no gmail_tokens row for user_id={user_id}")

    refresh_token = token_crypto.decrypt(
        token_row.encrypted_refresh_token, token_row.encryption_key_id
    )

    return Credentials(
        token=None,  # ไม่มี access token สด — ให้ไลบรารี refresh จาก refresh_token เอง
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=[settings.GMAIL_SCOPES],
    )


def get_service(db: Session, user_id: uuid.UUID) -> Resource:
    credentials = _load_credentials(db, user_id)
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def get_message_metadata(gmail_service: Resource, message_id: str) -> dict[str, Any]:
    """ดึง header (From/Subject/Date) + snippet + threadId — ไม่ดึง body เต็ม (PLAN-V2.md §14.3)"""
    return (
        gmail_service.users()
        .messages()
        .get(userId="me", id=message_id, format="metadata", metadataHeaders=METADATA_HEADERS)
        .execute()
    )


def extract_header(message: dict[str, Any], name: str) -> str:
    headers = message.get("payload", {}).get("headers", [])
    for header in headers:
        if header["name"].lower() == name.lower():
            return header["value"]
    return ""
