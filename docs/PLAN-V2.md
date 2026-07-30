# PLAN-V2.md — Ai-Mail-priority (Implementation Plan)

> เอกสารนี้เขียนใหม่ทั้งฉบับจาก `PLAN.md`
> `PLAN.md` เดิม = **บันทึกการตัดสินใจ** (ทำไมเลือก stack นี้ ทำไมแยก service แบบนี้) — เก็บไว้อ่านประกอบ ไม่ต้องแก้
> `PLAN-V2.md` (ไฟล์นี้) = **แผนลงมือทำ** — schema จริง, API contract จริง, failure mode, ลำดับงานพร้อมเกณฑ์ปิดงานแต่ละเฟส
> ตรงไหนที่ตัดสินใจต่างจาก `PLAN.md` จะมีหัวข้อ **"เปลี่ยนจาก PLAN.md"** กำกับไว้ชัดเจน

---

## 0. สรุป 10 บรรทัด

- ระบบ triage อีเมลด้วย AI สำหรับทีมเล็ก 5-20 คนใน Google Workspace org เดียว
- login ด้วย Google จริง แยกบัญชีต่อ user, ไม่มีปุ่ม "Sync now" — อีเมลเข้า inbox แล้วขึ้นบน dashboard เองภายในไม่กี่วินาที
- 3 service: Next.js (UI) → NestJS (Backend: identity/session/WebSocket) → FastAPI (Gmail token + LangGraph + Claude) → Postgres
- Model: `claude-haiku-4-5` ($1 / $5 ต่อ MTok) ผ่าน structured output — ต้นทุนประมาณ **$0.001 ต่ออีเมล**
- Real-time ขาเข้า: Gmail `users.watch()` → Cloud Pub/Sub → webhook; ขาออก: WebSocket
- ของที่พลาดง่ายและต้องทำตั้งแต่แรก: renew `watch()` รายวัน, reconcile job, idempotency, per-user lock, token encryption
- โค้ดเวอร์ชัน assessment ยกมาได้จริงแค่ **prompt + แนวคิด label** — ส่วน client ต้อง rewrite เพราะเป็น global singleton ทั้งหมด (ดู §3)
- แผน 5 เฟส เฟสละมีเกณฑ์ปิดงานที่วัดได้
- ทุกอย่างที่ต้องตั้งค่ามือใน Google Cloud Console อยู่รวมกันใน §12
- ข้อที่ยังไม่ตัดสินใจ + ความเสี่ยง อยู่ท้ายไฟล์ §14

---

## 1. ขอบเขต (คงเดิมจาก PLAN.md)

| หัวข้อ | ค่า |
|---|---|
| ผู้ใช้เป้าหมาย | 5-20 คน, Google Workspace org เดียวกัน |
| OAuth consent screen | **Internal** user type → ข้าม Google verification / CASA assessment ได้ แม้ `gmail.modify` เป็น sensitive scope |
| Scope | `openid email profile` + `https://www.googleapis.com/auth/gmail.modify` |
| Hosting | Railway (Postgres managed, cron trigger, private networking) |
| ปริมาณ | ~150-200 อีเมล/วัน/ทีม (ออกแบบให้รองรับ ~200/วัน/user) |

**ข้อจำกัดที่ต้องรู้ล่วงหน้า:** Internal user type ผูกกับ Workspace org — ถ้าวันหนึ่งต้องเปิดให้ org อื่นใช้ ต้องกลับมาทำ verification + CASA ใหม่ ซึ่งใช้เวลาเป็นสัปดาห์ อย่าเพิ่งสัญญากับใครว่า "เปิด public ได้เลย"

**เปลี่ยนจาก PLAN.md (dev ตอนนี้):** บัญชีที่ใช้พัฒนาเป็น personal `@gmail.com` ไม่มี Workspace org ผูกอยู่ — GCP project แบบนี้จะไม่มีตัวเลือก "Internal" ให้เลือกเลย (ตัวเลือกจะขึ้นเฉพาะ project ที่อยู่ใต้ Workspace org เท่านั้น) ช่วง dev จึงต้องใช้ **External + Testing mode** แทน (เพิ่มบัญชีตัวเองเป็น test user ได้สูงสุด 100 คน ไม่ต้อง verify) พอจะ deploy จริงให้ทีมที่มี Workspace org ใช้งาน ค่อยย้ายมาเป็น Internal ตามแผนเดิม

---

## 2. สถาปัตยกรรม

```
                    ┌──────────────────────────────┐
                    │ Next.js (frontend)           │
                    │ - หน้า login, หน้า dashboard   │
                    │ - รู้จักแค่ NestJS             │
                    └───────┬──────────────────────┘
                     REST + │ WebSocket  (cookie session)
                            ▼
                    ┌──────────────────────────────┐
   Google OAuth ───▶│ NestJS + Prisma (Backend)    │◀─── Pub/Sub push (public HTTPS)
                    │ owns: users, sessions        │
                    │ - Google OAuth + session     │
                    │ - Auth Guard ทุก route        │
                    │ - WebSocket Gateway          │
                    │ - รับ webhook แล้ว forward     │
                    └───────┬──────────────────────┘
                    internal│REST (Railway private network + shared secret)
                            ▼
                    ┌──────────────────────────────┐
   Gmail API ◀─────▶│ FastAPI + LangGraph (Python) │
   Claude API ◀────▶│ owns: gmail_tokens, emails,  │
                    │       classifications        │
                    │ - เจ้าของ Gmail token 100%    │
                    │ - fetch → classify → label   │
                    │ - cron: renew watch,         │
                    │         reconcile            │
                    └───────┬──────────────────────┘
                            ▼
                    ┌──────────────────────────────┐
                    │ Postgres (Railway managed)   │
                    │ 2 schema แยก owner ชัดเจน     │
                    └──────────────────────────────┘
```

