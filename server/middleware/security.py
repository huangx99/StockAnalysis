"""Security middleware - rate limiting, auth guard, request monitoring, anti-abuse."""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# Request log file
REQUEST_LOG_FILE = Path(__file__).parent.parent / "data" / "request_log.jsonl"


# ── Configuration ──

@dataclass
class RateLimitRule:
    max_requests: int
    window_seconds: int


@dataclass
class SecurityConfig:
    # Per-IP rate limits by path pattern
    rate_limits: dict[str, RateLimitRule] = field(default_factory=lambda: {
        "/api/news/sentiment/search": RateLimitRule(max_requests=10, window_seconds=60),
        "/api/monitor/rules/test": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/monitor/rules/generate": RateLimitRule(max_requests=5, window_seconds=60),
        # AI endpoints - strict limits
        "/api/stock/*/analyze": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/stock/*/report": RateLimitRule(max_requests=3, window_seconds=60),
        "/api/stock/*/news/analyze": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/market/analyze": RateLimitRule(max_requests=2, window_seconds=60),
        "/api/screener/formula/generate": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/screener/insight/ai": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/backtest/validate": RateLimitRule(max_requests=3, window_seconds=60),
        "default": RateLimitRule(max_requests=60, window_seconds=60),
    })
    # Search keyword constraints
    search_keyword_max_length: int = 100
    search_keyword_min_length: int = 1
    search_limit_max: int = 50

    # Paths that do NOT require authentication
    public_paths: set[str] = field(default_factory=lambda: {
        "/api/auth/login",
        "/api/auth/register",
        "/api/system/status",
    })
    # Path prefixes that do NOT require authentication
    public_prefixes: set[str] = field(default_factory=lambda: set())

    # SSRF proxy whitelist - only these domains can be fetched via /proxy/notice
    proxy_allowed_domains: set[str] = field(default_factory=lambda: {
        "cninfo.com.cn",
        "static.cninfo.com.cn",
        "www.cninfo.com.cn",
    })


CONFIG = SecurityConfig()


# ── Rate Limiter (in-memory, per-IP) ──

