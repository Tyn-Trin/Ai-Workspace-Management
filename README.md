# Ai-Mail-priority

ระบบ agent ที่จัดหมวดหมู่และจัดลำดับความสำคัญอีเมล Gmail ให้อัตโนมัติ แก้ปัญหาทีมเล็ก 5-20 คนใน Google Workspace org เดียวที่มีอีเมลเข้า 150-200 ฉบับ/วัน อ่าน/จัดลำดับเองไม่ทัน

ต่างจากเวอร์ชัน assessment ที่ต้องกดปุ่ม "Sync now" เอง — ระบบนี้ทำงานแบบ **push-based เต็มรูปแบบ**: Gmail แจ้งเตือนอัตโนมัติทันทีที่มีเมลเข้าผ่าน `users.watch()` + Cloud Pub/Sub ให้ Claude อ่าน subject + snippet + sender แล้วตัดสินใจ 2 อย่าง: **category** (fixed list: Customer / Internal / Vendor / Meeting / Spam) และ **priority** (Urgent / Normal / Low) พร้อมเหตุผลสั้นๆ จากนั้นติด label จริงบน Gmail (nested label เช่น `AI/Priority/Urgent`) แล้วดันผลขึ้น dashboard แบบเรียลไทม์ผ่าน WebSocket — เปิดหน้าจอค้างไว้แล้วเห็นเมลใหม่โผล่เองภายในไม่กี่วินาที ไม่ต้อง refresh

## Screenshot

<!-- แปะรูป dashboard ตรงนี้ -->

## Flow การทำงาน

ทำงานแบบ event-driven ทั้งเส้น ไม่มี background polling/cron ดึงเมลเอง (มีแค่ cron เสริมสำหรับ renew watch + reconcile กันหลุด ดู §8.2 ใน [`docs/PLAN-V2.md`](docs/PLAN-V2.md)):

### 1. Watch — Gmail แจ้งเตือนอัตโนมัติทันทีที่มีเมลเข้า

login ครั้งแรกจะเรียก `users.watch()` ผูก Gmail inbox ของ user กับ Cloud Pub/Sub topic ไว้ (`labelIds: ['INBOX']` กันเมล noise จาก draft/sent) พอมีเมลใหม่เข้า inbox จริง Google จะ push notification เข้า webhook ของเราเองภายในไม่กี่วินาที ไม่มีการ poll ถามซ้ำๆ เลย

### 2. Classify — จัดหมวดหมู่ + ระดับความสำคัญด้วย Claude

ส่ง subject + snippet + sender ให้ Claude (`claude-haiku-4-5` เรียกตรงผ่าน Anthropic SDK ด้วย `messages.parse()` structured output ไม่ผ่าน LangChain) เลือก category จาก fixed list, priority 3 ระดับ, และเหตุผลสั้นๆ กลับมาเป็น pydantic model ที่ validate แล้ว พร้อมเก็บ token usage ทุกแถวไว้เทียบต้นทุน

### 3. Label — ติด label จริงบน Gmail + บันทึกผลแยก user

ติด nested label บนอีเมลจริงใน Gmail (สร้าง label อัตโนมัติถ้ายังไม่มี, cache label id ต่อ user ไว้ในตารางแทน in-memory cache แบบเดิมที่พังตอนมีหลาย user พร้อมกัน) แล้วบันทึกผล classification ลง Postgres แยกตาม `user_id` ชัดเจน — คนละ Gmail account คนละชุดข้อมูล ไม่ปนกัน

### 4. Push — ดันขึ้น dashboard ทันทีผ่าน WebSocket

classify เสร็จปุ๊บ ai service แจ้ง backend ให้ push event เข้า WebSocket room ของ user นั้นทันที (`email:classified`, `stats:updated`) ฝั่ง dashboard ที่เปิดค้างไว้เห็นแถวใหม่โผล่เองไม่ต้อง refresh ส่วนอีเมลที่ webhook หลุดไปจริงๆ (Pub/Sub at-least-once แต่ก็ยังมีโอกาสพลาด) มี reconcile job ทุก 30 นาทีมาเทียบ `historyId` แล้วดึงย้อนให้

## Tech Stack

| ส่วน | ใช้ |
|---|---|
| Frontend | Next.js (App Router) |
| Backend (identity/session/WebSocket, BFF) | NestJS + Prisma |
| AI service (Gmail token + classify + label) | FastAPI + LangGraph |
| LLM | Claude (`claude-haiku-4-5` เรียกตรงผ่าน Anthropic SDK, structured output) |
| Email source | Gmail API + Cloud Pub/Sub push (`gmail.modify` scope เท่านั้น — อ่าน+ติด label ไม่มี delete/send) |
| Persistence | Postgres — 2 schema แยก owner ชัดเจน (Prisma migrate ฝั่ง backend, Alembic ฝั่ง ai) |
| Hosting | Railway (Postgres managed, private networking ระหว่าง service) |

สถาปัตยกรรมเต็ม + data model + API contract + failure mode ดูที่ [`docs/PLAN-V2.md`](docs/PLAN-V2.md)

## วิธีใช้งาน

### เตรียมก่อนรัน (ทำครั้งเดียว)

1. สร้าง Google Cloud project → เปิดใช้ **Gmail API** + **Cloud Pub/Sub API** → สร้าง OAuth client ประเภท **Web application** → สร้าง Pub/Sub topic + push subscription ชี้ webhook ของ backend (ทำผ่าน Google Cloud Console เท่านั้น รายละเอียดครบทุกขั้นตอนอยู่ที่ §12 ใน `docs/PLAN-V2.md`)
2. คัดลอก `.env.example` เป็น `.env` ทั้ง 3 service (`apps/frontend`, `apps/backend`, `apps/ai`) แล้วใส่ค่าจริง (`GOOGLE_CLIENT_ID/SECRET`, `ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY` ฯลฯ)

### รัน dev

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres

cd apps/ai       && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd apps/backend  && npm install && npm run start:dev   # port 3001
cd apps/frontend && npm install && npm run dev          # port 3000
```

เปิด `http://localhost:3000` กด "Sign in with Google" ครั้งแรกเพื่อเชื่อมต่อ Gmail (ต้องมี Pub/Sub push subscription ชี้มาถึงเครื่องจริงแล้ว — dev ใช้ `ngrok http 3001` แทน `localhost` เพราะ Pub/Sub ต้องการ public HTTPS) จากนั้นส่งเมลเข้า inbox แล้วรอดูแถวใหม่ขึ้น dashboard เองภายในไม่กี่วินาที
