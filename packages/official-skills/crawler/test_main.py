import contextlib
import importlib.util
import io
import pathlib
import sys
import types
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("crawler_main", MODULE_PATH)
assert SPEC and SPEC.loader
fake_httpx = types.ModuleType("httpx")
fake_httpx.Timeout = lambda *args, **kwargs: ("timeout", args, kwargs)
fake_httpx.AsyncClient = object
sys.modules.setdefault("httpx", fake_httpx)
crawler_main = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(crawler_main)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeAsyncClient:
    payload = {}

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return _FakeResponse(self.payload)


class CrawlerSkillTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_web_content_prefers_top_level_title(self):
        original_client = crawler_main.httpx.AsyncClient
        _FakeAsyncClient.payload = {
            "status": "success",
            "title": "Volcengine Docs",
            "markdown": "abcdef",
            "metadata": {"title": "Old Title"},
        }
        crawler_main.httpx.AsyncClient = _FakeAsyncClient

        try:
            result = await crawler_main.fetch_web_content("https://example.com/docs")
        finally:
            crawler_main.httpx.AsyncClient = original_client

        self.assertEqual("success", result["status"])
        self.assertEqual("Volcengine Docs", result["title"])
        self.assertEqual("abcdef", result["content"])

    def test_emit_json_preserves_unicode_content(self):
        output = io.StringIO()
        payload = {"markdown": "abc\u200bdef"}

        with contextlib.redirect_stdout(output):
            crawler_main.emit_json(payload)

        self.assertIn("abc\u200bdef", output.getvalue())
