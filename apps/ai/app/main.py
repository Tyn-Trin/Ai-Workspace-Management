from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import cron, health, internal, webhook

app = FastAPI(title="Ai-Mail-priority — ai service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],  # ไม่มี browser เรียกตรง — เข้าถึงผ่าน NestJS internal REST เท่านั้น
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(internal.router)
app.include_router(webhook.router)
app.include_router(cron.router)
