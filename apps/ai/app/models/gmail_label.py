import uuid

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class GmailLabel(Base):
    """cache label id ต่อ user (แทน lru_cache global ที่พังใน multi-tenant)"""

    __tablename__ = "gmail_labels"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    label_name: Mapped[str] = mapped_column(Text, primary_key=True)
    label_id: Mapped[str] = mapped_column(Text, nullable=False)
