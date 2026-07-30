"""Single source of truth สำหรับ category/priority/status — schema, system prompt, และ
DB CHECK constraint (app/models/*) ทั้งหมดต้องอ้างจากที่นี่ ห้าม hardcode ซ้ำที่อื่น
"""

CATEGORIES: tuple[str, ...] = ("Customer", "Internal", "Vendor", "Meeting", "Spam")
PRIORITIES: tuple[str, ...] = ("Urgent", "Normal", "Low")
STATUSES: tuple[str, ...] = ("pending", "replied", "no_reply_needed")
DEFAULT_STATUS = STATUSES[0]


def sql_check_in(column: str, values: tuple[str, ...]) -> str:
    """สร้าง SQL string สำหรับ CheckConstraint เช่น "category IN ('Customer','Internal')" """
    quoted = ",".join(repr(v) for v in values)
    return f"{column} IN ({quoted})"
