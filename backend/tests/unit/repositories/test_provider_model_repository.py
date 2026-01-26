import pytest
from sqlalchemy.dialects import postgresql

from app.core.cache import cache
from app.models.provider_instance import ProviderModel
from app.repositories.provider_instance_repository import ProviderModelRepository


class _DummyDialect:
    name = "postgresql"


class _DummyBind:
    dialect = _DummyDialect()


class _DummyResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _DummySession:
    def __init__(self):
        self.bind = _DummyBind()
        self.captured_stmt = None

    async def execute(self, stmt):
        self.captured_stmt = stmt
        return _DummyResult([])


@pytest.mark.asyncio
async def test_get_candidates_postgres_uses_contains_or_filters(monkeypatch):
    session = _DummySession()
    repo = ProviderModelRepository(session)

    async def _passthrough(key, loader, ttl, **kwargs):
        return await loader()

    monkeypatch.setattr(cache, "get_or_set_singleflight", _passthrough)

    await repo.get_candidates("chat", "gpt-4", user_id=None, include_public=True)

    assert session.captured_stmt is not None
    sql = str(session.captured_stmt.compile(dialect=postgresql.dialect()))
    assert "&&" not in sql
    assert "@>" in sql


def test_capability_list_type_supports_overlap():
    expr = ProviderModel.capabilities.overlap(["chat"])
    sql = str(expr.compile(dialect=postgresql.dialect()))
    assert "&&" in sql
