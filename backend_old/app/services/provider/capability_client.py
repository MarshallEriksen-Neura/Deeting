from __future__ import annotations

"""
基于能力的 HTTP 客户端：使用 CapabilityConfig 驱动上游调用。

设计目的：
- 提供统一的能力驱动调用入口，替代基于 api_style 的分支逻辑；
- 自动使用 CapabilityConfig 中的 endpoint/request_map/response_map/headers；
- 支持同步和异步调用模式。

使用示例：
    from app.services.provider.capability_client import CapabilityClient
    from app.services.provider.capability_resolver import resolve_capability_config

    # 获取能力配置
    config = resolve_capability_config(
        provider_meta=provider.metadata_json,
        capability="embedding",
        base_url=provider.base_url,
    )

    # 发起请求
    client = CapabilityClient()
    response = await client.call(
        config=config,
        request={"model": "text-embedding-3-small", "input": "hello"},
        headers={"Authorization": "Bearer xxx"},
    )
"""

import logging
from typing import Any

import httpx

from app.services.provider.capability_resolver import CapabilityConfig
from app.services.provider.request_transformer import RequestTransformer
from app.services.provider.response_adapter import ResponseAdapter

logger = logging.getLogger(__name__)


class CapabilityClientError(RuntimeError):
    """能力客户端错误。"""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_body: Any = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class CapabilityClient:
    """
    基于能力的 HTTP 客户端。

    使用 CapabilityConfig 驱动请求转换、URL 生成和响应适配。
    """

    def __init__(
        self,
        transformer: RequestTransformer | None = None,
        adapter: ResponseAdapter | None = None,
        timeout: float = 30.0,
    ):
        self._transformer = transformer or RequestTransformer()
        self._adapter = adapter or ResponseAdapter()
        self._timeout = timeout

    async def call(
        self,
        config: CapabilityConfig,
        request: dict[str, Any],
        headers: dict[str, str] | None = None,
        extra_query_params: dict[str, str] | None = None,
        timeout: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> Any:
        """
        使用 CapabilityConfig 发起 HTTP 请求。

        Args:
            config: 从 resolve_capability_config() 获取的能力配置
            request: 原始请求字典（将使用 config.request_map 转换）
            headers: 额外请求头（会与 config.headers 合并）
            extra_query_params: 额外查询参数（会与 config.query_params 合并）
            timeout: 超时时间（秒），默认使用实例级别配置
            client: 可选的 httpx.AsyncClient 实例，用于连接复用

        Returns:
            转换后的响应（使用 config.response_map 适配）

        Raises:
            CapabilityClientError: 请求失败
        """
        if not config.endpoint:
            raise CapabilityClientError("CapabilityConfig 缺少 endpoint")

        # 1. 转换请求体
        transformed_body = self._transformer.transform_dict(
            request,
            input_map=config.request_map or None,
            defaults=config.defaults or None,
        )

        # 2. 合并 headers
        merged_headers = dict(config.headers) if config.headers else {}
        if headers:
            merged_headers.update(headers)

        # 3. 合并 query params
        merged_params = dict(config.query_params) if config.query_params else {}
        if extra_query_params:
            merged_params.update(extra_query_params)

        # 4. 发起请求
        effective_timeout = timeout or self._timeout
        logger.debug(
            "CapabilityClient: %s %s capability=%s",
            config.method,
            config.endpoint,
            config.capability.value,
        )

        async def _do_request(c: httpx.AsyncClient) -> httpx.Response:
            try:
                return await c.request(
                    method=config.method,
                    url=config.endpoint,
                    json=transformed_body,
                    headers=merged_headers,
                    params=merged_params if merged_params else None,
                )
            except httpx.TimeoutException as e:
                raise CapabilityClientError(f"请求超时: {e}") from e
            except httpx.RequestError as e:
                raise CapabilityClientError(f"请求失败: {e}") from e

        if client:
            response = await _do_request(client)
        else:
            async with httpx.AsyncClient(timeout=effective_timeout) as new_client:
                response = await _do_request(new_client)

        # 5. 检查响应状态
        if response.status_code >= 400:
            try:
                error_body = response.json()
            except Exception:
                error_body = response.text
            raise CapabilityClientError(
                f"上游返回错误: {response.status_code}",
                status_code=response.status_code,
                response_body=error_body,
            )

        # 6. 解析响应体
        try:
            response_data = response.json()
        except Exception:
            # 非 JSON 响应（如音频二进制）
            return response.content

        # 7. 适配响应
        return self._adapter.adapt_with_config(response_data, config)

    async def call_raw(
        self,
        config: CapabilityConfig,
        request: dict[str, Any],
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> tuple[int, dict[str, str], Any]:
        """
        发起请求并返回原始响应（不做适配）。

        Returns:
            (status_code, response_headers, response_body)
        """
        if not config.endpoint:
            raise CapabilityClientError("CapabilityConfig 缺少 endpoint")

        transformed_body = self._transformer.transform_dict(
            request,
            input_map=config.request_map or None,
            defaults=config.defaults or None,
        )

        merged_headers = dict(config.headers) if config.headers else {}
        if headers:
            merged_headers.update(headers)

        effective_timeout = timeout or self._timeout

        async def _do_request(c: httpx.AsyncClient) -> httpx.Response:
            return await c.request(
                method=config.method,
                url=config.endpoint,
                json=transformed_body,
                headers=merged_headers,
            )

        if client:
            response = await _do_request(client)
        else:
            async with httpx.AsyncClient(timeout=effective_timeout) as new_client:
                response = await _do_request(new_client)

        try:
            body = response.json()
        except Exception:
            body = response.content

        return response.status_code, dict(response.headers), body

    async def call_stream(
        self,
        config: CapabilityConfig,
        request: dict[str, Any],
        headers: dict[str, str] | None = None,
        extra_query_params: dict[str, str] | None = None,
        timeout: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> Any:  # Returns AsyncIterator[bytes] but typed Any to avoid import complexity
        """
        发起流式请求。

        Returns:
            AsyncIterator[bytes] yielding raw chunks.
        """
        if not config.endpoint:
            raise CapabilityClientError("CapabilityConfig 缺少 endpoint")

        transformed_body = self._transformer.transform_dict(
            request,
            input_map=config.request_map or None,
            defaults=config.defaults or None,
        )

        merged_headers = dict(config.headers) if config.headers else {}
        if headers:
            merged_headers.update(headers)

        merged_params = dict(config.query_params) if config.query_params else {}
        if extra_query_params:
            merged_params.update(extra_query_params)

        effective_timeout = timeout or self._timeout
        logger.debug(
            "CapabilityClient: STREAM %s %s capability=%s",
            config.method,
            config.endpoint,
            config.capability.value,
        )

        # Helper to process response stream
        async def _process_response(response: httpx.Response):
            if response.status_code >= 400:
                try:
                    await response.aread()
                    error_body = response.json()
                except Exception:
                    error_body = response.text
                raise CapabilityClientError(
                    f"上游返回错误: {response.status_code}",
                    status_code=response.status_code,
                    response_body=error_body,
                )
            
            async for chunk in response.aiter_bytes():
                yield chunk

        if client:
            try:
                async with client.stream(
                    method=config.method,
                    url=config.endpoint,
                    json=transformed_body,
                    headers=merged_headers,
                    params=merged_params if merged_params else None,
                ) as response:
                    async for chunk in _process_response(response):
                        yield chunk
            except httpx.TimeoutException as e:
                raise CapabilityClientError(f"请求超时: {e}") from e
            except httpx.RequestError as e:
                raise CapabilityClientError(f"请求失败: {e}") from e
        else:
            new_client = httpx.AsyncClient(timeout=effective_timeout)
            try:
                async with new_client.stream(
                    method=config.method,
                    url=config.endpoint,
                    json=transformed_body,
                    headers=merged_headers,
                    params=merged_params if merged_params else None,
                ) as response:
                    async for chunk in _process_response(response):
                        yield chunk
            except httpx.TimeoutException as e:
                await new_client.aclose()
                raise CapabilityClientError(f"请求超时: {e}") from e
            except httpx.RequestError as e:
                await new_client.aclose()
                raise CapabilityClientError(f"请求失败: {e}") from e
            except Exception:
                await new_client.aclose()
                raise
            await new_client.aclose()

    async def call_stream(
        self,
        config: CapabilityConfig,
        request: dict[str, Any],
        headers: dict[str, str] | None = None,
        extra_query_params: dict[str, str] | None = None,
        timeout: float | None = None,
    ) -> Any:  # Returns AsyncIterator[bytes] but typed Any to avoid import complexity
        """
        发起流式请求。

        Returns:
            AsyncIterator[bytes] yielding raw chunks.
        """
        if not config.endpoint:
            raise CapabilityClientError("CapabilityConfig 缺少 endpoint")

        transformed_body = self._transformer.transform_dict(
            request,
            input_map=config.request_map or None,
            defaults=config.defaults or None,
        )

        merged_headers = dict(config.headers) if config.headers else {}
        if headers:
            merged_headers.update(headers)

        merged_params = dict(config.query_params) if config.query_params else {}
        if extra_query_params:
            merged_params.update(extra_query_params)

        effective_timeout = timeout or self._timeout
        logger.debug(
            "CapabilityClient: STREAM %s %s capability=%s",
            config.method,
            config.endpoint,
            config.capability.value,
        )

        client = httpx.AsyncClient(timeout=effective_timeout)
        try:
            async with client.stream(
                method=config.method,
                url=config.endpoint,
                json=transformed_body,
                headers=merged_headers,
                params=merged_params if merged_params else None,
            ) as response:
                if response.status_code >= 400:
                    try:
                        await response.aread()
                        error_body = response.json()
                    except Exception:
                        error_body = response.text
                    raise CapabilityClientError(
                        f"上游返回错误: {response.status_code}",
                        status_code=response.status_code,
                        response_body=error_body,
                    )
                
                async for chunk in response.aiter_bytes():
                    yield chunk
        except httpx.TimeoutException as e:
            await client.aclose()
            raise CapabilityClientError(f"请求超时: {e}") from e
        except httpx.RequestError as e:
            await client.aclose()
            raise CapabilityClientError(f"请求失败: {e}") from e
        except Exception:
            await client.aclose()
            raise
        
        # We don't close the client in the success path because it's a context manager 
        # but usage with 'yield' inside 'async with' handles closure on exit.
        # However, to be safe with httpx stream context, we should ensure it closes.
        # The 'async with client.stream' block handles the response closure, 
        # but the client itself needs to be closed. 
        # Since we created the client outside 'async with', we should close it.
        await client.aclose()


__all__ = ["CapabilityClient", "CapabilityClientError"]
