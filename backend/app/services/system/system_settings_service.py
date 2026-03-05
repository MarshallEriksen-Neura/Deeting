from __future__ import annotations

from app.core import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.repositories import ProviderModelRepository, SystemSettingRepository

EMBEDDING_SETTING_KEY = "embedding_model"
RECHARGE_POLICY_SETTING_KEY = "credits_recharge_policy"
DEFAULT_RECHARGE_POLICY_CREDIT_PER_UNIT = 10.0
DEFAULT_RECHARGE_POLICY_CURRENCY = "USD"


class SystemSettingsService:
    def __init__(
        self,
        settings_repo: SystemSettingRepository,
        model_repo: ProviderModelRepository,
    ):
        self.settings_repo = settings_repo
        self.model_repo = model_repo

    async def get_embedding_model(self) -> str | None:
        return await self._load_embedding_model()

    async def set_embedding_model(self, model_name: str) -> str:
        if not model_name:
            raise ValueError("Embedding 模型不能为空")
        candidates = await self.model_repo.get_candidates(
            capability="embedding",
            model_id=model_name,
            user_id=None,
            include_public=True,
        )
        if not candidates:
            raise ValueError("Embedding 模型不可用")
        await self.settings_repo.upsert(
            EMBEDDING_SETTING_KEY, {"model_name": model_name}
        )
        await cache.set(
            CacheKeys.system_embedding_model(),
            model_name,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )
        return model_name

    async def _load_embedding_model(self) -> str | None:
        setting = await self.settings_repo.get_by_key(EMBEDDING_SETTING_KEY)
        if not setting:
            return None
        value = setting.value
        if isinstance(value, dict):
            model_name = value.get("model_name")
            if isinstance(model_name, str) and model_name.strip():
                return model_name.strip()
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    async def get_recharge_policy(self) -> dict[str, float | str]:
        setting = await self.settings_repo.get_by_key(RECHARGE_POLICY_SETTING_KEY)
        if not setting:
            return {
                "credit_per_unit": DEFAULT_RECHARGE_POLICY_CREDIT_PER_UNIT,
                "currency": DEFAULT_RECHARGE_POLICY_CURRENCY,
            }
        return self._normalize_recharge_policy(setting.value)

    async def set_recharge_policy(
        self, credit_per_unit: float, currency: str | None = None
    ) -> dict[str, float | str]:
        if credit_per_unit <= 0:
            raise ValueError("充值比例必须大于 0")

        normalized_currency = self._normalize_currency(
            currency or DEFAULT_RECHARGE_POLICY_CURRENCY
        )
        payload = {
            "credit_per_unit": float(credit_per_unit),
            "currency": normalized_currency,
        }
        await self.settings_repo.upsert(RECHARGE_POLICY_SETTING_KEY, payload)
        return payload

    def _normalize_recharge_policy(self, value: object) -> dict[str, float | str]:
        ratio = DEFAULT_RECHARGE_POLICY_CREDIT_PER_UNIT
        currency = DEFAULT_RECHARGE_POLICY_CURRENCY
        if isinstance(value, dict):
            ratio_value = value.get("credit_per_unit")
            if isinstance(ratio_value, (int, float)) and ratio_value > 0:
                ratio = float(ratio_value)
            elif isinstance(ratio_value, str):
                try:
                    parsed = float(ratio_value)
                    if parsed > 0:
                        ratio = parsed
                except ValueError:
                    pass

            currency_value = value.get("currency")
            if isinstance(currency_value, str) and currency_value.strip():
                try:
                    currency = self._normalize_currency(currency_value)
                except ValueError:
                    currency = DEFAULT_RECHARGE_POLICY_CURRENCY

        return {"credit_per_unit": ratio, "currency": currency}

    @staticmethod
    def _normalize_currency(value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("货币代码不能为空")
        if len(normalized) > 16:
            raise ValueError("货币代码长度不能超过 16")
        return normalized


async def get_cached_embedding_model() -> str | None:
    cached = await cache.get(CacheKeys.system_embedding_model())
    if isinstance(cached, str) and cached.strip():
        return cached.strip()

    try:
        async with AsyncSessionLocal() as session:
            repo = SystemSettingRepository(session)
            service = SystemSettingsService(repo, ProviderModelRepository(session))
            model_name = await service.get_embedding_model()
            if model_name:
                await cache.set(
                    CacheKeys.system_embedding_model(),
                    model_name,
                    ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
                )
                return model_name
    except Exception:
        return None

    return None
