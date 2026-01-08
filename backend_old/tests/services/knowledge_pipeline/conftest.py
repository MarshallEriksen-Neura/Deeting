from __future__ import annotations

import pytest
from unittest.mock import AsyncMock


@pytest.fixture()
def qdrant_client_mock():
    client = AsyncMock()
    client.post = AsyncMock()
    return client

