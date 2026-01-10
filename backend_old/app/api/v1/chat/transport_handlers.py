"""
非流式传输层处理（v2）

负责按 provider.transport 执行一次上游调用，并返回：
- success + JSONResponse（保持与请求 api_style 一致的响应形态）
- 或失败信息（status_code/error_text/retryable）供候选重试逻辑使用
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi.responses import JSONResponse

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover
    Redis = object  # type: ignore

from sqlalchemy.orm import Session as DbSession

from app.api.v1.chat.header_builder import build_upstream_headers
from app.api.v1.chat.protocol_adapter import (
    adapt_request_payload,
    adapt_response_payload,
)
from app.api.v1.chat.provider_endpoint_resolver import resolve_http_upstream_target
from app.api.v1.chat.upstream_error_classifier import classify_capability_mismatch
from app.auth import AuthenticatedAPIKey
from app.provider import config as provider_config
from app.provider.config import ProviderConfig
from app.provider.key_pool import (
    NoAvailableProviderKey,
    acquire_provider_key,
    record_key_failure,
    record_key_success,
)
from app.services.chat_routing_service import (
    _is_retryable_upstream_status,
)
from app.services.metrics_service import (
    call_upstream_http_with_metrics,
    record_provider_call_metric,
    _timeout_seconds,
)
from app.services.audio_input_service import (
    AudioStorageNotConfigured,
    materialize_input_audio_in_payload,
)
from app.services.provider.capability_client import (
    CapabilityClient,
    CapabilityClientError,
)
from app.services.provider.capability_resolver import CapabilityConfig
from app.proxy_pool import pick_upstream_proxy, report_upstream_proxy_failure
from app.services.upstream_proxy.utils import mask_proxy_url
from app.settings import settings
from app.logging_config import logger


class TransportResult:
    def __init__(
        self,
        *,
        success: bool,
        response: JSONResponse | None = None,
        status_code: int | None = None,
        error_text: str | None = None,
        retryable: bool = False,
        penalize: bool = True,
        error_category: str | None = None,
    ) -> None:
        self.success = success
        self.response = response
        self.status_code = status_code
        self.error_text = error_text
        self.retryable = retryable
        self.penalize = penalize
        self.error_category = error_category


def _build_headers(api_key: str, provider_cfg: ProviderConfig) -> dict[str, str]:
    """
    向后兼容的 header 构建函数（仅用于历史测试与少量调用方）。

    生产路径请使用 `_build_headers_for_style` 以支持 Claude 的 `x-api-key`
    及浏览器伪装相关 header。
    """
    headers = {"Authorization": f"Bearer {api_key}"}
    if provider_cfg.custom_headers:
        headers.update(provider_cfg.custom_headers)
    return headers


async def execute_capability_transport(
    *,
    client: httpx.AsyncClient,
    redis: Redis,
    db: DbSession,
    provider_id: str,
    model_id: str,
    capability_config: CapabilityConfig,
    payload: dict[str, Any],
    logical_model_id: str,
    api_key: AuthenticatedAPIKey,
) -> TransportResult:
    """
    使用 CapabilityConfig 执行非流式上游调用。
    包含：Key 获取、音频处理、代理轮询、指标记录。
    """
    provider_cfg = provider_config.get_provider_config(provider_id)
    if provider_cfg is None:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=f"Provider '{provider_id}' is not configured",
            retryable=False,
        )

    try:
        key_selection = await acquire_provider_key(provider_cfg, redis)
    except NoAvailableProviderKey as exc:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=str(exc),
            retryable=False,
        )

    # Note: Audio handling should ideally be moved into CapabilityClient request transformation 
    # if possible, or kept here as pre-processing. Keeping it here for now.
    try:
        # CapabilityClient will handle payload transformation, but audio needs DB access
        # which RequestTransformer currently doesn't support.
        # We modify the payload in-place (or copy) before passing to CapabilityClient?
        # materialize_input_audio_in_payload modifies in-place.
        # But CapabilityClient.call does transformation on `request`.
        # So we should run audio materialization on the original payload?
        # materialize_input_audio_in_payload expects OpenAI-like structure.
        # If payload is OpenAI-like, this works.
        await materialize_input_audio_in_payload(payload, user_id=str(api_key.user_id), db=db)
    except AudioStorageNotConfigured as exc:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=str(exc),
            retryable=False,
            penalize=False,
            error_category="audio_storage_not_configured",
        )
    except FileNotFoundError:
        return TransportResult(
            success=False,
            status_code=400,
            error_text="input_audio 不存在或不可访问",
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )
    except ValueError as exc:
        return TransportResult(
            success=False,
            status_code=400,
            error_text=str(exc),
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )
    except Exception:
        return TransportResult(
            success=False,
            status_code=400,
            error_text="input_audio 处理失败",
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )

    # Build Headers (CapabilityConfig has headers, but we need dynamic auth)
    # CapabilityClient merges passed headers.
    # We construct auth headers here.
    # TODO: Refactor build_upstream_headers to separate auth from other headers if needed.
    # For now, we assume simple Bearer/x-api-key based on some logic, or use build_upstream_headers
    # with a guessed style.
    
    # We use a simple auth header construction based on provider config or capability adapter hint?
    # CapabilityConfig doesn't strictly enforce auth style, but we can infer or default to Bearer.
    
    auth_headers: dict[str, str] = {}
    is_claude = capability_config.adapter and "claude" in capability_config.adapter
    # Also check endpoint for anthropic?
    if not is_claude and "anthropic" in capability_config.endpoint:
        is_claude = True
        
    if is_claude:
        auth_headers["x-api-key"] = key_selection.key
        auth_headers["anthropic-version"] = "2023-06-01" # Default?
    else:
        auth_headers["Authorization"] = f"Bearer {key_selection.key}"
    
    if provider_cfg.custom_headers:
        auth_headers.update(provider_cfg.custom_headers)

    cap_client = CapabilityClient()
    
    # Proxy & Retry Loop (Logic adapted from call_upstream_http_with_metrics)
    proxy_url = await pick_upstream_proxy()
    timeout_cfg = _timeout_seconds(getattr(client, "timeout", settings.upstream_timeout))
    
    start = time.perf_counter()
    success = False
    status_code: int | None = None
    error_kind: str | None = None
    response_data: Any = None
    
    max_attempts = settings.upstream_proxy_max_retries + 1 if proxy_url else 1
    tried: set[str] = set()
    last_exc: Exception | None = None
    
    for attempt in range(max_attempts):
        current_proxy = None
        if proxy_url:
            if attempt == 0:
                current_proxy = proxy_url
            else:
                current_proxy = await pick_upstream_proxy(exclude=tried)
            if not current_proxy:
                break
            tried.add(current_proxy)
        
        try:
            # Create client for this attempt
            async with httpx.AsyncClient(
                timeout=timeout_cfg,
                proxy=current_proxy,
                trust_env=True,
            ) as attempt_client:
                # Execute via CapabilityClient
                response_data = await cap_client.call(
                    config=capability_config,
                    request=payload,
                    headers=auth_headers,
                    client=attempt_client
                )
                success = True
                status_code = 200 # CapabilityClient.call returns parsed data on success (implied 200/2xx)
                
                # If proxy was used, log success
                if current_proxy:
                    logger.info(
                        "execute_capability_transport: 代理 %s 请求成功 (provider=%s logical=%s)",
                        mask_proxy_url(current_proxy),
                        provider_id,
                        logical_model_id,
                    )
                break

        except CapabilityClientError as exc:
            status_code = exc.status_code
            error_text = str(exc)
            last_exc = exc
            
            # Proxy failure handling
            if current_proxy and (status_code is None or status_code >= 500):
                await report_upstream_proxy_failure(current_proxy)
                if attempt + 1 < max_attempts:
                    logger.warning(
                        "execute_capability_transport: 代理 %s 失败，重试 (%d/%d): %s",
                        mask_proxy_url(current_proxy),
                        attempt + 2,
                        max_attempts,
                        exc,
                    )
                    continue
            
            # Non-proxy or max retries reached
            break
        except Exception as exc:
            last_exc = exc
            break

    latency_ms = (time.perf_counter() - start) * 1000.0
    
    # Record Metrics
    try:
        record_provider_call_metric(
            db,
            provider_id=provider_id,
            logical_model=logical_model_id,
            transport="http", # capability client essentially uses http
            is_stream=False,
            user_id=api_key.user_id,
            api_key_id=api_key.id,
            success=success,
            latency_ms=latency_ms,
            status_code=status_code,
            error_kind="timeout" if isinstance(last_exc, httpx.TimeoutException) else None,
        )
    except Exception:
        logger.exception("Failed to record metrics in execute_capability_transport")

    if success:
        record_key_success(key_selection, redis=redis)
        return TransportResult(
            success=True,
            response=JSONResponse(content=response_data, status_code=200),
        )
    
    # Handle Failure
    error_text = str(last_exc) if last_exc else "Unknown error"
    
    if status_code and status_code >= 400:
        # Check capability mismatch (handled in CapabilityClientError?)
        # CapabilityClientError doesn't expose raw response body text easily unless in response_body
        response_body = getattr(last_exc, "response_body", None)
        response_text = str(response_body) if response_body else error_text
        
        mismatch = classify_capability_mismatch(status_code, response_text)
        if mismatch:
            return TransportResult(
                success=False,
                status_code=status_code,
                error_text=response_text,
                retryable=True,
                penalize=False,
                error_category=f"capability_mismatch:{mismatch}",
            )

        retryable = _is_retryable_upstream_status(provider_id, status_code)
        record_key_failure(key_selection, retryable=retryable, status_code=status_code, redis=redis)
        return TransportResult(
            success=False,
            status_code=status_code,
            error_text=response_text,
            retryable=retryable,
        )

    # Network/Timeout error
    record_key_failure(key_selection, retryable=True, status_code=None, redis=redis)
    return TransportResult(success=False, error_text=error_text, retryable=True)


async def execute_http_transport(
    *,
    client: httpx.AsyncClient,
    redis: Redis,
    db: DbSession,
    provider_id: str,
    model_id: str,
    url: str,
    payload: dict[str, Any],
    logical_model_id: str,
    api_style: str,
    upstream_api_style: str = "openai",
    api_key: AuthenticatedAPIKey,
    messages_path_override: str | None = None,
    fallback_path_override: str | None = None,
) -> TransportResult:
    provider_cfg = provider_config.get_provider_config(provider_id)
    if provider_cfg is None:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=f"Provider '{provider_id}' is not configured",
            retryable=False,
        )

    try:
        key_selection = await acquire_provider_key(provider_cfg, redis)
    except NoAvailableProviderKey as exc:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=str(exc),
            retryable=False,
        )

    target = resolve_http_upstream_target(
        provider_cfg,
        requested_api_style=api_style,
        default_url=url,
        default_upstream_style=upstream_api_style,
        messages_path_override=messages_path_override,
        fallback_path_override=fallback_path_override,
    )
    call_style = target.api_style
    call_url = target.url

    headers = build_upstream_headers(
        key_selection.key, provider_cfg, call_style=call_style, is_stream=False
    )

    try:
        upstream_payload = adapt_request_payload(
            payload,
            from_style=api_style,
            to_style=call_style,
            upstream_model_id=model_id,
        )
    except Exception as exc:
        record_key_failure(key_selection, retryable=False, status_code=400, redis=redis)
        return TransportResult(
            success=False,
            status_code=400,
            error_text=f"Failed to adapt request payload: {exc}",
            retryable=False,
        )

    try:
        await materialize_input_audio_in_payload(upstream_payload, user_id=str(api_key.user_id), db=db)
    except AudioStorageNotConfigured as exc:
        return TransportResult(
            success=False,
            status_code=503,
            error_text=str(exc),
            retryable=False,
            penalize=False,
            error_category="audio_storage_not_configured",
        )
    except FileNotFoundError:
        return TransportResult(
            success=False,
            status_code=400,
            error_text="input_audio 不存在或不可访问",
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )
    except ValueError as exc:
        return TransportResult(
            success=False,
            status_code=400,
            error_text=str(exc),
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )
    except Exception:
        return TransportResult(
            success=False,
            status_code=400,
            error_text="input_audio 处理失败",
            retryable=False,
            penalize=False,
            error_category="invalid_input_audio",
        )

    try:
        r = await call_upstream_http_with_metrics(
            client=client,
            url=call_url,
            headers=headers,
            json_body=upstream_payload,
            db=db,
            provider_id=provider_id,
            logical_model=logical_model_id,
            user_id=api_key.user_id,
            api_key_id=api_key.id,
        )
    except httpx.HTTPError as exc:
        record_key_failure(key_selection, retryable=True, status_code=None, redis=redis)
        return TransportResult(success=False, error_text=str(exc), retryable=True)

    status_code = r.status_code
    text = r.text
    if status_code >= 400:
        mismatch = classify_capability_mismatch(status_code, text)
        if mismatch:
            # 该 provider/模型不支持某能力：对路由来说是“换 provider 重试”，但不应惩罚该 provider/key。
            return TransportResult(
                success=False,
                status_code=status_code,
                error_text=text,
                retryable=True,
                penalize=False,
                error_category=f"capability_mismatch:{mismatch}",
            )

        retryable = _is_retryable_upstream_status(provider_id, status_code)
        record_key_failure(
            key_selection,
            retryable=retryable,
            status_code=status_code,
            redis=redis,
        )
        return TransportResult(
            success=False,
            status_code=status_code,
            error_text=text,
            retryable=retryable,
        )

    record_key_success(key_selection, redis=redis)
    try:
        content = r.json()
    except ValueError:
        content = {"raw": text}

    try:
        adapted = adapt_response_payload(
            content,
            from_style=call_style,
            to_style=api_style,
            request_model=str(payload.get("model") or model_id),
        )
    except Exception:
        adapted = content

    return TransportResult(
        success=True,
        response=JSONResponse(content=adapted, status_code=status_code),
    )


__all__ = [
    "TransportResult",
    "_build_headers",
    "execute_http_transport",
]
