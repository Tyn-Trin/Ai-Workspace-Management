"""history.list + fallback ตอน historyId เก่าเกิน (PLAN-V2.md §8.1)

Gmail เก็บ history ไว้แค่ ~1 สัปดาห์ — ถ้า startHistoryId เก่ากว่านั้น history.list
คืน 404/410 ต้อง fallback ไป messages.list แบบจำกัดจำนวนแทน
"""

from googleapiclient.discovery import Resource
from googleapiclient.errors import HttpError

MAX_EMAILS_PER_BATCH = 50


def list_new_message_ids(gmail_service: Resource, start_history_id: int | None) -> list[str]:
    if start_history_id is None:
        return _fallback_recent_unread(gmail_service)

    message_ids: list[str] = []
    page_token = None
    try:
        while True:
            response = (
                gmail_service.users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    historyTypes=["messageAdded"],
                    pageToken=page_token,
                )
                .execute()
            )

            for record in response.get("history", []):
                for added in record.get("messagesAdded", []):
                    message_ids.append(added["message"]["id"])

            page_token = response.get("nextPageToken")
            if not page_token or len(message_ids) >= MAX_EMAILS_PER_BATCH:
                break
    except HttpError as exc:
        if exc.resp.status in (404, 410):
            return _fallback_recent_unread(gmail_service)
        raise

    return message_ids[:MAX_EMAILS_PER_BATCH]


def _fallback_recent_unread(gmail_service: Resource) -> list[str]:
    response = (
        gmail_service.users()
        .messages()
        .list(userId="me", q="is:unread newer_than:1d", maxResults=MAX_EMAILS_PER_BATCH)
        .execute()
    )
    return [m["id"] for m in response.get("messages", [])]
