import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.ai import AIAnalysis, AIReport, AIReportSection
from services import stock_service, ai_service
from services.ai_service import AIConfigError

router = APIRouter(prefix="/api", tags=["ai"])


def _ai_not_configured_analysis(symbol: str, stock_name: str) -> AIAnalysis:
    return AIAnalysis(
        summary=f"{stock_name}（{symbol}）AI 分析服务未配置",
        score=0,
        style="未知",
        highlights=[],
        risks=["AI 服务未配置 API Key，请在设置页面配置"],
        companyOverview="",
        marketPerformance="",
        financialPerformance="",
        valuationAnalysis="",
        newsDigest="",
        conclusion="请在设置页面配置 AI 服务后重试",
    )


@router.post("/stock/{symbol}/analyze", response_model=AIAnalysis)
async def analyze(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financials = await stock_service.get_financials(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        return _ai_not_configured_analysis(symbol, profile.name)

    return await provider.analyze(
        symbol=symbol,
        stock_name=profile.name,
        profile_data=profile.model_dump(),
        financials_data=[f.model_dump() for f in financials],
        news_data=[n.model_dump() for n in news],
    )


@router.post("/stock/{symbol}/analyze/stream")
async def analyze_stream(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financials = await stock_service.get_financials(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        async def not_configured():
            fallback = _ai_not_configured_analysis(symbol, profile.name)
            for field_name, value in fallback.model_dump().items():
                yield f"data: {json.dumps({'field': field_name, 'value': value}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'field': '__done__'}, ensure_ascii=False)}\n\n"
        return StreamingResponse(not_configured(), media_type="text/event-stream")

    async def event_generator():
        try:
            async for field_name, value in provider.analyze_stream(
                symbol=symbol,
                stock_name=profile.name,
                profile_data=profile.model_dump(),
                financials_data=[f.model_dump() for f in financials],
                news_data=[n.model_dump() for n in news],
            ):
                yield f"data: {json.dumps({'field': field_name, 'value': value}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'field': '__done__'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'field': '__error__', 'value': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/stock/{symbol}/report", response_model=AIReport)
async def report(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financials = await stock_service.get_financials(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        return AIReport(
            sections=[
                AIReportSection(
                    title="AI 服务未配置",
                    content="请在 server/.env 中配置 STOCK_ANTHROPIC_API_KEY 或其他 AI 提供商的密钥后重启服务。",
                )
            ],
            generatedAt="",
        )

    return await provider.report(
        symbol=symbol,
        stock_name=profile.name,
        profile_data=profile.model_dump(),
        financials_data=[f.model_dump() for f in financials],
        news_data=[n.model_dump() for n in news],
    )
