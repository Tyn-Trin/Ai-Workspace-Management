from typing import Literal

from pydantic import BaseModel

from app.core.taxonomy import CATEGORIES, PRIORITIES

Category = Literal[*CATEGORIES]
Priority = Literal[*PRIORITIES]


class EmailClassification(BaseModel):
    """Structured output contract ที่ Claude ต้องคืนกลับมา (PLAN-V2.md §9.1)"""

    category: Category
    priority: Priority
    reason: str