### กติกาความเป็นเจ้าของ (บังคับ ห้ามข้าม)

| ของ | เจ้าของ | คนอื่นเข้าถึงยังไง |
|---|---|---|
| Gmail OAuth token | FastAPI เท่านั้น | ไม่มี — NestJS ส่งให้ครั้งเดียวตอน login แล้วลืมทิ้ง |
| การเรียก Gmail API | FastAPI เท่านั้น | ไม่มี |
| การเรียก Claude API | FastAPI เท่านั้น | ไม่มี |
| identity / session / cookie | NestJS เท่านั้น | FastAPI ได้แค่ `user_id` (uuid) ที่ NestJS ส่งมา |
| การ push ไป browser | NestJS เท่านั้น | FastAPI เรียก internal endpoint ของ NestJS |
| ตาราง `users`, `sessions` | NestJS (Prisma migrate) | FastAPI ห้าม write, อ่านได้เฉพาะ FK |
| ตาราง `gmail_tokens`, `emails`, `classifications` | FastAPI (Alembic migrate) | NestJS ห้ามแตะตรง — ต้องผ่าน internal REST |

> เหตุผลที่เขียนกติกานี้ให้ชัด: ระบบ 2 ภาษาที่แชร์ DB เดียวกันจะพังตรงที่ "ใครเป็นคน migrate ตารางนี้" ก่อนเสมอ — ตัดปัญหาด้วยการแบ่ง schema ownership ตั้งแต่วันแรก แล้วให้ migration tool คนละตัวคุมคนละชุดตาราง

---

## 3. เปลี่ยนจาก PLAN.md — 4 เรื่องที่ต้องรู้

### 3.1 Webhook เข้าที่ NestJS ไม่ใช่ FastAPI (แก้ข้อขัดแย้งใน PLAN.md)

`PLAN.md` เขียนไว้ 2 ที่ที่ขัดกันเอง:
- บรรทัด "FastAPI (ai-service, private network **ไม่เปิด public**)"
- บรรทัด "สร้าง Push subscription ชี้ไปที่ **FastAPI webhook URL**"

Pub/Sub push ต้องยิงเข้า public HTTPS — ถ้า FastAPI private อยู่ก็รับไม่ได้ เลือกทางแก้:

| ทางเลือก | ผล |
|---|---|
| เปิด FastAPI ให้ public เฉพาะ `/webhook/gmail` | ทำได้ แต่ FastAPI ที่ถือ Gmail token กลายเป็น public-facing — เสียหลักการที่วางไว้ |
| **Pub/Sub → NestJS `/webhook/gmail` (public) → forward เข้า FastAPI ทาง private** ✅ | FastAPI ยัง private 100%, NestJS เป็น web-facing layer เดียวตามที่ออกแบบไว้ตั้งแต่ต้น |

**เลือกข้อ 2** — สอดคล้องกับ BFF pattern ที่ตั้งใจไว้อยู่แล้ว ต้นทุนคือ hop เพิ่ม 1 ครั้ง (~5ms ใน private network) แลกกับการที่ service ที่ถือ credential ไม่เคยรับ traffic จากภายนอกเลย

NestJS ทำแค่ 3 อย่างในเส้นทางนี้: verify OIDC token → decode base64 payload → `POST` ต่อเข้า FastAPI พร้อม internal secret แล้วตอบ `204` ทันที (ไม่รอ classify เสร็จ)

### 3.2 โค้ดเวอร์ชัน assessment ยกมาตรงๆ ไม่ได้เท่าที่ PLAN.md บอก

`PLAN.md` เขียนว่า "ย้าย logic จาก `services/{gmail_client,classifier,agents}.py` มาเป็นจุดเริ่ม" — จริงบางส่วน แต่มี 3 จุดที่เป็น **global singleton** ซึ่งใน multi-tenant จะให้ผลผิดแบบเงียบๆ (ไม่ error แต่ข้อมูลข้าม user):

| ไฟล์เดิม | ปัญหาใน multi-tenant |
|---|---|
| `gmail_client._get_service()` — `@lru_cache(maxsize=1)` | คืน Gmail service ของ user คนแรกที่เรียกให้ทุกคน |
| `gmail_client._get_or_create_label()` — `@lru_cache` key = ชื่อ label | label ID ของ user A ถูกเอาไปใช้กับ user B → `modify` fail หรือติด label ผิดกล่อง |
| `store.py` ทั้งไฟล์ | SQLite + ไม่มี `user_id` เลย |

**สรุปของที่ยกมาได้จริง:**

| ยกมาได้ | ต้องเขียนใหม่ |
|---|---|
| `_SYSTEM_PROMPT` ใน `classifier.py` (ปรับคำว่า "ธนาคาร SCB" ออก) | `gmail_client.py` ทั้งไฟล์ (per-user credential) |
| `EmailClassification` schema (category/priority/reason) | `store.py` ทั้งไฟล์ (Postgres + user_id) |
| แนวคิด nested label `AI/Priority/*`, `AI/Category/*` | `agents.py` (state ต้องมี user_id, ตัด fetch_node ออก) |
| แนวคิด `MAX_EMAILS_PER_SYNC` | — |
| `_extract_header()` | — |

### 3.3 `fetch_node` หายไปจาก graph

