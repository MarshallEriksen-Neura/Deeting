import uuid
from types import SimpleNamespace

import pytest

from app.services.providers.routing_selector import RoutingSelector
from app.models.provider_instance import ProviderInstance, ProviderModel


class FakeSelector(RoutingSelector):
    def __init__(self):
        # 不调用父类以便注入 stub 仓库
        pass


@pytest.mark.asyncio
async def test_load_candidates_generates_multiple_credentials():
    inst_id = uuid.uuid4()
    preset = SimpleNamespace(
        id=uuid.uuid4(),
        is_active=True,
        provider="openai",
        auth_config={},
        auth_type="bearer",
        default_headers={},
        default_params={},
    )

    instance = ProviderInstance(
        id=inst_id,
        user_id=None,
        preset_slug="openai",
        name="default",
        base_url="https://api.openai.com",
        credentials_ref="REF_DEFAULT",
        channel="external",
        priority=0,
        is_enabled=True,
        meta={},
    )
    model = ProviderModel(
        id=uuid.uuid4(),
        instance_id=inst_id,
        capability="chat",
        model_id="gpt-4",
        upstream_path="/v1/chat/completions",
        template_engine="simple_replace",
        request_template={},
        response_transform={},
        pricing_config={},
        limit_config={},
        tokenizer_config={},
        routing_config={},
        source="auto",
        extra_meta={},
        weight=100,
        priority=0,
        is_active=True,
    )

    extra_cred = SimpleNamespace(
        id=uuid.uuid4(),
        alias="backup",
        secret_ref_id="REF_BACKUP",
        weight=10,
        priority=1,
    )

    selector = FakeSelector()
    async def instance_loader(user_id, include_public=True):
        return [instance]

    async def model_loader(capability, model_id, user_id, include_public=True):
        return [model]

    async def preset_loader(slug):
        return preset

    async def credential_loader(instance_ids):
        return {str(inst_id): [extra_cred]}

    async def bandit_loader(ids):
        return {}

    selector.instance_repo = SimpleNamespace(get_available_instances=instance_loader)
    selector.model_repo = SimpleNamespace(get_candidates=model_loader)
    selector.preset_repo = SimpleNamespace(get_by_slug=preset_loader)
    selector.credential_repo = SimpleNamespace(get_by_instance_ids=credential_loader)
    selector.bandit_repo = SimpleNamespace(get_states_map=bandit_loader)

    candidates = await selector.load_candidates(
        capability="chat",
        model="gpt-4",
        channel="external",
        user_id=None,
    )

    # 期望包含默认 credentials_ref + 额外凭证各一条
    assert len(candidates) == 2
    secret_refs = {c.auth_config.get("secret_ref_id") for c in candidates}
    assert {"REF_DEFAULT", "REF_BACKUP"} == secret_refs
    aliases = {c.credential_alias for c in candidates}
    assert "default" in aliases and "backup" in aliases
