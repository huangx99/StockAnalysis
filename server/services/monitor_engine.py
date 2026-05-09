"""Monitor engine - rule-based news monitoring with condition tree evaluation."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta

import services.auth_store as auth_store
from services.email_service import send_alert_email
from services.news_sentiment_service import search_news_with_sentiment

logger = logging.getLogger(__name__)

_shutdown = False


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _is_in_dnd(dnd_start: str, dnd_end: str) -> bool:
    """Check if current time is within do-not-disturb range. Supports overnight ranges like 23:00-08:00."""
    if not dnd_start or not dnd_end:
        return False
    try:
        now = datetime.now()
        now_minutes = now.hour * 60 + now.minute
        sh, sm = map(int, dnd_start.split(":"))
        eh, em = map(int, dnd_end.split(":"))
        start_minutes = sh * 60 + sm
        end_minutes = eh * 60 + em
        if start_minutes <= end_minutes:
            return start_minutes <= now_minutes < end_minutes
        else:
            return now_minutes >= start_minutes or now_minutes < end_minutes
    except (ValueError, AttributeError):
        return False


# ── Condition Tree Evaluation ──


def get_field_value(item: dict, field: str):
    """Extract a field value from a news item for rule evaluation."""
    if field == "title":
        return item.get("title", "")
    if field == "content":
        return item.get("content", "")
    if field == "source":
        return item.get("source", "")
    if field == "sentiment":
        return item.get("sentiment", "neutral")
    if field == "importance":
        return item.get("importance", 0)
    if field == "sentimentScore":
        return item.get("sentimentScore", 50)
    if field == "topic":
        return ",".join(item.get("topics", []))
    if field == "matchedKeyword":
        return item.get("matchedKeyword", "")
    if field == "publishTime":
        return item.get("publishTime", "")
    if field == "seenAt":
        return item.get("seenAt", _now_str())
    if field == "category":
        return item.get("category", "")
    return ""


def _parse_datetime(s: str) -> datetime | None:
    """Try parsing various datetime formats."""
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%m-%d %H:%M"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return None


def evaluate_operator(field_value, operator: str, target_value) -> bool:
    """Evaluate a single condition: field_value OPERATOR target_value."""
    try:
        # Date operators
        if operator in ("within_hours", "within_days", "today", "after", "before"):
            return _evaluate_date(field_value, operator, target_value)

        # String operators
        if operator in ("contains", "not_contains", "eq", "neq", "regex", "in"):
            return _evaluate_string(field_value, operator, target_value)

        # Numeric operators
        if operator in ("gt", "gte", "lt", "lte"):
            return _evaluate_number(field_value, operator, target_value)

    except Exception as e:
        logger.debug("evaluate_operator error: %s", e)
    return False


def _evaluate_date(field_value, operator: str, target_value) -> bool:
    """Evaluate date/time conditions."""
    dt = _parse_datetime(str(field_value))
    if dt is None:
        return False
    now = datetime.now()

    if operator == "within_hours":
        hours = float(target_value) if target_value else 24
        return (now - dt).total_seconds() < hours * 3600

    if operator == "within_days":
        days = float(target_value) if target_value else 1
        return (now - dt).total_seconds() < days * 86400

    if operator == "today":
        return dt.date() == now.date()

    if operator == "after":
        target = _parse_datetime(str(target_value))
        return target is not None and dt >= target

    if operator == "before":
        target = _parse_datetime(str(target_value))
        return target is not None and dt <= target

    return False


def _evaluate_string(field_value, operator: str, target_value) -> bool:
    """Evaluate string conditions."""
    fv = str(field_value).lower()
    tv = str(target_value).lower()

    if operator == "contains":
        return tv in fv

    if operator == "not_contains":
        return tv not in fv

    if operator == "eq":
        return fv == tv

    if operator == "neq":
        return fv != tv

    if operator == "regex":
        try:
            return bool(re.search(str(target_value), str(field_value), re.IGNORECASE))
        except re.error:
            return False

    if operator == "in":
        values = {v.strip().lower() for v in str(target_value).split(",") if v.strip()}
        return fv in values

    return False


def _evaluate_number(field_value, operator: str, target_value) -> bool:
    """Evaluate numeric conditions."""
    try:
        fv = float(field_value)
        tv = float(target_value)
    except (ValueError, TypeError):
        return False

    if operator == "gt":
        return fv > tv
    if operator == "gte":
        return fv >= tv
    if operator == "lt":
        return fv < tv
    if operator == "lte":
        return fv <= tv
    return False


def evaluate_condition_tree(node: dict, item: dict) -> bool:
    """Recursively evaluate a condition tree against a news item."""
    if not node or not isinstance(node, dict):
        return True

    node_type = node.get("type", "condition")

    if node_type == "group":
        logic = node.get("logic", "AND")
        conditions = node.get("conditions", [])
        if not conditions:
            return True
        results = [evaluate_condition_tree(c, item) for c in conditions]
        return all(results) if logic == "AND" else any(results)

    if node_type == "condition":
        field = node.get("field", "")
        operator = node.get("operator", "contains")
        value = node.get("value", "")
        if not field:
            return True
        field_value = get_field_value(item, field)
        return evaluate_operator(field_value, operator, value)

    return True


def _migrate_rule(rule: dict) -> dict:
    """Convert old-style rule (keywords/categories/sentimentFilter) to conditionTree format."""
    if rule.get("conditionTree"):
        return rule

    conditions = []

    # sentimentFilter → condition
    sf = rule.get("sentimentFilter", "all")
    if sf and sf != "all":
        conditions.append({"type": "condition", "field": "sentiment", "operator": "eq", "value": sf})

    # minImportance → condition
    mi = rule.get("minImportance")
    if mi and mi > 0:
        conditions.append({"type": "condition", "field": "importance", "operator": "gte", "value": mi})

    # categories → OR group
    cats = rule.get("categories", [])
    if cats:
        cat_conditions = [{"type": "condition", "field": "topic", "operator": "contains", "value": c} for c in cats]
        if len(cat_conditions) == 1:
            conditions.append(cat_conditions[0])
        else:
            conditions.append({"type": "group", "logic": "OR", "conditions": cat_conditions})

    # excludeKeywords → NOT conditions
    excludes = rule.get("excludeKeywords", [])
    for ex in excludes:
        conditions.append({"type": "condition", "field": "title", "operator": "not_contains", "value": ex})

    if conditions:
        rule["conditionTree"] = {"type": "group", "logic": "AND", "conditions": conditions}

    # keywords → searchKeywords
    if not rule.get("searchKeywords"):
        rule["searchKeywords"] = rule.get("keywords", [])

    return rule


# ── Search & Filter ──


async def search_and_filter(rule: dict) -> list[dict]:
    """Search for a single rule and apply condition tree filtering."""
    rule = _migrate_rule(rule)
    keywords = rule.get("searchKeywords", rule.get("keywords", []))
    if not keywords:
        return []

    condition_tree = rule.get("conditionTree")
    all_hits = []

    for keyword in keywords:
        try:
            result = await search_news_with_sentiment(keyword, limit=20)
            items = result.get("items", [])
            for item in items:
                # Apply condition tree
                if condition_tree and not evaluate_condition_tree(condition_tree, item):
                    continue

                all_hits.append({
                    **item,
                    "matchedKeyword": keyword,
                    "ruleId": rule["id"],
                    "userId": rule["userId"],
                    "newsId": item.get("id", ""),
                    "seenAt": _now_str(),
                    "alerted": False,
                })
        except Exception as e:
            logger.warning("Search failed for rule '%s' keyword '%s': %s", rule.get("name"), keyword, e)

    return all_hits


# ── Monitor Loop ──


async def run_monitor_cycle() -> None:
    """Run one monitoring cycle for all enabled rules."""
    rules = auth_store.get_all_enabled_rules()
    if not rules:
        return

    now = datetime.now()
    total_new = 0

    for rule in rules:
        interval = rule.get("intervalMinutes", 10)
        last_run = rule.get("lastRunAt", "")
        if last_run:
            try:
                last_dt = datetime.strptime(last_run, "%Y-%m-%d %H:%M:%S")
                if (now - last_dt).total_seconds() < interval * 60:
                    continue
            except ValueError:
                pass

        keywords = rule.get("searchKeywords", rule.get("keywords", []))
        logger.info("Running monitor rule: %s (keywords: %s)", rule.get("name"), keywords)

        hits = await search_and_filter(rule)
        new_hits = auth_store.add_monitor_hits_and_get_new(hits)
        new_count = len(new_hits)
        total_new += new_count

        auth_store.update_monitor_rule(rule["id"], rule["userId"], {"lastRunAt": _now_str()})

        if new_count > 0:
            logger.info("Rule '%s': %d new hits", rule.get("name"), new_count)

            if rule.get("emailEnabled"):
                dnd_start = rule.get("dndStart", "")
                dnd_end = rule.get("dndEnd", "")
                if _is_in_dnd(dnd_start, dnd_end):
                    logger.info("Rule '%s': in DND period (%s-%s), skip email", rule.get("name"), dnd_start, dnd_end)
                else:
                    user = auth_store.get_user(rule["userId"])
                    if user and user.email:
                        send_alert_email(user.email, rule.get("name", ""), new_hits)

    if total_new:
        logger.info("Monitor cycle complete: %d total new hits", total_new)


async def monitor_loop() -> None:
    """Background loop that runs every 60 seconds."""
    global _shutdown
    logger.info("Monitor engine started")
    await asyncio.sleep(30)

    while not _shutdown:
        try:
            await run_monitor_cycle()
        except Exception as e:
            logger.exception("Monitor cycle error: %s", e)
        await asyncio.sleep(60)

    logger.info("Monitor engine stopped")


def stop_monitor() -> None:
    global _shutdown
    _shutdown = True
