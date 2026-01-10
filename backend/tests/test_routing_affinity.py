import asyncio
from types import SimpleNamespace

import pytest

from app.core import cache
from app.core.config import settings
from app.services.providers.routing_selector import RoutingCandidate, RoutingSelector


@pytest.mark.asyncio
async def test_affinity_bonus_prefers_cached_arm(monkeypatch):
    """
    当存在前缀亲和记录时，应在 bandit 评分中给予加成，优先选择已缓存上游。
    """

    # 启用并放大加成，避免随机权重影响
    monkeypatch.setattr(settings, "AFFINITY_ROUTING_ENABLED", True)
    monkeypatch.setattr(settings, "AFFINITY_ROUTING_BONUS", 1.0)
    monkeypatch.setattr(settings, "AFFINITY_ROUTING_PREFIX_RATIO", 1.0)

    # 让缓存查询始终命中 model_a
    async def fake_get(key: str):
        return "model_a"

    monkeypatch.setattr(cache, "get", fake_get)

    selector = RoutingSelector(session=None)  # session 未在 choose 中使用

    # 构造两个候选：model_a 成功率较低，但有亲和加成；model_b 成功率更高但无加成
    base_kwargs = dict(
        preset_id=None,
        instance_id="inst",
        preset_item_id=None,
        provider="mock",
        upstream_url="http://upstream",
        channel="external",
        template_engine="simple_replace",
        request_template={},
        response_transform={},
        pricing_config={},
        limit_config={},
        auth_type="bearer",
        auth_config={},
        default_headers={},
        default_params={},
        routing_config={"strategy": "bandit", "epsilon": 0},
        weight=1,
        priority=1,
    )

    cand_affined = RoutingCandidate(
        model_id="model_a",
        bandit_state=SimpleNamespace(total_trials=10, successes=4, failures=6, latency_p95_ms=None),
        **base_kwargs,
    )
    cand_other = RoutingCandidate(
        model_id="model_b",
        bandit_state=SimpleNamespace(total_trials=10, successes=6, failures=4, latency_p95_ms=None),
        **base_kwargs,
    )

    primary, _, affinity_hit = await selector.choose([cand_other, cand_affined], messages=[{"role": "user", "content": "hi"}])

    assert primary.model_id == "model_a"
    assert affinity_hit is True
