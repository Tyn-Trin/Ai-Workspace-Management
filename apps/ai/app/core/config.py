from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env-driven config สำหรับ ai service — โหลดจาก .env"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- App ---
    ENV: str = "development"

    # --- DB ---
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5433/ai_mail_priority"

    # --- Internal service-to-service auth ---
    INTERNAL_SECRET: str = "change-me-in-env"

    # --- Claude ---
    ANTHROPIC_API_KEY: str | None = None
    CLAUDE_MODEL: str = "claude-haiku-4-5"

    # --- Google OAuth / Gmail ---
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GMAIL_SCOPES: str = "https://www.googleapis.com/auth/gmail.modify"
    GMAIL_PUBSUB_TOPIC: str | None = None

    # --- Token encryption ---
    TOKEN_ENCRYPTION_KEY: str = "change-me-32-byte-base64-key"

    # --- Backend callback (FastAPI -> NestJS) ---
    BACKEND_INTERNAL_URL: str = "http://localhost:3001"


settings = Settings()
