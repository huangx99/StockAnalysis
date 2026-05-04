from abc import ABC, abstractmethod
from typing import AsyncGenerator, Any

from models.ai import AIAnalysis, AIReport


class AIProvider(ABC):
    @abstractmethod
    async def analyze(
        self,
        symbol: str,
        stock_name: str,
        profile_data: dict,
        financials_data: list[dict] | dict[str, Any],
        news_data: list[dict],
    ) -> AIAnalysis:
        ...

    async def analyze_stream(
        self,
        symbol: str,
        stock_name: str,
        profile_data: dict,
        financials_data: list[dict] | dict[str, Any],
        news_data: list[dict],
    ) -> AsyncGenerator[tuple[str, object], None]:
        """Yield (field_name, value) pairs as analysis fields become available."""
        result = await self.analyze(symbol, stock_name, profile_data, financials_data, news_data)
        for field_name, value in result.model_dump().items():
            yield field_name, value

    @abstractmethod
    async def report(
        self,
        symbol: str,
        stock_name: str,
        profile_data: dict,
        financials_data: list[dict] | dict[str, Any],
        news_data: list[dict],
    ) -> AIReport:
        ...

    @abstractmethod
    async def analyze_news_item(self, title: str, content: str) -> dict:
        """Analyze a single news article. Returns {sentiment, summary, key_points, risk_factors}."""
        ...