class _RateLimiter:
    """Sliding window rate limiter per IP address."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        now = time.monotonic()
        window_start = now - rule.window_seconds
        hits = self._hits[key]
        self._hits[key] = [t for t in hits if t > window_start]
        hits = self._hits[key]
        if len(hits) >= rule.max_requests:
            retry_after = int(hits[0] - window_start) + 1
            return False, max(retry_after, 1)
        hits.append(now)
        return True, 0

    def cleanup(self, max_age: float = 600) -> None:
        now = time.monotonic()
        expired = [k for k, v in self._hits.items() if not v or now - v[-1] > max_age]
        for k in expired:
            del self._hits[k]


_limiter = _RateLimiter()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _match_rate_limit(path: str) -> RateLimitRule:
    for pattern, rule in CONFIG.rate_limits.items():
        if pattern == "default":
            continue
        # Support wildcard matching: /api/stock/*/analyze matches /api/stock/600519/analyze
        if _path_matches(path, pattern):
            return rule
    return CONFIG.rate_limits["default"]


def _path_matches(path: str, pattern: str) -> bool:
    """Match path against pattern with wildcard support."""
    if "*" not in pattern:
        return path.startswith(pattern)
    # Convert pattern to segments and match
    p_parts = pattern.split("/")
    a_parts = path.split("/")
    if len(p_parts) != len(a_parts):
        return False
    for p, a in zip(p_parts, a_parts):
        if p == "*":
            continue
        if p != a:
            return False
    return True


def _is_public_path(path: str) -> bool:
    if path in CONFIG.public_paths:
        return True
    for prefix in CONFIG.public_prefixes:
        if path.startswith(prefix):
            return True
    return False


# ── Request Monitor ──

def _log_request(
    timestamp: str,
    client_ip: str,
    method: str,
    path: str,
    user_id: str,
    status_code: int,
    duration_ms: float,
) -> None:
    """Append a request record to the JSONL log file."""
    record = {
        "ts": timestamp,
        "ip": client_ip,
        "method": method,
        "path": path,
        "user": user_id or "anonymous",
        "status": status_code,
        "ms": round(duration_ms, 1),
    }
    try:
        REQUEST_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with REQUEST_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass  # Never let logging failure break requests


# ── Validation Helpers ──

def validate_search_keyword(keyword: str) -> str | None:
    keyword = keyword.strip()
    if not keyword:
        return "关键词不能为空"
    if len(keyword) < CONFIG.search_keyword_min_length:
        return f"关键词至少{CONFIG.search_keyword_min_length}个字符"
    if len(keyword) > CONFIG.search_keyword_max_length:
        return f"关键词不能超过{CONFIG.search_keyword_max_length}个字符"
    return None


def validate_search_limit(limit: int) -> int:
    return max(1, min(limit, CONFIG.search_limit_max))


# ── SSRF Protection ──

def validate_proxy_url(url: str) -> str | None:
    """Validate URL for proxy endpoint. Returns error message or None if valid."""
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
    except Exception:
        return "无效的URL"
    if parsed.scheme not in ("http", "https"):
        return "仅支持HTTP/HTTPS协议"
    host = parsed.hostname or ""
    # Block internal/private IPs
    if host in ("127.0.0.1", "localhost", "0.0.0.0", "::1", ""):
        return "不允许访问本地地址"
    if host.startswith("10.") or host.startswith("172.") or host.startswith("192.168.") or host.startswith("169.254."):
        return "不允许访问内网地址"
    # Check domain whitelist
    allowed = False
    for domain in CONFIG.proxy_allowed_domains:
        if host == domain or host.endswith("." + domain):
            allowed = True
            break
    if not allowed:
        return f"域名 {host} 不在白名单中"
    return None


# ── Middleware ──

class SecurityMiddleware(BaseHTTPMiddleware):
    """Global security: rate limiting + auth guard + request monitoring."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        client_ip = _get_client_ip(request)
        method = request.method
        t0 = time.monotonic()
        user_id = ""

        # OPTIONS requests pass through for CORS
        if method == "OPTIONS":
            return await call_next(request)

        # Only enforce on /api/* paths
        if path.startswith("/api/"):
            # 1. Rate limiting
            rule = _match_rate_limit(path)
            rate_key = f"{client_ip}:{path}"
            allowed, retry_after = _limiter.is_allowed(rate_key, rule)
            if not allowed:
                logger.warning("Rate limited: %s %s from %s (retry %ds)",
                               method, path, client_ip, retry_after)
                _log_request(datetime.now().isoformat(), client_ip, method, path,
                             user_id, 429, (time.monotonic() - t0) * 1000)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "请求过于频繁，请稍后再试", "code": "RATE_LIMITED"},
                    headers={"Retry-After": str(retry_after)},
                )

            # 2. Global auth guard - require login for all /api/* except public paths
            if not _is_public_path(path):
                auth_header = request.headers.get("authorization", "")
                if not auth_header.startswith("Bearer "):
                    _log_request(datetime.now().isoformat(), client_ip, method, path,
                                 user_id, 401, (time.monotonic() - t0) * 1000)
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "请先登录", "code": "UNAUTHORIZED"},
                    )
                token = auth_header[7:]
                try:
                    from services.auth_store import decode_access_token, get_user
                    uid = decode_access_token(token)
                    user = get_user(uid)
                    if user is None or not user.isActive:
                        raise ValueError("user inactive")
                    user_id = uid
                except Exception:
                    _log_request(datetime.now().isoformat(), client_ip, method, path,
                                 user_id, 401, (time.monotonic() - t0) * 1000)
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "登录已失效，请重新登录", "code": "TOKEN_INVALID"},
                    )

            # 3. Block suspicious User-Agent patterns (only for non-authenticated or anonymous)
            if not user_id:
                ua = request.headers.get("user-agent", "").lower()
                blocked_agents = ["scrapy", "httpclient", "python-requests", "curl/", "wget/"]
                if any(agent in ua for agent in blocked_agents):
                    if client_ip not in ("127.0.0.1", "::1", "localhost"):
                        logger.warning("Blocked suspicious UA: %s from %s", ua[:50], client_ip)
                        _log_request(datetime.now().isoformat(), client_ip, method, path,
                                     user_id, 403, (time.monotonic() - t0) * 1000)
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "访问被拒绝", "code": "BLOCKED"},
                        )

        response = await call_next(request)

        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Log completed request
        duration_ms = (time.monotonic() - t0) * 1000
        if path.startswith("/api/"):
            _log_request(datetime.now().isoformat(), client_ip, method, path,
                         user_id, response.status_code, duration_ms)

        return response
