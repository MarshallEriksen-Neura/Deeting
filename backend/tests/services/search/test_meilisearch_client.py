from app.meilisearch_client import meilisearch_is_configured


def test_meilisearch_is_configured_false_when_missing_url(settings):
    settings.MEILISEARCH_URL = ""
    settings.MEILISEARCH_API_KEY = ""
    assert meilisearch_is_configured() is False


def test_meilisearch_is_configured_true_when_url_set(settings):
    settings.MEILISEARCH_URL = "http://localhost:7700"
    settings.MEILISEARCH_API_KEY = ""
    assert meilisearch_is_configured() is True
