import json
import logging
from datetime import datetime
from typing import AsyncGenerator

import anthropic

from config import settings
from models.ai import AIAnalysis, AIReport, AIReportSection
from .base import AIProvider

logger = logging.getLogger(__name__)

ANALYSIS_SYSTEM = """You are a professional A-share stock analyst.
Given the stock's profile, financial data, and recent news, produce a structured analysis.
You MUST return valid JSON matching this exact schema:
{
  "summary": "string — one-line summary",
  "score": integer 0-100,
  "style": "string (investment style label)",
  "companyOverview": "string — company overview: main business, industry position, competitive advantages",
  "marketPerformance": "string — recent price action, volume trends, technical indicators from kline data",
  "financialPerformance": "string — revenue growth, profitability, cash flow, key financial metrics analysis",
  "valuationAnalysis": "string — PE/PB valuation, comparison with industry peers, fair value assessment",
  "newsDigest": "string — summarize recent news and announcements, potential catalysts or risks from news",
  "highlights": ["string — investment highlight 1", "string — investment highlight 2", ...],
  "risks": ["string — risk factor 1", "string — risk factor 2", ...],
  "conclusion": "string — overall investment judgment and recommendation"
}
Each text field should be 2-4 sentences with specific numbers. Respond in Chinese."""

REPORT_SYSTEM = """You are a professional A-share stock research report writer.
Generate a structured report with 5-7 sections. Return valid JSON:
{
  "sections": [{"title": "string", "content": "string (markdown)"}]
}
Respond in Chinese. Use actual numbers from the provided data."""

NEWS_ANALYSIS_SYSTEM = """You are a financial news analyst for A-share stocks.
Analyze the given news article and return valid JSON:
{
  "sentiment": "positive | neutral | negative",
  "summary": "string — 1-2 sentence summary in Chinese",
  "key_points": ["key point 1", "key point 2", ...],
  "risk_factors": ["risk factor 1", ...]
}
Be concise. key_points should be 2-4 items. risk_factors can be empty if no risks."""


class ClaudeProvider(AIProvider):
    def __init__(self) -> None:
        kwargs: dict = {"api_key": settings.anthropic_api_key}
        if settings.anthropic_base_url:
            kwargs["base_url"] = settings.anthropic_base_url
        self.client = anthropic.AsyncAnthropic(**kwargs)
        self.model = settings.anthropic_model

    def _build_context(
        self, symbol: str, stock_name: str, profile: dict, financials: list[dict] | dict, news: list[dict]
    ) -> str:
        financial_context = financials[:4] if isinstance(financials, list) else financials
        return (
            f"Stock: {symbol} {stock_name}\n"
            f"Profile: {json.dumps(profile, ensure_ascii=False)}\n"
            f"Financials: {json.dumps(financial_context, ensure_ascii=False)}\n"
            f"Recent News: {json.dumps(news[:5], ensure_ascii=False)}"
        )

    async def analyze(
        self, symbol, stock_name, profile_data, financials_data, news_data
    ) -> AIAnalysis:
        user_msg = self._build_context(symbol, stock_name, profile_data, financials_data, news_data)
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                system=ANALYSIS_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            data = json.loads(response.content[0].text)
            return AIAnalysis(**data)
        except json.JSONDecodeError:
            logger.error("Claude returned non-JSON for analyze(%s)", symbol)
            return AIAnalysis(
                summary=f"{stock_name} AI analysis temporarily unavailable",
                score=0,
                style="未知",
                highlights=[],
                risks=["AI service returned invalid response"],
                companyOverview="",
                marketPerformance="",
                financialPerformance="",
                valuationAnalysis="",
                newsDigest="",
                conclusion="Please try again later",
            )
        except Exception as e:
            logger.error("Claude analyze(%s) failed: %s", symbol, e)
            raise

    async def analyze_stream(
        self, symbol, stock_name, profile_data, financials_data, news_data
    ) -> AsyncGenerator[tuple[str, object], None]:
        user_msg = self._build_context(symbol, stock_name, profile_data, financials_data, news_data)
        try:
            yielded: set[str] = set()
            buffer = ""
            async with self.client.messages.stream(
                model=self.model,
                max_tokens=2048,
                system=ANALYSIS_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                async for text in stream.text_stream:
                    buffer += text
                    try:
                        data = json.loads(buffer)
                        for key, value in data.items():
                            if key not in yielded:
                                yielded.add(key)
                                yield key, value
                    except json.JSONDecodeError:
                        pass
            # Final parse attempt
            try:
                data = json.loads(buffer)
                for key, value in data.items():
                    if key not in yielded:
                        yielded.add(key)
                        yield key, value
            except json.JSONDecodeError:
                logger.error("Claude analyze_stream(%s) failed to parse final JSON", symbol)
        except Exception as e:
            logger.error("Claude analyze_stream(%s) failed: %s", symbol, e)
            result = AIAnalysis(
                summary=f"{stock_name} AI analysis temporarily unavailable",
                score=0, style="未知", highlights=[], risks=["AI service error"],
                companyOverview="", marketPerformance="", financialPerformance="",
                valuationAnalysis="", newsDigest="",
                conclusion="Please try again later",
            )
            for field_name, value in result.model_dump().items():
                yield field_name, value

    async def analyze_news_item(self, title: str, content: str) -> dict:
        user_msg = f"Title: {title}\n\nContent: {content}"
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=NEWS_ANALYSIS_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            return json.loads(response.content[0].text)
        except Exception as e:
            logger.error("Claude analyze_news_item failed: %s", e)
            return {
                "sentiment": "neutral",
                "summary": "AI analysis unavailable",
                "key_points": [],
                "risk_factors": [],
            }

    async def report(
        self, symbol, stock_name, profile_data, financials_data, news_data
    ) -> AIReport:
        user_msg = self._build_context(symbol, stock_name, profile_data, financials_data, news_data)
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=REPORT_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            data = json.loads(response.content[0].text)
            return AIReport(
                sections=[AIReportSection(**s) for s in data["sections"]],
                generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
        except (json.JSONDecodeError, KeyError) as e:
            logger.error("Claude returned invalid report JSON for %s: %s", symbol, e)
            return AIReport(
                sections=[
                    AIReportSection(title="Error", content="AI report generation failed. Please try again.")
                ],
                generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
        except Exception as e:
            logger.error("Claude report(%s) failed: %s", symbol, e)
            raise
