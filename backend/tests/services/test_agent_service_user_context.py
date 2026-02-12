import uuid
from unittest.mock import AsyncMock

import pytest

from app.services.agent.agent_service import AgentService


@pytest.mark.asyncio
async def test_initialize_requires_real_user_id():
    service = AgentService()

    with pytest.raises(ValueError, match="real user_id"):
        await service.initialize(user_id=None)


@pytest.mark.asyncio
async def test_initialize_parses_and_passes_user_id(monkeypatch):
    service = AgentService()
    activate_all = AsyncMock()

    monkeypatch.setattr(service.plugin_manager, "activate_all", activate_all)
    monkeypatch.setattr(service.plugin_manager, "get_all_tools", lambda: [])

    user_id = uuid.uuid4()
    await service.initialize(user_id=str(user_id))

    activate_all.assert_awaited_once_with(user_id=user_id, session_id=None)
