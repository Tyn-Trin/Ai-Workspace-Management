import hmac

from fastapi import Header, HTTPException, status

from app.core.config import settings
from app.db.session import get_db  # noqa: F401 — re-exported for `api/*.py` routers

__all__ = ["get_db", "verify_internal_secret"]


def verify_internal_secret(x_internal_secret: str = Header(...)) -> None:
    if not hmac.compare_digest(x_internal_secret, settings.INTERNAL_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid internal secret"
        )
