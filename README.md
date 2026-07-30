# Ai-Mail-priority

AI email triage สำหรับทีมเล็กใน Google Workspace — จัดหมวดหมู่ + ลำดับความสำคัญอีเมลอัตโนมัติด้วย Claude, ติด label บน Gmail จริง, แสดงผลสดบน dashboard ผ่าน WebSocket (ไม่มีปุ่ม sync)

3 service: `apps/frontend` (Next.js) → `apps/backend` (NestJS) → `apps/ai` (FastAPI + LangGraph) → Postgres

แผนทั้งหมดอยู่ที่ [`docs/PLAN-V2.md`](docs/PLAN-V2.md)

## Dev quickstart

```
docker compose -f docker-compose.dev.yml up -d   # Postgres

cd apps/ai       && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd apps/backend  && npm install && npm run start:dev   # port 3001
cd apps/frontend && npm install && npm run dev          # port 3000
```