เวอร์ชันเดิม graph คือ `fetch → classify → label → reply_check` โดย `fetch` ไปดึง Gmail เอง
เวอร์ชันใหม่ webhook เป็นคนบอกว่ามีอีเมลอะไรใหม่ → graph รับ list อีเมลเข้ามาเลย เหลือ **`classify → label`** 2 node
ส่วน `reply_check` ไม่ได้หายไปไหน — ย้ายไปอยู่ใน reconcile job (§8.2) เพราะเป็นงาน batch ตามเวลา ไม่ใช่งาน event-driven

### 3.4 Prompt caching ใช้ไม่ได้กับงานนี้ — อย่าเสียเวลาทำ

ตัวเลือกที่ดูน่าทำแต่ทำไม่ได้: cache system prompt ของ classifier
เหตุผล: **Haiku 4.5 มี minimum cacheable prefix ที่ 4096 tokens** ส่วน system prompt ของเราประมาณ 300 tokens → ต่ำกว่าเพดานมาก จะไม่ cache เลย (ไม่ error, แค่ `cache_creation_input_tokens: 0` เงียบๆ)

ทางลดต้นทุนที่ใช้ได้จริงแทน:
- **classify หลายฉบับต่อ 1 request** (5-10 ฉบับ/call) — ลดจำนวน request และ amortize system prompt
- **Message Batches API** (ถูกลง 50%) สำหรับ backfill/reconcile ที่ไม่ต้อง real-time — ไม่ใช้กับ webhook path

---

## 4. โครงสร้าง repo

**เปลี่ยนจาก PLAN.md (v2 ของหัวข้อนี้):** แต่ละ service ใช้ convention มาตรฐานของ framework ตัวเอง
แทนที่จะจัดกลุ่มไฟล์ตาม domain ทั้งหมดแบบ draft แรก — เหตุผลคือคนที่เปิด repo นี้ครั้งแรกและคุ้นเคย
กับ FastAPI/NestJS/Next.js อยู่แล้วจะหาไฟล์เจอทันทีโดยไม่ต้องเรียนรู้ convention เฉพาะของ repo นี้

```
Ai-Mail-priority/
├─ apps/
│  ├─ frontend/                 # Next.js (App Router) — แยกตาม technical layer
│  │  ├─ app/(auth)/login/page.tsx
│  │  ├─ app/dashboard/page.tsx
│  │  ├─ app/layout.tsx
│  │  ├─ components/            # UI + feature components
│  │  ├─ lib/{api-client,ws-client}.ts
│  │  ├─ types/                 # shared TS types (Email, Classification, ...)
│  │  └─ hooks/                 # useEmails, useWebSocket, ...
│  ├─ backend/                  # NestJS — module ต่อ feature (convention มาตรฐานของ Nest)
│  │  ├─ src/auth/               {auth.controller,auth.service,auth.module}.ts, guards/, dto/
│  │  ├─ src/emails/             {emails.controller,emails.service,emails.module}.ts, dto/
│  │  ├─ src/realtime/           realtime.gateway.ts, realtime.module.ts
│  │  ├─ src/webhook/            รับ Pub/Sub push
│  │  ├─ src/internal/           endpoint ที่ FastAPI เรียกกลับ
│  │  └─ src/prisma/             prisma.service.ts, prisma.module.ts
│  │     prisma/schema.prisma
│  └─ ai/                       # FastAPI — แยกตาม technical layer (models/schemas/services/api)
│     ├─ app/core/config.py
│     ├─ app/db/{base,session}.py
│     ├─ app/models/            SQLAlchemy ORM: gmail_token, email, classification, gmail_label
│     ├─ app/schemas/           Pydantic: classification (structured output), internal (request/response)
│     ├─ app/services/          business logic: token_crypto, gmail_client, gmail_labels,
│     │                         gmail_watch, gmail_history, classifier_graph (LangGraph)
│     ├─ app/api/               routers: health, internal, webhook, cron
│     └─ alembic/
├─ docs/
│  ├─ PLAN.md                   # บันทึกการตัดสินใจ (เดิม)
│  └─ PLAN-V2.md                # ไฟล์นี้
├─ docker-compose.dev.yml       # postgres สำหรับ dev
└─ README.md
```

---

## 5. Data model

### 5.1 ตารางของ NestJS (Prisma)

```prisma
model User {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique
  displayName  String?
  avatarUrl    String?
  createdAt    DateTime  @default(now())
  lastLoginAt  DateTime?
  isActive     Boolean   @default(true)   // false = ถูก revoke/ออกจากทีม → cron ข้าม
  sessions     Session[]
}

model Session {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @db.Uuid
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String   @unique          // เก็บ hash ไม่เก็บ token ดิบ
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  userAgent    String?
  ipAddress    String?

  @@index([userId])
  @@index([expiresAt])
}
```

**หมายเหตุ migration workflow (เจอจริงตอน Phase 2):** `prisma migrate dev` ทำ full drift-detection กับทั้ง schema เสมอ (แม้ใช้ `--create-only`) พอเจอตาราง `gmail_tokens`/`emails`/`classifications`/`gmail_labels` ที่ Alembic สร้างไว้ (Prisma ไม่รู้จัก) มันจะเสนอ **reset ทั้ง schema ทันที** — ห้ามกด yes เด็ดขาดเพราะจะลบตารางฝั่ง ai service ทิ้งหมด

