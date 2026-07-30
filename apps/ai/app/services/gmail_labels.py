"""Get-or-create Gmail label ต่อ user (แทน lru_cache global ที่พังใน multi-tenant, PLAN-V2.md §3.2)

Gmail รองรับ nested label ผ่านชื่อที่มี "/" (เช่น "AI/Priority/Urgent") โดยไม่ต้องสร้าง
label แม่ก่อน — Gmail จัดกลุ่มให้เองจากชื่อ จึง create ตรงๆ ได้เลย
"""

import uuid

from googleapiclient.discovery import Resource
from sqlalchemy.orm import Session

from app.models.gmail_label import GmailLabel


def get_or_create_label_id(
    db: Session, user_id: uuid.UUID, gmail_service: Resource, label_name: str
) -> str:
    cached = db.get(GmailLabel, {"user_id": user_id, "label_name": label_name})
    if cached is not None:
        return cached.label_id

    label_id = _find_or_create_on_gmail(gmail_service, label_name)

    db.merge(GmailLabel(user_id=user_id, label_name=label_name, label_id=label_id))
    db.commit()
    return label_id


def _find_or_create_on_gmail(gmail_service: Resource, label_name: str) -> str:
    existing = gmail_service.users().labels().list(userId="me").execute().get("labels", [])
    for label in existing:
        if label["name"] == label_name:
            return label["id"]

    created = (
        gmail_service.users()
        .labels()
        .create(
            userId="me",
            body={
                "name": label_name,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        )
        .execute()
    )
    return created["id"]
