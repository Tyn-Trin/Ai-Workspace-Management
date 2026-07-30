"""Encrypt/decrypt Gmail refresh tokens (PLAN-V2.md §10: AES-256-GCM).

encryption_key_id ถูกเก็บคู่กับ ciphertext ทุกแถวใน DB เพื่อรองรับ key rotation:
เพิ่มคีย์ใหม่ใน _KEY_REGISTRY, เปลี่ยน CURRENT_KEY_ID, แล้ว decrypt แถวเก่ายังทำงาน
ได้ปกติเพราะ key_id เดิมยังอยู่ใน registry — ค่อย re-encrypt แถวเก่าเป็น background job
"""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

CURRENT_KEY_ID = "v1"
_NONCE_LEN = 12  # 96-bit, ค่ามาตรฐานของ AES-GCM

_KEY_REGISTRY = {
    "v1": settings.TOKEN_ENCRYPTION_KEY,
}


def _load_key(key_id: str) -> bytes:
    raw = _KEY_REGISTRY.get(key_id)
    if raw is None:
        raise ValueError(f"unknown encryption_key_id: {key_id}")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("encryption key must decode to 32 bytes (AES-256)")
    return key


def encrypt(plaintext: str) -> tuple[bytes, str]:
    """คืน (nonce + ciphertext ต่อกัน, encryption_key_id) — เก็บทั้งคู่ลงคอลัมน์ gmail_tokens"""
    key = _load_key(CURRENT_KEY_ID)
    nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ciphertext, CURRENT_KEY_ID


def decrypt(blob: bytes, key_id: str) -> str:
    key = _load_key(key_id)
    nonce, ciphertext = blob[:_NONCE_LEN], blob[_NONCE_LEN:]
    plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")
