"""
流式传输层处理（v2）

输出约定：返回的 bytes 直接作为网关响应 body（SSE/事件流），保持与请求 api_style 一致。
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover
    Redis = object  # type: ignore

from sqlalchemy.orm import Session as DbSession

from app.api.v1.chat.header_builder import build_upstream_headers
from app.api.v1.chat.protocol_adapter import adapt_request_payload
from app.api.v1.chat.protocol_stream_adapter import adapt_stream
from app.api.v1.chat.provider_endpoint_resolver import resolve_http_upstream_target
from app.api.v1.chat.upstream_error_classifier import classify_capability_mismatch
from app.auth import AuthenticatedAPIKey
from app.provider import config as provider_config
from app.provider.key_pool import (
    NoAvailableProviderKey,
    acquire_provider_key,
    record_key_failure,
    record_key_success,
)
from app.services.chat_routing_service import (
    _is_retryable_upstream_status,
)
from app.services.audio_input_service import (
    AudioStorageNotConfigured,
    InputAudioMaterializeError,
    materialize_input_audio_in_payload,
)
from app.services.metrics_service import (
    stream_upstream_with_metrics,
    record_provider_call_metric,
    _timeout_seconds,
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
from app.upstream import UpstreamStreamError


async def execute_capability_stream(
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
) -> AsyncIterator[bytes]:
    """
    使用 CapabilityConfig 执行流式上游调用。
    """
    provider_cfg = provider_config.get_provider_config(provider_id)
    if provider_cfg is None:
        raise Exception(f"Provider '{provider_id}' is not configured")

    try:
        key_selection = await acquire_provider_key(provider_cfg, redis)
    except NoAvailableProviderKey as exc:
        raise Exception(str(exc))

    try:
        await materialize_input_audio_in_payload(payload, user_id=str(api_key.user_id), db=db)
    except AudioStorageNotConfigured as exc:
        raise InputAudioMaterializeError(str(exc), status_code=503) from exc
    except FileNotFoundError as exc:
        raise InputAudioMaterializeError("input_audio 不存在或不可访问", status_code=400) from exc
    except ValueError as exc:
        raise InputAudioMaterializeError(str(exc), status_code=400) from exc
    except Exception as exc:
        raise InputAudioMaterializeError("input_audio 处理失败", status_code=400) from exc

    # Auth headers
    auth_headers: dict[str, str] = {}
    is_claude = capability_config.adapter and "claude" in capability_config.adapter
    if not is_claude and "anthropic" in capability_config.endpoint:
        is_claude = True
        
    if is_claude:
        auth_headers["x-api-key"] = key_selection.key
        auth_headers["anthropic-version"] = "2023-06-01"
    else:
        auth_headers["Authorization"] = f"Bearer {key_selection.key}"
    
    if provider_cfg.custom_headers:
        auth_headers.update(provider_cfg.custom_headers)

    cap_client = CapabilityClient()
    
    # Proxy & Retry Loop
    proxy_url = await pick_upstream_proxy()
    timeout_cfg = _timeout_seconds(getattr(client, "timeout", settings.upstream_timeout))
    
    start = time.perf_counter()
    first_chunk_seen = False
    
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
                # stream yields chunks
                iterator = cap_client.call_stream(
                    config=capability_config,
                    request=payload,
                    headers=auth_headers,
                    client=attempt_client
                )
                
                async for chunk in iterator:
                    if not first_chunk_seen:
                        first_chunk_seen = True
                        latency_ms = (time.perf_counter() - start) * 1000.0
                        if current_proxy:
                            logger.info(
                                "execute_capability_stream: 代理 %s 首包到达 (provider=%s logical=%s ttfb=%.2fms)",
                                mask_proxy_url(current_proxy),
                                provider_id,
                                logical_model_id,
                                latency_ms,
                            )
                        try:
                            record_provider_call_metric(
                                db,
                                provider_id=provider_id,
                                logical_model=logical_model_id,
                                
                                is_stream=True,
                                user_id=api_key.user_id,
                                api_key_id=api_key.id,
                                success=True,
                                latency_ms=latency_ms,
                            )
                        except Exception:
                            pass
                    yield chunk
                
                # If we finish the stream successfully
                record_key_success(key_selection, redis=redis)
                return

        except CapabilityClientError as exc:
            last_exc = exc
            status_code = exc.status_code
            
            # Proxy retry logic
            if current_proxy and (status_code is None or status_code >= 500):
                await report_upstream_proxy_failure(current_proxy)
                if attempt + 1 < max_attempts:
                    logger.warning(
                        "execute_capability_stream: 代理 %s 失败，重试 (%d/%d): %s",
                        mask_proxy_url(current_proxy),
                        attempt + 2,
                        max_attempts,
                        exc,
                    )
                    continue
            
            # If we saw first chunk, we already yielded success, so we just raise the error for the stream
            if first_chunk_seen:
                raise
            
            # If not first chunk seen, this attempt failed completely
            break
        except Exception as exc:
            last_exc = exc
            if first_chunk_seen:
                raise
            break

    # If we reached here without returning, it means total failure (no chunks yielded)
    latency_ms = (time.perf_counter() - start) * 1000.0
    status_code = getattr(last_exc, "status_code", None) if isinstance(last_exc, CapabilityClientError) else None
    
    try:
        record_provider_call_metric(
            db,
            provider_id=provider_id,
            logical_model=logical_model_id,
            
            is_stream=True,
            user_id=api_key.user_id,
            api_key_id=api_key.id,
            success=False,
            latency_ms=latency_ms,
            status_code=status_code,
        )
    except Exception:
        pass

    if last_exc:
        # Wrap in UpstreamStreamError or re-raise
        if isinstance(last_exc, CapabilityClientError):
             # Map to UpstreamStreamError for retry logic compatibility
             mismatch = classify_capability_mismatch(last_exc.status_code, str(last_exc))
             retryable = True if mismatch else _is_retryable_upstream_status(provider_id, last_exc.status_code)
             # Note: UpstreamStreamError expects text, status_code
             raise UpstreamStreamError(
                 status_code=last_exc.status_code,
                 text=str(last_exc),
                 retryable=retryable
             ) from last_exc
        raise last_exc
    
    raise Exception("Unknown stream execution failure")


async def execute_http_stream(
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
) -> AsyncIterator[bytes]:
    provider_cfg = provider_config.get_provider_config(provider_id)
    if provider_cfg is None:
        raise Exception(f"Provider '{provider_id}' is not configured")

    try:
        key_selection = await acquire_provider_key(provider_cfg, redis)
    except NoAvailableProviderKey as exc:
        raise Exception(str(exc))

    async def _noop_bind_session(_provider_id: str, _model_id: str) -> None:
        return

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

    headers = build_upstream_headers(key_selection.key, provider_cfg, call_style=call_style, is_stream=True)

    try:
        upstream_payload = adapt_request_payload(
            payload,
            from_style=api_style,
            to_style=call_style,
            upstream_model_id=model_id,
        )
    except Exception as exc:
        record_key_failure(key_selection, retryable=False, status_code=400, redis=redis)
        raise Exception(f"Failed to adapt request payload: {exc}")

    try:
        await materialize_input_audio_in_payload(upstream_payload, user_id=str(api_key.user_id), db=db)
    except AudioStorageNotConfigured as exc:
        raise InputAudioMaterializeError(str(exc), status_code=503) from exc
    except FileNotFoundError as exc:
        raise InputAudioMaterializeError("input_audio 不存在或不可访问", status_code=400) from exc
    except ValueError as exc:
        raise InputAudioMaterializeError(str(exc), status_code=400) from exc
    except Exception as exc:
        raise InputAudioMaterializeError("input_audio 处理失败", status_code=400) from exc

    upstream_payload["stream"] = True

    async def _upstream_iter() -> AsyncIterator[bytes]:
        sse_style = call_style if call_style in ("openai", "claude") else "openai"
        async for chunk in stream_upstream_with_metrics(
            client=client,
            method="POST",
            url=call_url,
            headers=headers,
            json_body=upstream_payload,
            redis=redis,
            sse_style=sse_style,
            db=db,
            provider_id=provider_id,
            logical_model=logical_model_id,
            user_id=api_key.user_id,
            api_key_id=api_key.id,
        ):
            yield chunk

    try:
        iterator: AsyncIterator[bytes] = _upstream_iter()
        if call_style != api_style:
            iterator = adapt_stream(
                iterator,
                from_style=call_style,
                to_style=api_style,
                request_model=str(payload.get("model") or model_id),
            )
        async for chunk in iterator:
            yield chunk
        record_key_success(key_selection, redis=redis)
    except UpstreamStreamError as err:
        mismatch = classify_capability_mismatch(err.status_code, getattr(err, "text", None))
        retryable = True if mismatch else _is_retryable_upstream_status(provider_id, err.status_code)
        if mismatch:
            err.retryable = True
            err.penalize = False
            raise
        record_key_failure(
            key_selection,
            retryable=retryable,
            status_code=err.status_code,
            redis=redis,
        )
        raise
    except Exception:
        record_key_failure(key_selection, retryable=True, status_code=None, redis=redis)
        raise


__all__ = [
    "execute_http_stream",
]
