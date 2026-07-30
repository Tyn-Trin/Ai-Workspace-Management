"""/internal/users/{user_id}/* — เรียกจาก NestJS ผ่าน private network เท่านั้น (PLAN-V2.md §6.2)"""

from datetime import date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, verify_internal_secret
from app.schemas.classification import EmailClassification
from app.schemas.internal import (
    BulkStatusIn,
    EmailOut,
    EmailsPage,
    GmailTokenIn,
    StatsOut,
    StatusUpdateIn,
)
from app.services import gmail_watch, repo

router = APIRouter(
    prefix="/internal/users/{user_id}",
    tags=["internal"],
    dependencies=[Depends(verify_internal_secret)],
)


@router.post("/gmail-token", status_code=status.HTTP_204_NO_CONTENT)
def store_gmail_token(user_id: UUID, body: GmailTokenIn, db: Session = Depends(get_db)) -> None:
    repo.upsert_gmail_token(db, user_id, body.refresh_token, body.gmail_address)
    gmail_watch.start_watch(db, user_id)


@router.delete("/gmail-token", status_code=status.HTTP_204_NO_CONTENT)
def remove_gmail_token(user_id: UUID, db: Session = Depends(get_db)) -> None:
    gmail_watch.stop_watch(db, user_id)
    repo.delete_gmail_token(db, user_id)


@router.get("/emails", response_model=EmailsPage)
def get_emails(
    user_id: UUID,
    category: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    received_after: date | None = Query(default=None, alias="receivedAfter"),
    received_before: date | None = Query(default=None, alias="receivedBefore"),
    limit: int = Query(default=50, le=200),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> EmailsPage:
    rows, next_cursor = repo.list_emails(
        db,
        user_id,
        category=category,
        priority=priority,
        status=status_,
        received_after=(
            datetime.combine(received_after, time.min, tzinfo=timezone.utc)
            if received_after
            else None
        ),
        received_before=(
            datetime.combine(received_before, time.max, tzinfo=timezone.utc)
            if received_before
            else None
        ),
        limit=limit,
        cursor=cursor,
    )
    items = [
        EmailOut(
            id=email.id,
            gmailMessageId=email.gmail_message_id,
            sender=email.sender,
            subject=email.subject,
            snippet=email.snippet,
            receivedAt=email.received_at,
            status=email.status,
            classification=(
                EmailClassification(
                    category=classification.category,
                    priority=classification.priority,
                    reason=classification.reason,
                )
                if classification is not None
                else None
            ),
        )
        for email, classification in rows
    ]
    return EmailsPage(items=items, nextCursor=next_cursor)


@router.get("/stats", response_model=StatsOut)
def get_stats(user_id: UUID, db: Session = Depends(get_db)) -> StatsOut:
    return StatsOut(**repo.get_stats(db, user_id))


@router.patch("/emails/{email_id}/status", status_code=status.HTTP_204_NO_CONTENT)
def update_email_status(
    user_id: UUID, email_id: UUID, body: StatusUpdateIn, db: Session = Depends(get_db)
) -> None:
    updated = repo.update_status(db, user_id, email_id, body.status)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="email not found")


@router.post("/emails/bulk-status", status_code=status.HTTP_204_NO_CONTENT)
def bulk_update_email_status(
    user_id: UUID, body: BulkStatusIn, db: Session = Depends(get_db)
) -> None:
    repo.bulk_update_status(db, user_id, body.ids, body.status)
