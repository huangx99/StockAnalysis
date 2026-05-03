from pydantic import BaseModel
from typing import Literal


class SystemStatus(BaseModel):
    akshare: Literal["online", "offline"]
    aiService: Literal["online", "offline"]
    dataSource: str
    lastUpdate: str


class AIConfigRequest(BaseModel):
    provider: str
    apiKey: str
    model: str
    baseUrl: str = ""


class AIConfigResponse(BaseModel):
    provider: str
    apiKeyMasked: str
    model: str
    baseUrl: str
    configured: bool
