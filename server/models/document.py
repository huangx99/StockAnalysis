from pydantic import BaseModel
from typing import Literal


class StockDocument(BaseModel):
    id: str
    title: str
    type: Literal["news", "announcement", "report"]
    publishTime: str
    source: str
    summary: str
    content: str = ""
    sentiment: Literal["positive", "neutral", "negative"]
    risks: list[str]
    url: str | None = None
