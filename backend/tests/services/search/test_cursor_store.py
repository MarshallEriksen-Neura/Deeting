import pytest

from app.services.search.cursor_store import SearchCursorStore


@pytest.mark.asyncio
async def test_cursor_store_roundtrip(mocker):
    store = SearchCursorStore()
    mocker.patch.object(store, "_cache_set", return_value=True)
    mocker.patch.object(store, "_cache_get", return_value={"offset": 20})
    await store.save("cursor-token", offset=20)
    result = await store.load("cursor-token")
    assert result["offset"] == 20


@pytest.mark.asyncio
async def test_cursor_store_ignores_invalid_payload(mocker):
    store = SearchCursorStore()
    mocker.patch.object(store, "_cache_get", return_value={"offset": "bad"})
    result = await store.load("cursor-token")
    assert result is None
