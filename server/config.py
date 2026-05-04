from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # AKShare
    akshare_version: str = "1.18.60"

    # AI Provider: "claude" | "openai" | "custom"
    ai_provider: str = "claude"

    # Claude
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"
    anthropic_base_url: str = ""

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_base_url: str = ""

    # Custom (OpenAI-compatible endpoint, e.g. local LLM)
    custom_api_key: str = ""
    custom_base_url: str = ""
    custom_model: str = ""

    # Cache TTLs (seconds)
    cache_ttl_spot: int = 300
    cache_ttl_kline: int = 300
    cache_ttl_financials: int = 86400
    cache_ttl_news: int = 600
    cache_ttl_search: int = 3600
    cache_max_size: int = 512

    # Server
    host: str = "127.0.0.1"
    port: int = 1335

    model_config = {"env_prefix": "STOCK_", "env_file": ".env"}


settings = Settings()