วิธีที่ปลอดภัยสำหรับ shared-DB นี้ (ใช้ทุกครั้งที่เพิ่ม Prisma migration ใหม่):
1. `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (สร้าง SQL โดยไม่แตะ DB จริง)
2. `npx prisma db execute --file prisma/migrations/<timestamp>_<name>/migration.sql --schema prisma/schema.prisma` (รัน SQL ตรงๆ)
3. `npx prisma migrate resolve --applied <timestamp>_<name>` (บันทึกใน `_prisma_migrations` ว่า apply แล้ว โดยไม่รันซ้ำ)

ห้ามใช้ `prisma migrate dev` กับ DB นี้อีกเลยตลอดโปรเจกต์ — ใช้ 3 ขั้นตอนข้างบนแทนเสมอ

**เวอร์ชัน Prisma:** ใช้ `prisma`/`@prisma/client` **v6.x** ไม่ใช่ v7 ล่าสุด — Prisma 7 บังคับใช้ driver adapter (`prisma.config.ts` + `@prisma/adapter-pg`) แทน `datasource { url = env(...) }` แบบเดิม เพิ่ม complexity โดยไม่ได้ประโยชน์อะไรกับโปรเจกต์ขนาดนี้ เลย pin ไว้ที่ v6

### 5.2 ตารางของ FastAPI (Alembic)

```sql
CREATE TABLE gmail_tokens (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_refresh_token BYTEA       NOT NULL,
    encryption_key_id       TEXT        NOT NULL,          -- รองรับ key rotation
    gmail_address           TEXT        NOT NULL,          -- ใช้ map จาก webhook payload
    history_id              BIGINT,                        -- NULL = ยังไม่เคย watch
    watch_expiration        TIMESTAMPTZ,
    last_synced_at          TIMESTAMPTZ,
    sync_error              TEXT,                          -- error ล่าสุด (ให้ dashboard โชว์ได้)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON gmail_tokens (gmail_address);
CREATE INDEX ON gmail_tokens (watch_expiration);

CREATE TABLE emails (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_message_id  TEXT        NOT NULL,
    gmail_thread_id   TEXT        NOT NULL,
    sender            TEXT        NOT NULL,
    subject           TEXT        NOT NULL DEFAULT '',
    snippet           TEXT        NOT NULL DEFAULT '',
    received_at       TIMESTAMPTZ NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','replied','no_reply_needed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, gmail_message_id)          -- กันซ้ำจาก Pub/Sub at-least-once
);
CREATE INDEX ON emails (user_id, received_at DESC);
CREATE INDEX ON emails (user_id, status) WHERE status = 'pending';

