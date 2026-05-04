import json
import logging
from datetime import datetime
from typing import AsyncGenerator

import openai

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


class CustomProvider(AIProvider):
    """Generic OpenAI-compatible provider for local LLMs (Ollama, vLLM, etc.)."""

    def __init__(self) -> None:
        self.client = openai.AsyncOpenAI(
            api_key=settings.custom_api_key or "not-needed",
            base_url=settings.custom_base_url,
        )
        self.model = settings.custom_model

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
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": ANALYSIS_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=2048,
            )
            content = response.choices[0].message.content
            # Try to extract JSON from response (some models wrap in markdown)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            data = json.loads(content.strip())
            return AIAnalysis(**data)
        except Exception as e:
            logger.error("Custom provider analyze(%s) failed: %s", symbol, e)
            return AIAnalysis(
                summary=f"{stock_name} AI analysis temporarily unavailable",
                score=0, style="未知", highlights=[], risks=["AI service error"],
                companyOverview="", marketPerformance="", financialPerformance="",
                valuationAnalysis="", newsDigest="",
                conclusion="Please try again later",
            )

    @staticmethod
    def _strip_code_fences(text: str) -> str:
        """Strip markdown code fences from JSON response."""
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        return text.strip()

    async def analyze_stream(
        self, symbol, stock_name, profile_data, financials_data, news_data
    ) -> AsyncGenerator[tuple[str, object], None]:
        user_msg = self._build_context(symbol, stock_name, profile_data, financials_data, news_data)
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": ANALYSIS_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=2048,
                stream=True,
            )
            yielded: set[str] = set()
            buffer = ""
            async for chunk in stream:
                delta = chunk.choices[0].delta
                if delta.content:
                    buffer += delta.content
                    # Try stripping code fences for models that wrap JSON
                    clean = self._strip_code_fences(buffer)
                    try:
                        data = json.loads(clean)
                        for key, value in data.items():
                            if key not in yielded:
                                yielded.add(key)
                                yield key, value
                    except json.JSONDecodeError:
                        pass
            # Final parse attempt
            clean = self._strip_code_fences(buffer)
            try:
                data = json.loads(clean)
                for key, value in data.items():
                    if key not in yielded:
                        yielded.add(key)
                        yield key, value
            except json.JSONDecodeError:
                logger.error("Custom analyze_stream(%s) failed to parse final JSON", symbol)
        except Exception as e:
            logger.error("Custom analyze_stream(%s) failed: %s", symbol, e)
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
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": NEWS_ANALYSIS_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=1024,
            )
            content_text = response.choices[0].message.content
            if "```json" in content_text:
                content_text = content_text.split("```json")[1].split("```")[0]
            elif "```" in content_text:
                content_text = content_text.split("```")[1].split("```")[0]
            return json.loads(content_text.strip())
        except Exception as e:
            logger.error("Custom provider analyze_news_item failed: %s", e)
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
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": REPORT_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=4096,
            )
            content = response.choices[0].message.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            data = json.loads(content.strip())
            return AIReport(
                sections=[AIReportSection(**s) for s in data["sections"]],
                generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
        except Exception as e:
            logger.error("Custom provider report(%s) failed: %s", symbol, e)
            return AIReport(
                sections=[AIReportSection(title="Error", content="Report generation failed.")],
                generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
