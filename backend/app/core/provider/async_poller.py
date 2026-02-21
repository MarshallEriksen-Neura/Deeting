import asyncio
import time
from typing import Any

import httpx
from jinja2 import BaseLoader, Environment

from app.services.providers.request_renderer import SilentUndefined


from app.core.provider.utils import get_by_path  # noqa: E402 – re-export for compat

__all__ = ["AsyncPoller", "get_by_path"]


class AsyncPoller:
    """通用状态机轮询器 - 一次编写，处处运行 (Async Version)"""

    def __init__(self, config: dict, api_key: str):
        self.config = config
        self.api_key = api_key
        self.jinja_env = Environment(
            loader=BaseLoader(), undefined=SilentUndefined
        )

    def _render_headers(self, raw_headers: dict[str, str]) -> dict[str, str]:
        """对 poll headers 做 Jinja2 模板渲染，注入 credentials.api_key"""
        render_ctx = {"credentials": {"api_key": self.api_key}}
        rendered = {}
        for k, v in raw_headers.items():
            if isinstance(v, str) and "{{" in v:
                rendered[k] = self.jinja_env.from_string(v).render(**render_ctx)
            else:
                rendered[k] = v
        return rendered

    async def wait_for_result(self, task_id: str, client: httpx.AsyncClient) -> dict:
        poll_conf = self.config["poll"]
        url = poll_conf["url_template"].replace("{{ task_id }}", str(task_id))

        start_time = time.time()
        timeout = poll_conf.get("timeout", 300)
        interval = poll_conf.get("interval", 5)

        while time.time() - start_time < timeout:
            # 1. 渲染并发起轮询
            headers = self._render_headers(poll_conf.get("headers", {}))

            try:
                resp = await client.request(
                    method=poll_conf.get("method", "GET"), url=url, headers=headers
                )
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as e:
                # Handle error or retry?
                # For now, if polling fails (network), maybe we should retry or fail?
                # User snippet: resp.json() directly.
                # I'll assume we continue if error is 5xx? No, user snippet raises exception if status val not success.
                # But here it's network error. I will raise for now to be safe.
                raise e

            # 2. 检查状态
            status_loc = poll_conf["status_check"]["location"]
            status_val = get_by_path(data, status_loc)

            success_values = poll_conf["status_check"]["success_values"]
            fail_values = poll_conf["status_check"]["fail_values"]

            if status_val in success_values:
                return data  # 成功，返回完整数据供提取

            if status_val in fail_values:
                raise Exception(f"Async task failed: {status_val}")

            await asyncio.sleep(interval)

        raise TimeoutError("Async polling timed out")
