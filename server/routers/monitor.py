"""Monitor rules and hits API endpoints."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from models.auth import UserPublic
from services import auth_store
from services.ai_service import get_ai_provider, AIConfigError
from services.monitor_engine import search_and_filter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/monitor", tags=["monitor"])


RULE_GENERATE_SYSTEM = """你是一个新闻监控规则生成器。用户会用自然语言描述想监控的内容，你需要将其转换为结构化的监控规则。

你需要返回一个 JSON 对象，包含两个字段：

{
  "searchKeywords": ["关键词1", "关键词2"],
  "conditionTree": { ... }
}

## searchKeywords — 搜索触发词
用于去外部新闻源搜索的关键词（2-5个）。应该填**实体词**（行业名、公司名、政策名等），不要填情绪词或修饰词。

## conditionTree — 过滤条件树
搜索结果返回后，用条件树筛选出真正关心的新闻。**情绪、重要度、时间等判断逻辑必须放在这里，不要放进 searchKeywords。**

条件树有两种节点：

### 条件节点（叶子）
{"type": "condition", "field": "字段名", "operator": "运算符", "value": "值"}

### 条件组（分支）
{"type": "group", "logic": "AND" 或 "OR", "conditions": [子条件...]}

## 可用字段 (field)
| field | 含义 | 值类型 | 说明 |
|-------|------|--------|------|
| title | 标题 | string | 新闻标题文本 |
| content | 正文 | string | 新闻正文文本 |
| source | 来源 | string | 如：东方财富、新浪财经 |
| sentiment | 情绪 | enum | positive(利好) / neutral(中性) / negative(利空) |
| category | 分类 | enum | policy(政策法规) / market(市场动态) / finance(财经新闻) / regulation(监管公告) / bulletin(政府公报) / directive(通知意见) / industry(行业资讯) / macro(宏观数据) |
| importance | 重要度 | number | 0-100，越高越重要 |
| sentimentScore | 情绪分数 | number | 0-100，>50偏利好，<50偏利空 |
| topic | 话题 | string | 新闻话题标签 |
| matchedKeyword | 命中关键词 | string | 搜索时命中的关键词 |
| publishTime | 发布时间 | date | 新闻发布时间 |

## 可用运算符 (operator)
| 运算符 | 含义 | 适用类型 |
|--------|------|----------|
| contains | 包含 | string |
| not_contains | 不包含 | string |
| eq | 等于 | string, number, enum |
| neq | 不等于 | string, enum |
| gt | 大于 | number |
| gte | 大于等于 | number |
| lt | 小于 | number |
| lte | 小于等于 | number |
| in | 逗号分隔列表中 | string |
| regex | 正则匹配 | string |
| within_hours | 最近N小时 | date (value填小时数) |
| within_days | 最近N天 | date (value填天数) |
| today | 今天 | date (无需value) |
| after | 晚于某时间 | date (value填YYYY-MM-DD) |
| before | 早于某时间 | date (value填YYYY-MM-DD) |

## 语义映射规则（非常重要！）
用户说的自然语言必须正确映射到字段，以下是常见映射：

| 用户表达 | 正确映射 | 错误映射 |
|----------|----------|----------|
| 利好/利好XX | sentiment = positive | ~~title contains "利好"~~ |
| 利空/利空XX | sentiment = negative | ~~title contains "利空"~~ |
| 重大/重要 | importance >= 70 | ~~title contains "重大"~~ |
| 高重要度 | importance >= 80 | — |
| 最近N小时/天 | publishTime within_hours/within_days | — |
| XX行业/板块 | topic contains "XX" 或 searchKeywords含"XX" | ~~title contains "XX行业"~~ |
| 某公司/股票名 | searchKeywords含该公司名 | — |
| 政策/监管 | title或topic contains "政策" | — |
| 不看/排除XX | title not_contains "XX" | — |
| 政策法规 | category = "policy" | ~~title contains "政策"~~ |
| 监管公告 | category = "regulation" | — |
| 政府公报 | category = "bulletin" | — |

## 示例

用户："利好计算机"
→ searchKeywords 填行业实体词，conditionTree 用 sentiment=positive
{
  "searchKeywords": ["计算机", "IT", "软件"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "sentiment", "operator": "eq", "value": "positive"}
    ]
  }
}

用户："利空半导体，重要度大于70"
{
  "searchKeywords": ["半导体", "芯片"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "sentiment", "operator": "eq", "value": "negative"},
      {"type": "condition", "field": "importance", "operator": "gte", "value": 70}
    ]
  }
}

用户："最近24小时新能源汽车政策"
{
  "searchKeywords": ["新能源汽车", "新能源车", "电动车"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "publishTime", "operator": "within_hours", "value": 24},
      {"type": "condition", "field": "title", "operator": "contains", "value": "政策"}
    ]
  }
}

用户："监控茅台和宁德时代的负面新闻"
{
  "searchKeywords": ["茅台", "宁德时代"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "sentiment", "operator": "eq", "value": "negative"}
    ]
  }
}

用户："半导体或芯片行业利好，排除研报"
{
  "searchKeywords": ["半导体", "芯片"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "sentiment", "operator": "eq", "value": "positive"},
      {"type": "condition", "field": "title", "operator": "not_contains", "value": "研报"}
    ]
  }
}

