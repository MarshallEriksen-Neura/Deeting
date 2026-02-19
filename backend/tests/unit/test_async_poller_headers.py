"""Tests for AsyncPoller header rendering."""

from app.core.provider.async_poller import AsyncPoller


class TestAsyncPollerHeaders:
    """Test Jinja2 rendering of poll headers."""

    def test_render_headers_with_api_key(self):
        """{{ credentials.api_key }} 模板被正确渲染"""
        config = {
            "poll": {
                "url_template": "https://api.example.com/tasks/{{ task_id }}",
                "method": "GET",
                "interval": 5,
                "timeout": 300,
                "headers": {
                    "Authorization": "Bearer {{ credentials.api_key }}",
                    "Content-Type": "application/json",
                },
                "status_check": {
                    "location": "status",
                    "success_values": ["succeeded"],
                    "fail_values": ["failed"],
                },
            }
        }

        poller = AsyncPoller(config, api_key="sk-test-key-123")
        headers = poller._render_headers(config["poll"]["headers"])

        assert headers["Authorization"] == "Bearer sk-test-key-123"
        assert headers["Content-Type"] == "application/json"

    def test_render_headers_no_templates(self):
        """无模板标记的 headers 原样返回"""
        config = {"poll": {"url_template": "x", "headers": {}}}
        poller = AsyncPoller(config, api_key="key")

        headers = poller._render_headers({"X-Custom": "static-value"})
        assert headers["X-Custom"] == "static-value"

    def test_render_headers_empty(self):
        """空 headers 返回空 dict"""
        config = {"poll": {"url_template": "x"}}
        poller = AsyncPoller(config, api_key="key")

        headers = poller._render_headers({})
        assert headers == {}

    def test_render_headers_missing_api_key(self):
        """api_key 为空时模板渲染为空字符串（SilentUndefined）"""
        config = {"poll": {"url_template": "x"}}
        poller = AsyncPoller(config, api_key="")

        headers = poller._render_headers(
            {"Authorization": "Bearer {{ credentials.api_key }}"}
        )
        assert headers["Authorization"] == "Bearer "
