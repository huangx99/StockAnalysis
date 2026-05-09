import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from models.auth import UserPublic

DATA_FILE = Path(__file__).parent.parent / "data" / "auth_store.json"
security = HTTPBearer(auto_error=False)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _load() -> dict[str, Any]:
    if not DATA_FILE.exists():
        return {"users": [], "watchlists": [], "watchlistItems": [], "templates": [], "monitorRules": [], "monitorHits": []}
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("auth store must be an object")
        data.setdefault("users", [])
        data.setdefault("watchlists", [])
        data.setdefault("watchlistItems", [])
        data.setdefault("templates", [])
        data.setdefault("monitorRules", [])
        data.setdefault("monitorHits", [])
        return data
    except Exception:
        return {"users": [], "watchlists": [], "watchlistItems": [], "templates": [], "monitorRules": [], "monitorHits": []}


def _save(data: dict[str, Any]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


def _public_user(user: dict[str, Any]) -> UserPublic:
    return UserPublic(
        id=user["id"],
        username=user["username"],
        email=user["email"],
        role=_role_for_user(user),
        isActive=bool(user.get("isActive", True)),
        createdAt=user.get("createdAt", ""),
        lastLoginAt=user.get("lastLoginAt", ""),
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _admin_username_set() -> set[str]:
    names = [settings.admin_username, *settings.admin_usernames]
    return {name.strip().lower() for name in names if name.strip()}


def _is_admin_username(username: str) -> bool:
    return username.strip().lower() in _admin_username_set()


def _role_for_user(user: dict[str, Any]) -> str:
    if _is_admin_username(str(user.get("username", ""))):
        return "admin"
    return user.get("role", "user")


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, password_hash.hex()


def _verify_password(password: str, salt: str, password_hash: str) -> bool:
    _, actual = _hash_password(password, salt)
    return hmac.compare_digest(actual, password_hash)


def _sign(payload: str) -> str:
    return hmac.new(settings.auth_secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _encode_json(data: dict[str, Any]) -> str:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_json(value: str) -> dict[str, Any]:
    padded = value + "=" * (-len(value) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("token payload must be object")
    return data


def create_access_token(user_id: str) -> str:
    expires_at = _utc_now() + timedelta(minutes=settings.auth_token_expire_minutes)
    payload = _encode_json({"sub": user_id, "exp": int(expires_at.timestamp())})
    return f"{payload}.{_sign(payload)}"


def decode_access_token(token: str) -> str:
    try:
        payload, signature = token.rsplit(".", 1)
        if not hmac.compare_digest(signature, _sign(payload)):
            raise ValueError("bad signature")
        data = _decode_json(payload)
        if int(data.get("exp", 0)) < int(_utc_now().timestamp()):
            raise ValueError("expired token")
        user_id = str(data.get("sub") or "")
        if not user_id:
            raise ValueError("missing subject")
        return user_id
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录") from exc


def ensure_seed_admin() -> None:
    data = _load()
    if data["users"]:
        return
    salt, password_hash = _hash_password(settings.admin_password)
    now = _now()
    user_id = secrets.token_hex(12)
    data["users"].append(
        {
            "id": user_id,
            "username": settings.admin_username,
            "email": _normalize_email(settings.admin_email),
            "passwordSalt": salt,
            "passwordHash": password_hash,
            "role": "admin",
            "isActive": True,
            "createdAt": now,
            "lastLoginAt": "",
        }
    )
    data["watchlists"].append(_default_watchlist(user_id))
    _save(data)


def register_user(username: str, email: str, password: str) -> UserPublic:
    data = _load()
    username = username.strip()
    email = _normalize_email(email)
    if any(item.get("username", "").lower() == username.lower() for item in data["users"]):
        raise HTTPException(status_code=409, detail="用户名已存在")
    if any(item.get("email", "").lower() == email for item in data["users"]):
        raise HTTPException(status_code=409, detail="邮箱已注册")
    salt, password_hash = _hash_password(password)
    now = _now()
    user = {
        "id": secrets.token_hex(12),
        "username": username,
        "email": email,
        "passwordSalt": salt,
        "passwordHash": password_hash,
        "role": "admin" if _is_admin_username(username) else "user",
        "isActive": True,
        "createdAt": now,
        "lastLoginAt": "",
    }
    data["users"].append(user)
    data["watchlists"].append(_default_watchlist(user["id"]))
    _save(data)
    return _public_user(user)


def authenticate(account: str, password: str) -> UserPublic:
    data = _load()
    account_norm = account.strip().lower()
    for user in data["users"]:
        if user.get("username", "").lower() == account_norm or user.get("email", "").lower() == account_norm:
            if not user.get("isActive", True):
                raise HTTPException(status_code=403, detail="账号已被禁用")
            if not _verify_password(password, user.get("passwordSalt", ""), user.get("passwordHash", "")):
                break
            if _is_admin_username(str(user.get("username", ""))):
                user["role"] = "admin"
            user["lastLoginAt"] = _now()
            _save(data)
            return _public_user(user)
    raise HTTPException(status_code=401, detail="账号或密码错误")


def get_user(user_id: str) -> UserPublic | None:
    data = _load()
    for user in data["users"]:
        if user.get("id") == user_id:
            return _public_user(user)
    return None


async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> UserPublic:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user_id = decode_access_token(credentials.credentials)
    user = get_user(user_id)
    if user is None or not user.isActive:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不可用，请重新登录")
    return user


async def require_admin(user: UserPublic = Depends(get_current_user)) -> UserPublic:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def list_users() -> list[UserPublic]:
    data = _load()
    return [_public_user(user) for user in data["users"]]


def count_users() -> int:
    data = _load()
    return len(data["users"])


def update_user(user_id: str, updates: dict[str, Any]) -> UserPublic:
    data = _load()
    for user in data["users"]:
        if user.get("id") == user_id:
            if updates.get("role") is not None:
                user["role"] = updates["role"]
            if updates.get("isActive") is not None:
                user["isActive"] = bool(updates["isActive"])
            _save(data)
            return _public_user(user)
    raise HTTPException(status_code=404, detail="用户不存在")


def update_current_user_profile(user_id: str, updates: dict[str, Any]) -> UserPublic:
    data = _load()
    user = next((item for item in data["users"] if item.get("id") == user_id), None)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    email = updates.get("email")
    if email is not None:
        email = _normalize_email(str(email))
        if any(item.get("id") != user_id and item.get("email", "").lower() == email for item in data["users"]):
            raise HTTPException(status_code=409, detail="邮箱已注册")
        user["email"] = email

    _save(data)
    return _public_user(user)


def change_current_user_password(user_id: str, current_password: str, new_password: str) -> None:
    data = _load()
    user = next((item for item in data["users"] if item.get("id") == user_id), None)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not _verify_password(current_password, user.get("passwordSalt", ""), user.get("passwordHash", "")):
        raise HTTPException(status_code=403, detail="当前密码不正确")
    salt, password_hash = _hash_password(new_password)
    user["passwordSalt"] = salt
    user["passwordHash"] = password_hash
    _save(data)


def _default_watchlist(user_id: str) -> dict[str, Any]:
    now = _now()
    return {
        "id": secrets.token_hex(12),
        "userId": user_id,
        "name": "默认分组",
        "description": "系统创建的默认自选股分组",
        "sortOrder": 0,
        "isDefault": True,
        "createdAt": now,
        "updatedAt": now,
    }


def _user_watchlists(data: dict[str, Any], user_id: str) -> list[dict[str, Any]]:
    lists = [item for item in data["watchlists"] if item.get("userId") == user_id]
    if not lists:
        default = _default_watchlist(user_id)
        data["watchlists"].append(default)
        _save(data)
        lists = [default]
    return lists


def list_watchlists(user_id: str) -> list[dict[str, Any]]:
    data = _load()
    watchlists = _user_watchlists(data, user_id)
    items = [item for item in data["watchlistItems"] if item.get("userId") == user_id]
    result = []
    for watchlist in sorted(watchlists, key=lambda item: (item.get("sortOrder", 0), item.get("createdAt", ""))):
        current_items = [item for item in items if item.get("watchlistId") == watchlist.get("id")]
        result.append({**watchlist, "items": sorted(current_items, key=lambda item: (item.get("sortOrder", 0), item.get("createdAt", "")))})
    return result


def create_watchlist(user_id: str, name: str, description: str = "") -> dict[str, Any]:
    data = _load()
    now = _now()
    item = {
        "id": secrets.token_hex(12),
        "userId": user_id,
        "name": name.strip(),
        "description": description.strip(),
        "sortOrder": len(_user_watchlists(data, user_id)),
        "isDefault": False,
        "createdAt": now,
        "updatedAt": now,
    }
    data["watchlists"].append(item)
    _save(data)
    return {**item, "items": []}


def update_watchlist(user_id: str, watchlist_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    for watchlist in data["watchlists"]:
        if watchlist.get("id") == watchlist_id and watchlist.get("userId") == user_id:
            if updates.get("name") is not None:
                watchlist["name"] = updates["name"].strip()
            if updates.get("description") is not None:
                watchlist["description"] = updates["description"].strip()
            if updates.get("sortOrder") is not None:
                watchlist["sortOrder"] = int(updates["sortOrder"])
            watchlist["updatedAt"] = _now()
            _save(data)
            return {**watchlist, "items": [item for item in data["watchlistItems"] if item.get("watchlistId") == watchlist_id]}
    raise HTTPException(status_code=404, detail="自选股分组不存在")


def delete_watchlist(user_id: str, watchlist_id: str) -> None:
    data = _load()
    watchlist = next((item for item in data["watchlists"] if item.get("id") == watchlist_id and item.get("userId") == user_id), None)
    if watchlist is None:
        raise HTTPException(status_code=404, detail="自选股分组不存在")
    if watchlist.get("isDefault"):
        raise HTTPException(status_code=400, detail="默认分组不能删除")
    data["watchlists"] = [item for item in data["watchlists"] if item.get("id") != watchlist_id]
    data["watchlistItems"] = [item for item in data["watchlistItems"] if item.get("watchlistId") != watchlist_id]
    _save(data)


def add_watchlist_item(user_id: str, watchlist_id: str | None, item: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    watchlists = _user_watchlists(data, user_id)
    target_id = watchlist_id or watchlists[0]["id"]
    if not any(w.get("id") == target_id and w.get("userId") == user_id for w in watchlists):
        raise HTTPException(status_code=404, detail="自选股分组不存在")
    stock_code = item["stockCode"].strip()
    existing = next((w for w in data["watchlistItems"] if w.get("userId") == user_id and w.get("watchlistId") == target_id and w.get("stockCode") == stock_code), None)
    now = _now()
    if existing:
        existing.update({"stockName": item.get("stockName", existing.get("stockName", "")), "market": item.get("market", existing.get("market", "")), "updatedAt": now})
        _save(data)
        return existing
    new_item = {
        "id": secrets.token_hex(12),
        "watchlistId": target_id,
        "userId": user_id,
        "stockCode": stock_code,
        "stockName": item.get("stockName", ""),
        "market": item.get("market", ""),
        "note": item.get("note", ""),
        "tags": item.get("tags", []),
        "sortOrder": len([w for w in data["watchlistItems"] if w.get("watchlistId") == target_id]),
        "createdAt": now,
        "updatedAt": now,
    }
    data["watchlistItems"].append(new_item)
    _save(data)
    return new_item


def update_watchlist_item(user_id: str, item_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    for item in data["watchlistItems"]:
        if item.get("id") == item_id and item.get("userId") == user_id:
            if updates.get("note") is not None:
                item["note"] = updates["note"]
            if updates.get("tags") is not None:
                item["tags"] = updates["tags"]
            if updates.get("sortOrder") is not None:
                item["sortOrder"] = int(updates["sortOrder"])
            item["updatedAt"] = _now()
            _save(data)
            return item
    raise HTTPException(status_code=404, detail="自选股不存在")


def delete_watchlist_item(user_id: str, item_id: str) -> None:
    data = _load()
    before = len(data["watchlistItems"])
    data["watchlistItems"] = [item for item in data["watchlistItems"] if not (item.get("id") == item_id and item.get("userId") == user_id)]
    if len(data["watchlistItems"]) == before:
        raise HTTPException(status_code=404, detail="自选股不存在")
    _save(data)


def remove_watchlist_symbol(user_id: str, stock_code: str) -> None:
    data = _load()
    data["watchlistItems"] = [item for item in data["watchlistItems"] if not (item.get("userId") == user_id and item.get("stockCode") == stock_code)]
    _save(data)


def list_templates(user: UserPublic) -> list[dict[str, Any]]:
    data = _load()
    items = []
    for item in data["templates"]:
        if not item.get("isActive", True):
            continue
        if item.get("templateType") in {"system", "shared"} or item.get("ownerUserId") == user.id or user.role == "admin":
            items.append(item)
    return sorted(items, key=lambda item: (item.get("templateType") != "system", item.get("updatedAt", "")))


def create_template(user: UserPublic, body: dict[str, Any]) -> dict[str, Any]:
    template_type = body.get("templateType", "private")
    if template_type == "system" and user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建系统模板")
    now = _now()
    item = {
        "id": secrets.token_hex(12),
        "ownerUserId": user.id,
        "name": body["name"].strip(),
        "description": body.get("description", "").strip(),
        "templateType": template_type,
        "category": body.get("category", "screener"),
        "content": body.get("content", {}),
        "isActive": True,
        "createdAt": now,
        "updatedAt": now,
    }
    data = _load()
    data["templates"].append(item)
    _save(data)
    return item


def update_template(user: UserPublic, template_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    for item in data["templates"]:
        if item.get("id") != template_id:
            continue
        if item.get("ownerUserId") != user.id and user.role != "admin":
            raise HTTPException(status_code=403, detail="不能修改其他用户的模板")
        if updates.get("templateType") == "system" and user.role != "admin":
            raise HTTPException(status_code=403, detail="只有管理员可以设置系统模板")
        for source, target in [("name", "name"), ("description", "description"), ("templateType", "templateType"), ("category", "category"), ("content", "content"), ("isActive", "isActive")]:
            if updates.get(source) is not None:
                item[target] = updates[source]
        item["updatedAt"] = _now()
        _save(data)
        return item
    raise HTTPException(status_code=404, detail="模板不存在")


def delete_template(user: UserPublic, template_id: str) -> None:
    data = _load()
    for item in data["templates"]:
        if item.get("id") != template_id:
            continue
        if item.get("ownerUserId") != user.id and user.role != "admin":
            raise HTTPException(status_code=403, detail="不能删除其他用户的模板")
        item["isActive"] = False
        item["updatedAt"] = _now()
        _save(data)
        return
    raise HTTPException(status_code=404, detail="模板不存在")


def copy_template(user: UserPublic, template_id: str) -> dict[str, Any]:
    data = _load()
    source = next((item for item in data["templates"] if item.get("id") == template_id and item.get("isActive", True)), None)
    if source is None:
        raise HTTPException(status_code=404, detail="模板不存在")
    if source.get("ownerUserId") != user.id and source.get("templateType") not in {"system", "shared"} and user.role != "admin":
        raise HTTPException(status_code=403, detail="不能复制该模板")
    return create_template(
        user,
        {
            "name": f"{source.get('name', '模板')} 副本",
            "description": source.get("description", ""),
            "templateType": "private",
            "category": source.get("category", "screener"),
            "content": source.get("content", {}),
        },
    )


# ── Monitor Rules ──


def list_monitor_rules(user_id: str) -> list[dict[str, Any]]:
    data = _load()
    return [r for r in data["monitorRules"] if r.get("userId") == user_id]


def get_all_enabled_rules() -> list[dict[str, Any]]:
    data = _load()
    return [r for r in data["monitorRules"] if r.get("enabled", True)]


def get_monitor_rule(rule_id: str, user_id: str) -> dict[str, Any]:
    data = _load()
    rule = next((r for r in data["monitorRules"] if r.get("id") == rule_id and r.get("userId") == user_id), None)
    if rule is None:
        raise HTTPException(status_code=404, detail="监控规则不存在")
    return rule


def create_monitor_rule(user_id: str, body: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    now = _now()
    rule = {
        "id": secrets.token_hex(8),
        "userId": user_id,
        "name": body.get("name", "").strip() or "未命名规则",
        "searchKeywords": body.get("searchKeywords", body.get("keywords", [])),
        "conditionTree": body.get("conditionTree", None),
        "emailEnabled": bool(body.get("emailEnabled", False)),
        "emailOnMatch": bool(body.get("emailOnMatch", True)),
        "intervalMinutes": int(body.get("intervalMinutes", 10)),
        "dndStart": body.get("dndStart", ""),
        "dndEnd": body.get("dndEnd", ""),
        "enabled": True,
        "createdAt": now,
        "updatedAt": now,
    }
    data["monitorRules"].append(rule)
    _save(data)
    return rule


def update_monitor_rule(rule_id: str, user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    data = _load()
    rule = next((r for r in data["monitorRules"] if r.get("id") == rule_id and r.get("userId") == user_id), None)
    if rule is None:
        raise HTTPException(status_code=404, detail="监控规则不存在")
    for key in ("name", "searchKeywords", "conditionTree", "emailEnabled", "emailOnMatch",
                "intervalMinutes", "dndStart", "dndEnd", "enabled", "lastRunAt",
                # backward compat
                "keywords", "excludeKeywords", "categories", "sentimentFilter",
                "minImportance", "emailOnNegative", "emailOnHighImportance"):
        if key in updates:
            rule[key] = updates[key]
    rule["updatedAt"] = _now()
    _save(data)
    return rule


def delete_monitor_rule(rule_id: str, user_id: str) -> None:
    data = _load()
    before = len(data["monitorRules"])
    data["monitorRules"] = [r for r in data["monitorRules"] if not (r.get("id") == rule_id and r.get("userId") == user_id)]
    if len(data["monitorRules"]) == before:
        raise HTTPException(status_code=404, detail="监控规则不存在")
    data["monitorHits"] = [h for h in data["monitorHits"] if h.get("ruleId") != rule_id]
    _save(data)


# ── Monitor Hits ──


def list_monitor_hits(user_id: str, rule_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    data = _load()
    hits = [h for h in data["monitorHits"] if h.get("userId") == user_id]
    if rule_id:
        hits = [h for h in hits if h.get("ruleId") == rule_id]
    hits.sort(key=lambda x: x.get("seenAt", ""), reverse=True)
    return hits[:limit]


def add_monitor_hits(hits: list[dict[str, Any]]) -> int:
    if not hits:
        return 0
    data = _load()
    existing_ids = {h.get("newsId") for h in data["monitorHits"]}
    new_hits = [h for h in hits if h.get("newsId") not in existing_ids]
    if not new_hits:
        return 0
    data["monitorHits"].extend(new_hits)
    _save(data)
    return len(new_hits)


def add_monitor_hits_and_get_new(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add hits and return only the newly added ones (dedup by newsId+ruleId)."""
    if not hits:
        return []
    data = _load()
    existing_keys = {(h.get("newsId", ""), h.get("ruleId", "")) for h in data["monitorHits"]}
    new_hits = []
    for h in hits:
        key = (h.get("newsId", ""), h.get("ruleId", ""))
        if key not in existing_keys:
            new_hits.append(h)
            existing_keys.add(key)
    if not new_hits:
        return []
    data["monitorHits"].extend(new_hits)
    _save(data)
    return new_hits


def get_monitor_stats(user_id: str) -> dict[str, Any]:
    data = _load()
    rules = [r for r in data["monitorRules"] if r.get("userId") == user_id]
    hits = [h for h in data["monitorHits"] if h.get("userId") == user_id]
    today = _now()[:10]
    today_hits = [h for h in hits if h.get("seenAt", "").startswith(today)]
    alerted = [h for h in hits if h.get("alerted")]
    return {
        "ruleCount": len(rules),
        "enabledRuleCount": len([r for r in rules if r.get("enabled", True)]),
        "totalHits": len(hits),
        "todayHits": len(today_hits),
        "alertedCount": len(alerted),
    }


def cleanup_old_hits(days: int = 7) -> int:
    data = _load()
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    before = len(data["monitorHits"])
    data["monitorHits"] = [h for h in data["monitorHits"] if h.get("seenAt", "") >= cutoff]
    removed = before - len(data["monitorHits"])
    if removed:
        _save(data)
    return removed