用户："监控房地产政策变化"
→ 政策类新闻，searchKeywords用政策实体词，conditionTree用category=policy
{
  "searchKeywords": ["房地产", "楼市", "住建部"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "category", "operator": "eq", "value": "policy"}
    ]
  }
}

用户："央行货币政策动态"
{
  "searchKeywords": ["央行", "货币政策", "利率", "存款准备金"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "category", "operator": "in", "value": "policy,regulation,bulletin,directive"}
    ]
  }
}

用户："科技行业政策利好"
{
  "searchKeywords": ["科技", "半导体", "人工智能"],
  "conditionTree": {
    "type": "group", "logic": "AND",
    "conditions": [
      {"type": "condition", "field": "category", "operator": "eq", "value": "policy"},
      {"type": "condition", "field": "sentiment", "operator": "eq", "value": "positive"}
    ]
  }
}

## 规则
1. 只返回 JSON，不要有任何其他文字
2. 字段名和运算符必须用英文，情绪枚举值用英文：positive/neutral/negative
3. searchKeywords 填实体词（行业、公司、产品名），不要填"利好""利空"等情绪词
4. 利好/利空/中性 → 必须用 sentiment 字段，不要用 title contains
5. 重要度/重大 → 必须用 importance 字段
6. 时间要求 → 用 publishTime 字段
7. value 为数字时用 number 类型，不要加引号
8. 如果用户没有指定过滤条件，conditionTree 设为 {"type":"group","logic":"AND","conditions":[]}"""


@router.post("/rules/generate")
async def generate_rule(body: dict[str, Any], user: UserPublic = Depends(auth_store.get_current_user)):
    """Use AI to generate a monitor rule from natural language description."""
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="请提供规则描述")

    try:
        provider = get_ai_provider()
    except AIConfigError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        # Use the provider's client directly for a custom prompt
        if hasattr(provider.client, "chat"):
            # OpenAI-style (also covers Custom provider)
            resp = await provider.client.chat.completions.create(
                model=provider.model if hasattr(provider, "model") else "gpt-4o",
                messages=[
                    {"role": "system", "content": RULE_GENERATE_SYSTEM},
                    {"role": "user", "content": f"请根据以下描述生成监控规则：\n\n{description}"},
                ],
                max_tokens=1500,
                temperature=0.3,
            )
            raw = resp.choices[0].message.content or "{}"
        elif hasattr(provider.client, "messages"):
            # Anthropic-style
            resp = await provider.client.messages.create(
                model=provider.model if hasattr(provider, "model") else "claude-sonnet-4-20250514",
                max_tokens=1500,
                temperature=0.3,
                system=RULE_GENERATE_SYSTEM,
                messages=[{"role": "user", "content": f"请根据以下描述生成监控规则：\n\n{description}"}],
            )
            raw = resp.content[0].text if resp.content else "{}"
        else:
            raise HTTPException(status_code=503, detail="不支持的 AI 提供者类型")

        # Parse response - strip code fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        result = json.loads(raw)

        # Validate structure
        search_keywords = result.get("searchKeywords", [])
        condition_tree = result.get("conditionTree")

        if not isinstance(search_keywords, list):
            search_keywords = []
        if condition_tree and not isinstance(condition_tree, dict):
            condition_tree = None

        return {
            "ok": True,
            "searchKeywords": search_keywords,
            "conditionTree": condition_tree,
            "rawResponse": raw,
        }

    except json.JSONDecodeError:
        logger.warning("AI rule generation returned invalid JSON: %s", raw[:200])
        return {"ok": False, "error": "AI 返回的内容无法解析为规则，请重试或手动编辑", "rawResponse": raw}
    except Exception as e:
        logger.error("AI rule generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")


@router.get("/rules")
async def list_rules(user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.list_monitor_rules(user.id)


@router.post("/rules")
async def create_rule(body: dict[str, Any], user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.create_monitor_rule(user.id, body)


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.get_monitor_rule(rule_id, user.id)


@router.patch("/rules/{rule_id}")
async def update_rule(rule_id: str, body: dict[str, Any], user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.update_monitor_rule(rule_id, user.id, body)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.delete_monitor_rule(rule_id, user.id)
    return {"ok": True}


@router.get("/hits")
async def list_hits(
    ruleId: str = Query(""),
    limit: int = Query(50, ge=1, le=200),
    user: UserPublic = Depends(auth_store.get_current_user),
):
    return auth_store.list_monitor_hits(user.id, ruleId or None, limit)


@router.post("/rules/{rule_id}/test")
async def test_rule(rule_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    """Run a single search for the rule, return results, and send email if configured."""
    rule = auth_store.get_monitor_rule(rule_id, user.id)
    hits = await search_and_filter(rule)
    email_sent = False
    if hits and user.email:
        from services.email_service import send_alert_email
        email_sent = send_alert_email(user.email, rule.get("name", ""), hits)
    return {"hits": hits, "total": len(hits), "emailSent": email_sent}


@router.get("/stats")
async def get_stats(user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.get_monitor_stats(user.id)
