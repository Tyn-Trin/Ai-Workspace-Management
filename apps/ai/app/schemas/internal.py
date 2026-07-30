from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.core.taxonomy import STATUSES
from app.schemas.classification import EmailClassification

Status = Literal[*STATUSES]


class GmailTokenIn(BaseModel):
    refresh_token: str
    gmail_address: str


class WebhookPayload(BaseModel):
    emailAddress: str
    historyId: int


class EmailOut(BaseModel):
    id: UUID
    gmailMessageId: str
    sender: str
    subject: str
    snippet: str
    receivedAt: datetime
    status: Status
    classification: EmailClassification | None = None


class EmailsPage(BaseModel):
    items: list[EmailOut]
    nextCursor: str | None = None


class StatsOut(BaseModel):
    pending: dict[str, int]
    totalToday: int


class StatusUpdateIn(BaseModel):
    status: Status


class BulkStatusIn(BaseModel):
    ids: list[UUID]
    status: Status
