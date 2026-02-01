import pytest

from app.meilisearch_client import meilisearch_is_configured


def test_meilisearch_is_configured_false_when_missing_url(settings):
    settings.MEILISEARCH_URL = ""
    settings.MEILISEARCH_API_KEY = ""
    assert meilisearch_is_configured() is False
