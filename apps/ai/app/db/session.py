from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Commit-once-per-request: repo/service functions only flush(), นี่คือคนเดียวที่ commit

    สำคัญกับ webhook path ที่ต้องถือ pg_advisory_xact_lock ตลอดทั้ง request (PLAN-V2.md §8.1) —
    ถ้าแต่ละ repo function commit เอง lock จะหลุดตั้งแต่ commit แรก ไม่ครอบคลุมทั้ง operation
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
