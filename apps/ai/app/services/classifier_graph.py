"""LangGraph classify_node → label_node (PLAN-V2.md §3.3, §9.1)

fetch_node ไม่มีในเวอร์ชันนี้ — webhook เป็นคนบอกว่ามีอีเมลอะไรใหม่ graph จึงรับ
list อีเมล (ดึง metadata มาแล้ว) เข้ามาตรงๆ เหลือแค่ classify → label
"""

import uuid
from typing import Any, TypedDict

from anthropic import Anthropic
from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.taxonomy import CATEGORIES, PRIORITIES
from app.schemas.classification import EmailClassification
from app.services import gmail_labels

# คำอธิบายสั้นต่อค่า — key ต้องตรงกับ app/core/taxonomy.py เป๊ะ (assert ด้านล่างกันหลุด sync)
_CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "Customer": "อีเมลจากลูกค้าหรือผู้ใช้บริการ",
    "Internal": "อีเมลภายในทีม/องค์กร",
    "Vendor": "อีเมลจากซัพพลายเออร์/พาร์ทเนอร์ภายนอก",
    "Meeting": "คำเชิญประชุม/นัดหมาย",
    "Spam": "โฆษณา/สแปม/ไม่เกี่ยวข้องกับงาน",
}
_PRIORITY_DESCRIPTIONS: dict[str, str] = {
    "Urgent": "ต้องตอบกลับหรือดำเนินการภายในวันนี้",
    "Normal": "งานปกติ ตอบภายในไม่กี่วันได้",
    "Low": "ไม่เร่งด่วน หรือไม่ต้องตอบกลับ",
}
assert set(_CATEGORY_DESCRIPTIONS) == set(CATEGORIES), "แก้ CATEGORIES แล้วต้องแก้ description ด้วย"
assert set(_PRIORITY_DESCRIPTIONS) == set(PRIORITIES), "แก้ PRIORITIES แล้วต้องแก้ description ด้วย"


def _build_system_prompt() -> str:
    category_lines = "\n".join(f"- {c}: {_CATEGORY_DESCRIPTIONS[c]}" for c in CATEGORIES)
    priority_lines = "\n".join(f"- {p}: {_PRIORITY_DESCRIPTIONS[p]}" for p in PRIORITIES)
    return (
        "คุณเป็นผู้ช่วยจัดหมวดหมู่และจัดลำดับความสำคัญอีเมลสำหรับทีมงาน\n\n"
        f"จัดหมวดหมู่ (category) อีเมลแต่ละฉบับเป็นหนึ่งใน:\n{category_lines}\n\n"
        f"จัดลำดับความสำคัญ (priority) เป็นหนึ่งใน:\n{priority_lines}\n\n"
        "ให้เหตุผลสั้นๆ (reason) 1 ประโยคว่าทำไมถึงจัดหมวดหมู่/ลำดับความสำคัญแบบนั้น"
    )


_SYSTEM_PROMPT = _build_system_prompt()


class EmailItem(TypedDict):
    gmail_message_id: str
    gmail_thread_id: str
    sender: str
    subject: str
    snippet: str


class ClassifyResult(TypedDict):
    email: EmailItem
    classification: EmailClassification
    input_tokens: int
    output_tokens: int
    label_ids: list[str]


class GraphState(TypedDict):
    user_id: uuid.UUID
    db: Session
    gmail_service: Any
    emails: list[EmailItem]
    results: list[ClassifyResult]


def _build_user_message(email: EmailItem) -> str:
    return (
        f"From: {email['sender']}\n"
        f"Subject: {email['subject']}\n"
        f"Snippet: {email['snippet']}"
    )


def classify_node(state: GraphState) -> GraphState:
    # settings.ANTHROPIC_API_KEY มาจาก pydantic-settings อ่าน .env เอง — ไม่ได้เซ็ตเข้า
    # os.environ ของ process จริง ถ้าปล่อยให้ Anthropic() หาเองจาก env จะหาไม่เจอ (เคยพังจริง)
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    results: list[ClassifyResult] = []

    for email in state["emails"]:
        response = client.messages.parse(
            model=settings.CLAUDE_MODEL,
            max_tokens=512,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _build_user_message(email)}],
            output_format=EmailClassification,
        )
        results.append(
            ClassifyResult(
                email=email,
                classification=response.parsed_output,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                label_ids=[],
            )
        )

    return {**state, "results": results}


def label_node(state: GraphState) -> GraphState:
    db = state["db"]
    gmail_service = state["gmail_service"]
    user_id = state["user_id"]

    for result in state["results"]:
        classification = result["classification"]
        priority_label = gmail_labels.get_or_create_label_id(
            db, user_id, gmail_service, f"AI/Priority/{classification.priority}"
        )
        category_label = gmail_labels.get_or_create_label_id(
            db, user_id, gmail_service, f"AI/Category/{classification.category}"
        )

        gmail_service.users().messages().modify(
            userId="me",
            id=result["email"]["gmail_message_id"],
            body={"addLabelIds": [priority_label, category_label]},
        ).execute()

        result["label_ids"] = [priority_label, category_label]

    return state


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("classify", classify_node)
    graph.add_node("label", label_node)
    graph.set_entry_point("classify")
    graph.add_edge("classify", "label")
    graph.add_edge("label", END)
    return graph.compile()


_compiled_graph = None


def get_compiled_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph
