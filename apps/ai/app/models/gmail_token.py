import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, LargeBinary, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# หมายเหตุ ownership (PLAN-V2.md §2): ตาราง users เป็นของ NestJS/Prisma
# user_id ด้านล่างจึงไม่ใส่ FOREIGN KEY จริงไปที่ users.id — Alembic ฝั่งนี้ต้องรันได้เอง
# โดยไม่ต้องรอ Prisma migrate ตาราง users ก่อน (Phase 1 ทำก่อน Phase 2 ตามแผน)


class GmailToken(Base):
    __tablename__ = "gmail_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    encrypted_refresh_token: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encryption_key_id: Mapped[str] = mapped_column(Text, nullable=False)
    gmail_address: Mapped[str] = mapped_column(Text, nullable=False)
    history_id: Mapped[int | None] = mapped_column(BigInteger)
    watch_expiration: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("gmail_address", name="uq_gmail_tokens_gmail_address"),
        Index("ix_gmail_tokens_watch_expiration", "watch_expiration"),
    )
