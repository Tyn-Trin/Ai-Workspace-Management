# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ทีมงาน 5-20 คนในองค์กรเดียวกัน (Google Workspace org เดียว) ที่ได้รับอีเมลเข้ามาจำนวนมากต่อวัน
(~150-200 ฉบับ/ทีม) และต้องการรู้ทันทีว่าอีเมลไหนสำคัญ ต้องรีบตอบ โดยไม่ต้องเปิดอ่านทุกฉบับเอง

## Product Purpose

ระบบ triage อีเมลอัตโนมัติด้วย AI: จัดหมวดหมู่ (Customer/Internal/Vendor/Meeting/Spam) และลำดับ
ความสำคัญ (Urgent/Normal/Low) ให้อีเมลทุกฉบับที่เข้า Gmail แบบเรียลไทม์ ไม่ต้องกดปุ่ม sync เอง —
สำเร็จเมื่อทีมเห็นอีเมลสำคัญได้ทันทีที่มันเข้ามา แทนที่จะไล่อ่าน inbox ทีละฉบับ

## Positioning

ต่างจาก dashboard อีเมลทั่วไปที่เป็น "silo" แยกต่างหากจาก Gmail จริง ระบบนี้ **ติด label จริงบน
Gmail ของ user เอง** (nested label เช่น `AI/Priority/Urgent`) และซิงก์แบบ push-based (Gmail →
Pub/Sub → webhook) ไม่ใช่ polling หรือปุ่ม "sync now" — คนอื่นเปิด Gmail ตรงๆ ก็ยังเห็น label
เดียวกัน ไม่ต้องพึ่ง dashboard นี้ตลอดเวลา

## Operating Context

- Login ด้วยบัญชี Google Workspace ขององค์กรตัวเอง (OAuth) — บัญชีเดียวกับที่ใช้ login คือบัญชี
  Gmail ที่ระบบจะ monitor
- ใช้งานผ่านเบราว์เซอร์ dashboard ที่เปิดค้างไว้ระหว่างวันทำงาน คล้ายอีเมลไคลเอนต์อีกตัวที่โฟกัส
  แค่ priority ไม่ใช่กล่องจดหมายเต็มรูปแบบ
- คนในทีมมักเปิดพร้อมกันหลายคน แต่ข้อมูลแยกกันสนิทต่อ user (คนละ Gmail account คนละ dashboard view)

## Capabilities and Constraints

- Classify อัตโนมัติทุกอีเมลใหม่ที่เข้า inbox ผ่าน LangGraph + Claude (`claude-haiku-4-5`)
- ติด label จริงบน Gmail (`AI/Priority/*`, `AI/Category/*`)
- Dashboard: ตาราง filter ตาม priority/category/วันที่, WebSocket real-time push, undo เปลี่ยน
  สถานะได้ 5 วิ
- **ไม่เก็บ** email body เต็มหรือไฟล์แนบ/รูปภาพใดๆ — ดึงแค่ header (From/Subject/Date) + snippet
  สั้นๆ จาก Gmail API เท่านั้น (ตัดสินใจเชิงความเป็นส่วนตัว/security ตั้งแต่ต้น)
- **ไม่มีปุ่ม sync/refresh manual ใดๆ** — ทุกอย่าง push-based ผ่าน Gmail watch() + Pub/Sub
- **ไม่ auto-delete ข้อมูล** — เก็บประวัติ classify ไว้ถาวรเพื่อตรวจสอบย้อนหลังได้
- OAuth consent type ตอนนี้เป็น External+Testing mode (dev ด้วย personal Gmail) — ของจริงเมื่อ
  deploy ให้ทีมที่มี Workspace org ใช้ ต้องเปลี่ยนเป็น Internal

## Brand Commitments

ชื่อระบบในโค้ด/เอกสารทั้งหมดคือ **Ai-Mail-priority** โลโก้ที่ได้รับมาเขียนว่า "Ai-Workspace-Priority"
(ยังไม่ได้ข้อสรุปว่าจะเปลี่ยนชื่อให้ตรงกันไหม — ถือเป็นจุดที่ยังไม่ปิด)

## Evidence on Hand

- `docs/PLAN-V2.md` — สถาปัตยกรรม, data model, API contract แบบละเอียด
- `LOGO.png` (ที่ root) — โลโก้ต้นฉบับ (ตัด icon-only และ hero version ไว้ใน `apps/frontend/public/`
  และ `apps/frontend/app/icon.png` แล้ว พื้นหลังโปร่งใส)
- ไม่มี testimonial/ลูกค้าจริง/ราคาใดๆ — เป็นเครื่องมือ internal ไม่ใช่ SaaS ขาย

## Product Principles

1. Real-time เสมอ ไม่มี manual sync — ถ้าต้องกดปุ่มถือว่าผิดหลักการ
2. เก็บข้อมูลให้น้อยที่สุดเท่าที่ classify ได้ (privacy/security-first)
3. Gmail label จริงคือ source of truth ไม่ใช่แค่ dashboard silo
4. Priority ต้องอ่านออกทันทีด้วยตา (สี/chip) ไม่ต้องอ่านข้อความอธิบาย
5. เครื่องมือ internal สำหรับทีมเล็ก ไม่ใช่ผลิตภัณฑ์ที่ต้องขายรูปลักษณ์หวือหวา

## Accessibility & Inclusion

ยังไม่มีข้อกำหนดเฉพาะที่ยืนยันแล้ว — ควรคงมาตรฐานทั่วไป (contrast, keyboard nav, focus state) ตาม
default ของ ui-ux-pro-max ที่ใช้ตอนสร้าง dashboard เดิม
