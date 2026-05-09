"""Security middleware - rate limiting, request validation, anti-abuse."""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


# ── Configuration ──

@dataclass
class RateLimitRule:
    """Rate limit rule: max_requests per window_seconds."""
    max_requests: int
    window_seconds: int


@dataclass
class SecurityConfig:
    """All security settings in one place."""
    # Per-IP rate limits by path pattern
    rate_limits: dict[str, RateLimitRule] = field(default_factory=lambda: {
        "/api/news/sentiment/search": RateLimitRule(max_requests=10, window_seconds=60),
        "/api/monitor/rules/test": RateLimitRule(max_requests=5, window_seconds=60),
        "/api/monitor/rules/generate": RateLimitRule(max_requests=5, window_seconds=60),
        "default": RateLimitRule(max_requests=60, window_seconds=60),
    })
    # Search keyword constraints
    search_keyword_max_length: int = 100
    search_keyword_min_length: int = 1
    search_limit_max: int = 50
    # Blocked paths (return 403 without auth)
    protected_paths: list[str] = field(default_factory=lambda: [
        "/api/news/sentiment/search",
        "/api/monitor/",
    ])


CONFIG = SecurityConfig()


# ── Rate Limiter (in-memory, per-IP) ──

class _RateLimiter:
    """Sliding window rate limiter per IP address."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        """Check if request is allowed. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        window_start = now - rule.window_seconds

        # Clean old entries
        hits = self._hits[key]
        self._hits[key] = [t for t in hits if t > window_start]
        hits = self._hits[key]

        if len(hits) >= rule.max_requests:
            retry_after = int(hits[0] - window_start) + 1
            return False, max(retry_after, 1)

        hits.append(now)
        return True, 0

    def cleanup(self, max_age: float = 600) -> None:
        """Remove entries older than max_age seconds."""
        now = time.monotonic()
        expired = [k for k, v in self._hits.items() if not v or now - v[-1] > max_age]
        for k in expired:
            del self._hits[k]


_limiter = _RateLimiter()


def _get_client_ip(request: Request) -> str:
    """Extract client IP, respecting X-Forwarded-For for reverse proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _match_rate_limit(path: str) -> RateLimitRule:
    """Find the most specific rate limit rule for a path."""
    for pattern, rule in CONFIG.rate_limits.items():
        if pattern == "default":
            continue
        if path.startswith(pattern):
            return rule
    return CONFIG.rate_limits["default"]


# ── Validation Helpers ──

def validate_search_keyword(keyword: str) -> str | None:
    """Validate search keyword. Returns error message or None if valid."""
    keyword = keyword.strip()
    if not keyword:
        return "关键词不能为空"
    if len(keyword) < CONFIG.search_keyword_min_length:
        return f"关键词至少{CONFIG.search_keyword_min_length}个字符"
    if len(keyword) > CONFIG.search_keyword_max_length:
        return f"关键词不能超过{CONFIG.search_keyword_max_length}个字符"
    return None


def validate_search_limit(limit: int) -> int:
    """Clamp search limit to allowed range."""
    return max(1, min(limit, CONFIG.search_limit_max))


# ── Middleware ──

class SecurityMiddleware(BaseHTTPMiddleware):
    """Global security middleware: rate limiting + path protection."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        client_ip = _get_client_ip(request)

        # 1. Rate limiting
        if path.startswith("/api/"):
            rule = _match_rate_limit(path)
            rate_key = f"{client_ip}:{path}"
            allowed, retry_after = _limiter.is_allowed(rate_key, rule)

            if not allowed:
                logger.warning("Rate limited: %s %s from %s (retry %ds)",
                               request.method, path, client_ip, retry_after)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "请求过于频繁，请稍后再试", "code": "RATE_LIMITED"},
                    headers={"Retry-After": str(retry_after)},
                )

        # 2. Auth check for protected paths (skip OPTIONS for CORS)
        if request.method != "OPTIONS":
            for protected in CONFIG.protected_paths:
                if path.startswith(protected):
                    # Check for auth token
                    auth_header = request.headers.get("authorization", "")
                    if not auth_header.startswith("Bearer "):
                        # Allow GET /api/news/sentiment/search without auth (legacy)
                        # But POST requires auth
                        if request.method == "POST":
                            return JSONResponse(
                                status_code=401,
                                content={"detail": "请先登录", "code": "UNAUTHORIZED"},
                            )
                    break

        # 3. Block suspicious User-Agent patterns
        ua = request.headers.get("user-agent", "").lower()
        blocked_agents = ["scrapy", "httpclient", "python-requests", "curl/", "wget/"]
        if any(agent in ua for agent in blocked_agents):
            # Allow from localhost (internal requests)
            if client_ip not in ("127.0.0.1", "::1", "localhost"):
                logger.warning("Blocked suspicious UA: %s from %s", ua[:50], client_ip)
                return JSONResponse(
                    status_code=403,
                    content={"detail": "访问被拒绝", "code": "BLOCKED"},
                )

        response = await call_next(request)

        # 4. Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        return response
