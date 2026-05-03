import json
import logging
from pathlib import Path

from config import settings
from .ai_providers.base import AIProvider
from .ai_providers.claude_provider import ClaudeProvider
from .ai_providers.openai_provider import OpenAIProvider
from .ai_providers.custom_provider import CustomProvider

logger = logging.getLogger(__name__)

_providers: dict[str, type[AIProvider]] = {
    "claude": ClaudeProvider,
    "openai": OpenAIProvider,
    "custom": CustomProvider,
}

# Map provider name to its required settings attribute
_KEY_ATTR_MAP = {
    "claude": "anthropic_api_key",
    "openai": "openai_api_key",
    "custom": "custom_api_key",
}

_MODEL_ATTR_MAP = {
    "claude": "anthropic_model",
    "openai": "openai_model",
    "custom": "custom_model",
}

_BASEURL_ATTR_MAP = {
    "openai": "openai_base_url",
    "claude": "anthropic_base_url",
    "custom": "custom_base_url",
}

_CONFIG_PATH = Path(__file__).parent.parent / "data" / "ai_settings.json"

class AIConfigError(Exception):
    """Raised when AI provider is not properly configured."""


def load_ai_config() -> dict:
    """Load persisted AI config from JSON file. Returns empty dict if not found."""
    try:
        if _CONFIG_PATH.exists():
            with open(_CONFIG_PATH, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning("Failed to load AI config: %s", e)
    return {}


def save_ai_config(provider: str, api_key: str, model: str, base_url: str = "") -> None:
    """Persist AI config to JSON file."""
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    config = {
        "provider": provider,
        "apiKey": api_key,
        "model": model,
        "baseUrl": base_url,
    }
    with open(_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    logger.info("AI config saved: provider=%s, model=%s", provider, model)


def get_ai_config_status() -> dict:
    """Get current AI config for API response (masks the API key)."""
    persisted = load_ai_config()

    # Determine active provider/key from persisted or env
    provider = persisted.get("provider") or settings.ai_provider
    api_key = persisted.get("apiKey") or ""
    model = persisted.get("model") or ""
    base_url = persisted.get("baseUrl") or ""

    # If no persisted config, fall back to env
    if not api_key:
        key_attr = _KEY_ATTR_MAP.get(provider, "")
        api_key = getattr(settings, key_attr, "")
    if not model:
        model_attr = _MODEL_ATTR_MAP.get(provider, "")
        model = getattr(settings, model_attr, "")
    if not base_url and provider in _BASEURL_ATTR_MAP:
        base_url = getattr(settings, _BASEURL_ATTR_MAP[provider], "")

    # Mask the key
    masked_key = ""
    if api_key:
        masked_key = api_key[:3] + "***" + api_key[-4:] if len(api_key) > 7 else "***"

    configured = bool(api_key)
    return {
        "provider": provider,
        "apiKeyMasked": masked_key,
        "model": model,
        "baseUrl": base_url,
        "configured": configured,
    }


def get_ai_provider() -> AIProvider:
    """Get an AI provider instance using persisted config, falling back to env vars."""
    persisted = load_ai_config()

    # Determine provider
    provider_name = persisted.get("provider") or settings.ai_provider
    cls = _providers.get(provider_name)
    if not cls:
        raise AIConfigError(
            f"Unknown AI provider: {provider_name}. "
            f"Available: {list(_providers.keys())}"
        )

    # Determine API key
    api_key = persisted.get("apiKey") or ""
    if not api_key:
        key_attr = _KEY_ATTR_MAP.get(provider_name, "")
        api_key = getattr(settings, key_attr, "")
    if not api_key:
        raise AIConfigError(
            f"AI provider '{provider_name}' has no API key. "
            f"Configure it in Settings page or set {provider_name} key in server/.env"
        )

    # Determine model
    model = persisted.get("model") or ""
    if not model:
        model_attr = _MODEL_ATTR_MAP.get(provider_name, "")
        model = getattr(settings, model_attr, "")

    # Apply overrides to settings so providers pick them up in __init__
    key_attr = _KEY_ATTR_MAP.get(provider_name)
    model_attr = _MODEL_ATTR_MAP.get(provider_name)
    if key_attr:
        setattr(settings, key_attr, api_key)
    if model_attr and model:
        setattr(settings, model_attr, model)

    base_url = persisted.get("baseUrl") or ""
    if base_url:
        base_url_attr = _BASEURL_ATTR_MAP.get(provider_name)
        if base_url_attr:
            setattr(settings, base_url_attr, base_url)

    return cls()