CREATE TABLE classifications (
    email_id      UUID        PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category      TEXT        NOT NULL
                              CHECK (category IN ('Customer','Internal','Vendor','Meeting','Spam')),
    priority      TEXT        NOT NULL
                              CHECK (priority IN ('Urgent','Normal','Low')),
    reason        TEXT        NOT NULL,
    model         TEXT        NOT NULL,        -- 'claude-haiku-4-5' — เก็บไว้เทียบตอนเปลี่ยน model
    input_tokens  INT,
    output_tokens INT,
    labeled_at    TIMESTAMPTZ,                 -- NULL = classify แล้วแต่ติด label ไม่สำเร็จ
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON classifications (user_id, priority);

-- cache label id ต่อ user (แทน lru_cache global ที่พังใน multi-tenant)
CREATE TABLE gmail_labels (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label_name  TEXT NOT NULL,          -- 'AI/Priority/Urgent'
    label_id    TEXT NOT NULL,
    PRIMARY KEY (user_id, label_name)
);
```

**เหตุผลที่แยก `emails` / `classifications` (ต่างจากเวอร์ชันเดิมที่รวมเป็นตารางเดียว):** ถ้า classify fail แต่ fetch สำเร็จ เรายังมีอีเมลอยู่ในระบบและ retry ได้ ไม่ต้องไปดึง Gmail ใหม่ — และตอนอยาก re-classify ทั้งหมดด้วย prompt ใหม่ ก็ลบเฉพาะ `classifications` ได้

---

## 6. API contract

### 6.1 Public REST (Next.js → NestJS, ทุก route ผ่าน Auth Guard ยกเว้นที่ระบุ)

| Method | Path | Auth | ทำอะไร |
|---|---|---|---|
| `GET` | `/auth/google` | ไม่ต้อง | redirect ไป Google consent |
| `GET` | `/auth/google/callback` | ไม่ต้อง | แลก code → สร้าง session → set cookie → redirect `/dashboard` |
| `POST` | `/auth/logout` | ต้อง | ลบ session + clear cookie |
| `GET` | `/auth/me` | ต้อง | `{ id, email, displayName, avatarUrl, gmailConnected, lastSyncedAt }` |
| `GET` | `/emails` | ต้อง | query: `category?`, `priority?`, `status?`, `limit=50`, `cursor?` |
| `GET` | `/stats` | ต้อง | `{ pending: { urgent, normal, low }, totalToday }` |
| `PATCH` | `/emails/:id/status` | ต้อง | `{ status }` — สถานะฝั่ง dashboard เท่านั้น ไม่แตะ Gmail |
| `POST` | `/emails/bulk-status` | ต้อง | `{ ids: string[], status }` |
| `POST` | `/webhook/gmail` | OIDC | **Pub/Sub เท่านั้น** — ไม่ผ่าน Auth Guard, verify ด้วย Google OIDC token |
| `GET` | `/health` | ไม่ต้อง | liveness |

### 6.2 Internal REST (NestJS ↔ FastAPI, private network + `X-Internal-Secret`)

| ทิศทาง | Method | Path | ทำอะไร |
|---|---|---|---|
| N→F | `POST` | `/internal/users/{user_id}/gmail-token` | ส่ง refresh token ตอน login ครั้งแรก → FastAPI encrypt เก็บ + เรียก `watch()` |
| N→F | `DELETE` | `/internal/users/{user_id}/gmail-token` | ตอน logout ถาวร/ปิดบัญชี → `stop()` watch + ลบ token |
| N→F | `POST` | `/internal/webhook/gmail` | forward payload จาก Pub/Sub (`{ emailAddress, historyId }`) |
| N→F | `GET` | `/internal/users/{user_id}/emails` | query params เหมือน `/emails` |
| N→F | `GET` | `/internal/users/{user_id}/stats` | |
| N→F | `PATCH` | `/internal/users/{user_id}/emails/{id}/status` | |
| N→F | `POST` | `/internal/cron/renew-watch` | Railway cron รายวัน → NestJS → FastAPI |
| N→F | `POST` | `/internal/cron/reconcile` | Railway cron ทุก 30 นาที |
| **F→N** | `POST` | `/internal/notify` | FastAPI แจ้งผล classify → NestJS push WebSocket |

### 6.3 WebSocket events (NestJS → browser)

room = `user:{user_id}` — join ตอน connect หลัง verify session cookie

| Event | Payload | เมื่อไหร่ |
|---|---|---|
| `email:classified` | `{ email, classification }` | อีเมลใหม่ classify เสร็จ |
| `email:status_changed` | `{ id, status }` | สถานะเปลี่ยน (รวมจาก reconcile ที่เจอว่าตอบแล้ว) |
| `stats:updated` | `{ pending: {...} }` | ส่งตามหลัง 2 event บน |
| `sync:error` | `{ message, at }` | token หมดอายุ / watch พัง — dashboard โชว์ banner ให้ login ใหม่ |

---

## 7. Auth flow

```
1. browser → GET /auth/google
2. NestJS → redirect Google
     scope        = openid email profile https://www.googleapis.com/auth/gmail.modify
     access_type  = offline          ← ไม่ใส่ = ไม่ได้ refresh token
     prompt       = consent          ← ไม่ใส่ = login ครั้งที่ 2 จะไม่ส่ง refresh token กลับมา
     state        = <random, เก็บใน cookie ชั่วคราว>   ← กัน CSRF
3. Google → GET /auth/google/callback?code=...&state=...
4. NestJS: verify state → แลก code → ได้ id_token + access_token + refresh_token
5. NestJS: verify id_token (issuer, aud, exp) → ตรวจ hd claim = domain ของ org
6. NestJS: upsert users (by email) → สร้าง session → set httpOnly cookie
7. NestJS → POST /internal/users/{id}/gmail-token { refresh_token, gmail_address }
8. NestJS: ลืม refresh token ทิ้งทันที (ห้าม log, ห้ามเก็บ)
9. FastAPI: encrypt (AES-256-GCM) → เก็บ → เรียก users.watch()
     { topicName, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }
   → บันทึก historyId + expiration
10. NestJS → redirect /dashboard
```

**จุดพลาดที่เจอบ่อย:**
- **ขาด `access_type=offline` + `prompt=consent`** → login ครั้งแรกได้ refresh token ครั้งเดียว ครั้งต่อไป Google ไม่ส่งมาอีก แล้วระบบจะพังตอน token หมดอายุ
- **ไม่ตรวจ `hd` claim** → Internal user type คุมที่ consent screen อยู่แล้ว แต่ตรวจซ้ำอีกชั้นถูกกว่าเชื่อ config ตัวเดียว
- **`watch()` โดยไม่ใส่ `labelIds: ['INBOX']`** → ได้ notification ทุกอย่างรวม draft/sent/label เปลี่ยน = noise มหาศาล

**สิ่งที่ได้ฟรีจากการออกแบบนี้:** `watch()` ผูก `historyId` ณ เวลาที่เรียก → อีเมลก่อน login ไม่ถูกดึงมาเลยโดยธรรมชาติ ไม่ต้องทำ watermark table เองแบบเวอร์ชัน assessment

---

## 8. Real-time pipeline

### 8.1 Happy path (webhook)

```
เมลเข้า inbox
  → Gmail publish → Pub/Sub topic
  → Pub/Sub push (OIDC signed) → POST /webhook/gmail  [NestJS, public]
      ├ verify OIDC JWT (aud + email = service account ที่เราสร้าง)
      ├ base64 decode data → { emailAddress, historyId }
      ├ ตอบ 204 ทันที (Pub/Sub retry ถ้าเกิน timeout)
      └ forward → POST /internal/webhook/gmail  [FastAPI, private]
            ├ map emailAddress → user_id  (gmail_tokens.gmail_address)
            ├ pg_advisory_xact_lock(user_id)     ← กันประมวลผลซ้อนกับ reconcile
            ├ history.list(startHistoryId=เก่า, historyTypes=['messageAdded'])
            │     404/410 → historyId เก่าเกิน (Gmail เก็บ history ~1 สัปดาห์)
            │              → fallback: messages.list(q='is:unread newer_than:1d',
            │                                        maxResults=MAX_EMAILS_PER_SYNC)
            ├ กรอง message ที่มีใน emails แล้วออก (idempotency)
            ├ messages.get(format='metadata', headers=[From,Subject,Date]) ทีละฉบับ
            ├ LangGraph: classify_node → label_node
            ├ update history_id + last_synced_at
            └ POST /internal/notify → NestJS → WebSocket → dashboard
```

**Idempotency:** Pub/Sub เป็น at-least-once — webhook เดียวกันมาซ้ำได้ กัน 2 ชั้น
1. `UNIQUE (user_id, gmail_message_id)` ใน `emails`
2. `pg_advisory_xact_lock` ต่อ user — request ซ้อนกันจะรอคิว ไม่ทำงานพร้อมกัน

### 8.2 Cron jobs (บังคับ ไม่ใช่ optional)

| Job | ความถี่ | ทำอะไร | ถ้าไม่มีจะเป็นยังไง |
|---|---|---|---|
| `renew-watch` | ทุกวัน 03:00 | วน user ที่ `is_active` → เรียก `watch()` ใหม่ → อัปเดต `watch_expiration` | `watch()` หมดอายุใน **7 วัน** แล้วเงียบไปเลย ไม่มี error — "เมลเข้าจริงแต่ระบบไม่รู้" |
| `reconcile` | ทุก 30 นาที | เทียบ `history_id` ที่เก็บกับ Gmail จริง → ถ้าต่างแปลว่ามี webhook หลุด → ดึงย้อน | webhook หลุด 1 ครั้ง = อีเมลนั้นหายจนกว่าจะมีเมลถัดไปมา trigger ให้ลากย้อน (หรือหายถาวรถ้าไม่มีเมลอีก) |
| `reply-check` | รวมกับ reconcile | สำหรับ email ที่ `status='pending'` → `threads.get` เช็คว่ามี `SENT` ใน thread แล้วหรือยัง → update เป็น `replied` | ต้อง mark เองทั้งหมด (ฟีเจอร์นี้ยกมาจากเวอร์ชัน assessment) |

`renew-watch` ต้องวน **ทุก user ที่ยัง active** ไม่ใช่เฉพาะคนที่เปิดเว็บวันนั้น — เพราะ `watch()` หมดอายุตามเวลาจริง ไม่เกี่ยวกับ session

**Railway cron ยิงเข้า NestJS** (public) ด้วย `X-Cron-Secret` แล้ว NestJS forward เข้า FastAPI — เหตุผลเดียวกับ webhook คือให้ FastAPI ปิดสนิท

### 8.3 Error handling ต่อ user

| อาการ | ทำอะไร |
|---|---|
| refresh token ถูก revoke (`invalid_grant`) | เขียน `sync_error`, ส่ง `sync:error` ผ่าน WS, หยุด renew user นี้จนกว่าจะ login ใหม่ |
| Gmail 429 / 5xx | exponential backoff 3 ครั้ง (1s/4s/16s) → ยังไม่ผ่านให้ reconcile รอบหน้ามาเก็บ |
| Claude API error | บันทึก email ไว้โดยไม่มี classification → job retry classify ที่ค้าง |
| `label_node` fail | `labeled_at` ยัง NULL → retry ได้ โดย classification ยังอยู่ ไม่ต้องเรียก Claude ซ้ำ |

---

## 9. AI layer

### 9.1 Model และ structured output

```python
# app/services/classifier_graph.py
from anthropic import Anthropic
from pydantic import BaseModel
from typing import Literal

client = Anthropic()   # อ่าน ANTHROPIC_API_KEY จาก env

class EmailClassification(BaseModel):
    category: Literal["Customer", "Internal", "Vendor", "Meeting", "Spam"]
    priority: Literal["Urgent", "Normal", "Low"]
    reason: str

response = client.messages.parse(
    model="claude-haiku-4-5",
    max_tokens=512,
    system=SYSTEM_PROMPT,
    messages=[{"role": "user", "content": user_message}],
    output_format=EmailClassification,
)
result = response.parsed_output          # instance ที่ validate แล้ว
usage  = response.usage                  # input_tokens / output_tokens → เก็บลง DB
```

**เปลี่ยนจากเวอร์ชัน assessment:** เดิมใช้ `ChatAnthropic(...).with_structured_output()` ของ LangChain — เวอร์ชันนี้เรียก Anthropic SDK ตรงๆ ด้วย `messages.parse()` เพราะได้ `usage` มาเก็บลง DB ตรงๆ และลด dependency ลงหนึ่งชั้น
**LangGraph ยังอยู่** — ใช้เป็น orchestration ของ `classify → label` (มีที่ใส่ retry / conditional edge ตอนขยาย) แต่ตัวเรียก LLM ไม่ต้องผ่าน LangChain

`SYSTEM_PROMPT` ยกมาจาก `classifier.py` เดิมได้เกือบทั้งหมด แก้แค่ตัดคำว่า "ธนาคาร SCB" ออกให้เป็น generic

### 9.2 ต้นทุน

Haiku 4.5 = **$1 / MTok input, $5 / MTok output**, context 200K

| รายการ | ประมาณ |
|---|---|
| input ต่ออีเมล | ~500 tokens (system ~300 + sender/subject/snippet ~200) |
| output ต่ออีเมล | ~80 tokens |
| **ต้นทุนต่ออีเมล** | **~$0.0009** |
| 200 อีเมล/วัน (1 ทีม) | ~$0.18/วัน ≈ **$5.4/เดือน** |
| 20 user × 200 อีเมล/วัน | ~$3.6/วัน ≈ **$108/เดือน** |

ถ้าอยากลด: classify batch 5-10 ฉบับ/request (amortize system prompt) ลด input ได้ ~40%

### 9.3 Rate limit ที่ต้องระวัง

| API | เพดาน | คิดยังไง |
|---|---|---|
| Gmail per-user | 250 quota units/วินาที/user | `messages.get`=5, `modify`=5, `history.list`=2, `labels.list`=1, `watch`=100 → 1 อีเมลใช้ ~10 units → ห่างจากเพดานมาก |
| Gmail per-project | 1.2M units/นาที | 20 user ไม่ใกล้เคียง |
| Anthropic | ตาม tier | ตั้ง semaphore จำกัด concurrent classify (เริ่มที่ 5) |

`MAX_EMAILS_PER_BATCH = 50` ต่อ 1 webhook — กันกรณี `history.list` คืนมาผิดปกติแล้วยิง API รัว

---

## 10. Security

| เรื่อง | ทำยังไง |
|---|---|
| Gmail refresh token | AES-256-GCM (`cryptography.fernet`), key จาก `TOKEN_ENCRYPTION_KEY` env, เก็บ `encryption_key_id` ไว้รองรับ rotate |
| Session cookie | `httpOnly` + `secure` + `sameSite=lax`, อายุ 7 วัน, เก็บเฉพาะ hash ใน DB |
| Internal REST | Railway private network + `X-Internal-Secret` (compare แบบ constant-time) |
| Pub/Sub webhook | verify OIDC JWT: signature, `aud` = URL ของเรา, `email` = service account ที่เราตั้ง |
| Cron endpoint | `X-Cron-Secret` |
| Logging | **ห้าม log**: refresh token, access token, session token, เนื้อหาอีเมลเต็ม (log ได้แค่ message_id + user_id) |
| Scope | `gmail.modify` เท่านั้น — อ่าน + ติด label ไม่มี delete/send |
| CORS | allowlist origin ของ frontend เท่านั้น |

---

## 11. Observability

| อย่างน้อยต้องมี | รายละเอียด |
|---|---|
| Health endpoint | `/health` (liveness) + `/health/ready` (เช็ค DB + Anthropic reachable) ทั้ง 2 service |
| Structured log (JSON) | ทุก log มี `user_id`, `request_id`, `event` |
| Metric ที่ต้องดูได้ | จำนวน webhook ที่รับ, จำนวนที่ classify สำเร็จ/fail, latency `webhook → WS push`, จำนวน user ที่ `sync_error` ไม่ NULL |
| ตัวชี้วัดว่าระบบยังทำงาน | user ที่ `watch_expiration < now() + 2 days` ควรเป็น 0 เสมอ — ถ้าไม่ใช่แปลว่า cron ตาย |

หน้า `/admin/health` ง่ายๆ ที่โชว์ตาราง user + `watch_expiration` + `last_synced_at` + `sync_error` ช่วยชีวิตตอน debug ได้มาก

---

## 12. Google Cloud Console — ทำมือครั้งเดียว

เรียงตามลำดับที่ต้องทำ:

1. สร้าง GCP project
2. เปิด **Gmail API** + **Cloud Pub/Sub API**
3. OAuth consent screen → **Internal** (หรือ **External + Testing mode** ถ้า dev ด้วย personal Gmail — ดู §1) → เพิ่ม scope `gmail.modify` → ถ้าเป็น External ต้องเพิ่มบัญชีที่จะทดสอบเป็น **Test users** ด้วย
4. สร้าง OAuth 2.0 Client ID (Web application)
   - Authorized redirect URI: `https://<backend-domain>/auth/google/callback` และ `http://localhost:3001/auth/google/callback`
5. สร้าง Pub/Sub topic เช่น `gmail-push`
6. ให้สิทธิ์ `gmail-api-push@system.gserviceaccount.com` เป็น **Pub/Sub Publisher** บน topic นี้ ← ลืมข้อนี้บ่อยที่สุด, `watch()` จะ fail ด้วย permission error
7. สร้าง Push subscription → endpoint `https://<backend-domain>/webhook/gmail` → เปิด **OIDC authentication** เลือก service account
8. ตั้ง ack deadline ของ subscription = 10s (เราตอบ 204 ทันทีอยู่แล้ว)

**Dev:** push subscription ต้องเป็น public HTTPS — `localhost` ใช้ไม่ได้ ใช้ `ngrok http 3001` แล้วเอา URL ไปตั้งเป็น subscription ตัวที่ 2 (แยกจาก production)

---

## 13. แผนเฟส

แต่ละเฟสมีเกณฑ์ปิดงานที่ทดสอบได้จริง — ห้ามข้ามไปเฟสถัดไปถ้ายังไม่ผ่าน

### Phase 0 — Foundation (~0.5 วัน)
- monorepo skeleton, `docker-compose.dev.yml` (Postgres)
- `.env.example` ครบทุก service
- health endpoint ทั้ง 2 service

✅ **ปิดงานเมื่อ:** `docker compose up` ได้ Postgres, ทั้ง 2 service ตอบ `/health` ได้

### Phase 1 — AI/Gmail service (~2-3 วัน) 🔴 เสี่ยงสุด ทำก่อน
- Alembic migration ครบทุกตารางใน §5.2 (`app/models/*`)
- `services/token_crypto.py` (encrypt/decrypt + key id)
- `services/gmail_client.py` — per-user credential, ไม่มี module-level cache
- `services/gmail_labels.py` — get-or-create label ผ่านตาราง `gmail_labels`
- `services/gmail_watch.py` — `watch()` / `stop()` / renew
- `services/gmail_history.py` — `history.list` + fallback ตอน 404
- `services/classifier_graph.py` — LangGraph `classify_node → label_node`
- `api/internal.py` ครบทุก endpoint, `api/webhook.py`
- `api/cron.py`

✅ **ปิดงานเมื่อ:** ส่งเมลจริงเข้า Gmail ตัวเอง → ยิง `/internal/webhook/gmail` ด้วย mock payload → อีเมลถูก classify + ติด label จริงใน Gmail + มีแถวใน DB + ยิงซ้ำ payload เดิมแล้วไม่เกิดแถวซ้ำ

### Phase 2 — Backend (NestJS) (~2 วัน)
- Prisma schema + migration (`users`, `sessions`)
- Google OAuth module + session + Auth Guard
- `/emails`, `/stats`, `/emails/:id/status`
- WebSocket Gateway + room per user
- `/webhook/gmail` (OIDC verify) → forward
- `/internal/notify` รับจาก FastAPI

✅ **ปิดงานเมื่อ:** login Google จริงสำเร็จ → cookie ถูกตั้ง → `GET /emails` คืนของ user ตัวเองเท่านั้น → เปิด 2 บัญชีพร้อมกันแล้วข้อมูลไม่ปนกัน

### Phase 3 — Frontend (~2 วัน)
- หน้า login (ปุ่มเดียว)
- หน้า dashboard: ตารางเรียงตาม priority, filter category/status, stat tiles
- WebSocket client + reconnect + optimistic update
- banner ตอนได้ `sync:error`

✅ **ปิดงานเมื่อ:** เปิด dashboard ค้างไว้ → ส่งเมลเข้า inbox → แถวใหม่โผล่เองภายใน 10 วินาที โดยไม่ refresh

### Phase 4 — Deploy + wiring (~1-2 วัน)
- Railway 4 service (frontend / backend / ai / postgres) — ai ไม่ generate public domain
- ตั้ง env vars ทั้งหมด
- ทำ §12 ให้ครบ ชี้ push subscription มาที่ domain จริง
- Railway cron 2 ตัว (renew-watch รายวัน, reconcile ทุก 30 นาที)

✅ **ปิดงานเมื่อ:** เมลเข้า inbox จริง → ขึ้น dashboard production เองภายใน 10 วินาที (ไม่ผ่าน mock) และหน้า admin โชว์ `watch_expiration` เป็นวันถัดไป

### Phase 5 — Hardening (ทำได้เรื่อยๆ)
- retry ที่ค้าง (classify fail, label fail)
- หน้า admin health
- E2E test เส้นหลัก
- README + สถาปัตยกรรมสำหรับพอร์ต

---

## 14. ความเสี่ยง + ที่ยังไม่ตัดสินใจ

### ความเสี่ยง

| ความเสี่ยง | โอกาส | ผล | รับมือ |
|---|---|---|---|
| `watch()` ไม่ได้ renew | สูงถ้าลืมทำ cron | ระบบเงียบสนิทโดยไม่มี error | cron + alert เมื่อมี user ที่ `watch_expiration < now()+2d` |
| Pub/Sub push หลุด | ปานกลาง | อีเมลหาย | reconcile ทุก 30 นาที |
| `historyId` เก่าเกิน 1 สัปดาห์ (user ไม่ได้ใช้นาน) | ปานกลาง | `history.list` คืน 404 | fallback ไป `messages.list` แบบจำกัดจำนวน |
| Refresh token ถูก revoke | ต่ำ | user คนนั้นหยุดทำงาน | ตรวจจับ `invalid_grant` → แจ้งผ่าน WS ให้ login ใหม่ |
| Claude classify ผิดบ่อย | ปานกลาง | ความน่าเชื่อถือ | เก็บ `reason` + `model` ทุกแถว → ย้อนดูได้ว่า prompt ไหนให้ผลยังไง |
| ค่า API บานตอน user เยอะ | ต่ำที่ scale นี้ | | เก็บ token usage ทุกแถว → ทำหน้าสรุปได้ทันที |

### ที่ยังไม่ตัดสินใจ (ตัดสินตอนเริ่มเฟสที่เกี่ยว)

1. **classify ทีละฉบับ หรือ batch?** — เริ่มทีละฉบับให้ทำงานได้ก่อน (Phase 1) แล้วค่อยวัดว่า batch คุ้มไหม (Phase 5)
2. **NestJS อ่านตาราง `emails` ตรงได้ไหม?** — แผนนี้ให้ผ่าน internal REST เสมอ (ตามหลัก ownership) ถ้า latency เป็นปัญหาจริงค่อยพิจารณาให้ Prisma อ่าน read-only view
3. **เก็บ email body เต็มไหม?** — ตอนนี้เก็บแค่ `snippet` (จาก `format=metadata`) พอสำหรับ classify และเป็นการเก็บข้อมูลน้อยที่สุด ถ้าอนาคตอยากทำ summary ค่อยเพิ่ม
4. **ทำหน้า re-classify ให้ user แก้ผลได้ไหม?** — เป็น feedback loop ที่ดีมากสำหรับพอร์ต แต่ไม่อยู่ใน scope หลัก
5. **multi-region / data residency** — ไม่พิจารณาที่ scale นี้

---

## 15. ไม่อยู่ใน scope (เขียนไว้กันหลงทาง)

- ปุ่ม "Sync now" / on-demand sync ทุกรูปแบบ → แทนที่ด้วย push ทั้งหมด
- `last_sync_at` watermark table เอง → ใช้ `historyId` ของ Gmail แทน
- SQLite, `token.json` global → Postgres + per-user encrypted token
- Python monolith → 3 service
- ตอบอีเมลอัตโนมัติ / archive / delete → scope เป็น `gmail.modify` แค่อ่าน+ติด label
- รองรับหลาย Workspace org / public users → ต้องกลับไปทำ Google verification ก่อน
- Mobile app
