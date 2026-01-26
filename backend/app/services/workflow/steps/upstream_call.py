"""
UpstreamCallStep: 上游调用步骤

职责：
- 向上游服务发起 HTTP 请求
- 支持超时/重试/熔断
- 支持流式响应
- 支持流式 Token 计数和计费
- 记录上游调用指标
"""

import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import urljoin, urlparse

import httpx

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.services.system import CancelService
from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.core.metrics import record_upstream_call
from app.repositories.bandit_repository import BanditRepository
from app.services.providers.routing_selector import RoutingSelector
from app.services.providers.config_utils import deep_merge, extract_by_path, render_value
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.proxy.proxy_pool import get_proxy_pool, mask_proxy_url
from app.services.secrets.manager import SecretManager
from app.utils.security import is_hostname_whitelisted, is_safe_upstream_url
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepConfig,
    StepResult,
    StepStatus,
)

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)
MAX_UPSTREAM_REDIRECTS = 3


def _model_allowed(allowed_models: list[str] | None, model: str | None) -> bool:
    if not allowed_models:
        return True
    if not model:
        return False
    return model in allowed_models


def _jsonify_payload(payload: Any) -> Any:
    """将请求体转换为可 JSON 序列化的结构（避免 UUID 等类型报错）。"""
    return json.loads(json.dumps(payload, default=str))


def _parse_response_body(response: httpx.Response) -> Any:
    """解析上游响应体，避免 JSONDecodeError 直接冒泡。"""
    if not response.content:
        return {}
    try:
        return response.json()
    except json.JSONDecodeError:
        return {"raw_text": response.text}


def _truncate_text(text: str, limit: int = 2000) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...(truncated)"


def _safe_log_payload(payload: Any, limit: int = 2000) -> str:
    try:
        text = json.dumps(payload, ensure_ascii=False)
    except Exception:
        text = str(payload)
    return _truncate_text(text, limit)


def _filter_headers_for_log(headers: httpx.Headers) -> dict[str, str]:
    allowed = {"www-authenticate", "x-request-id", "x-trace-id", "x-error-code"}
    return {k: v for k, v in headers.items() if k.lower() in allowed}


def _mask_secret_ref(secret_ref: str | None) -> str:
    if not secret_ref:
        return ""
    if len(secret_ref) <= 8:
        return "*" * len(secret_ref)
    return f"{secret_ref[:4]}...{secret_ref[-4:]}"


@dataclass
class StreamTokenAccumulator:
    """
    流式 Token 累计器

    用于在流式响应过程中累计 token 用量：
    - 解析 OpenAI SSE 格式的响应
    - 累计 input/output tokens
    - 支持中断时获取部分用量
    """
    input_tokens: int = 0
    output_tokens: int = 0
    chunks_count: int = 0
    is_completed: bool = False
    error: str | None = None
    finish_reason: str | None = None
    model: str | None = None
    assistant_content: list[str] = field(default_factory=list)
    tool_call_names: list[str] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def assistant_text(self) -> str:
        return "".join(self.assistant_content)

    def parse_sse_chunk(self, chunk: bytes) -> None:
        """
        解析 SSE 块并累计 token

        OpenAI 格式：
        - data: {...}
        - data: [DONE]

        Token 用量通常在最后一个非 [DONE] 块的 usage 字段中
        """
        try:
            text = chunk.decode("utf-8")
            for line in text.split("\n"):
                line = line.strip()
                if not line or line == "data: [DONE]":
                    if line == "data: [DONE]":
                        self.is_completed = True
                    continue

                if line.startswith("data: "):
                    json_str = line[6:]  # 去掉 "data: "
                    try:
                        data = json.loads(json_str)
                        self.chunks_count += 1

                        # 提取 model
                        if not self.model and "model" in data:
                            self.model = data["model"]

                        # 提取 finish_reason
                        if data.get("choices"):
                            choice = data["choices"][0]
                            if choice.get("finish_reason"):
                                self.finish_reason = choice["finish_reason"]
                            delta = choice.get("delta") or choice.get("message") or {}
                            content = delta.get("content")
                            if isinstance(content, str) and content:
                                self.assistant_content.append(content)

                            tool_calls = delta.get("tool_calls")
                            if isinstance(tool_calls, list):
                                for tc in tool_calls:
                                    func = tc.get("function") if isinstance(tc, dict) else None
                                    name = None
                                    if isinstance(func, dict):
                                        name = func.get("name")
                                    if not name and isinstance(tc, dict):
                                        name = tc.get("name")
                                    if name and name not in self.tool_call_names:
                                        self.tool_call_names.append(name)

                        # 提取 usage（通常在最后一个块）
                        if "usage" in data:
                            usage = data["usage"]
                            self.input_tokens = usage.get("prompt_tokens", 0)
                            self.output_tokens = usage.get("completion_tokens", 0)

                    except json.JSONDecodeError:
                        pass  # 忽略解析错误
        except Exception as e:
            self.error = str(e)

    def estimate_output_tokens(self) -> int:
        """
        估算输出 token 数（当没有 usage 信息时）

        基于 chunks 数量估算，每个 chunk 约 1-5 个 token
        这是一个保守估计，实际可能更多
        """
        if self.output_tokens > 0:
            return self.output_tokens
        # 每个 chunk 约 3 个 token（保守估计）
        return max(1, self.chunks_count * 3)


async def stream_with_billing(
    stream: AsyncIterator[bytes],
    ctx: "WorkflowContext",
    accumulator: StreamTokenAccumulator,
    on_complete: Callable[["WorkflowContext", StreamTokenAccumulator], Any] | None = None,
) -> AsyncIterator[bytes]:
    """
    流式响应包装器，在流完成后触发计费

    用法：
        wrapped_stream = stream_with_billing(original_stream, ctx, accumulator, on_complete=billing_callback)
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    Args:
        stream: 原始字节流
        ctx: 工作流上下文
        accumulator: Token 累计器
        on_complete: 流完成时的回调函数，用于触发计费
    """
    tool_call_emitted = False
    request_id = ctx.get("request", "request_id")
    cancel_service = CancelService()
    can_check_cancel = bool(request_id and ctx.user_id)
    last_cancel_check = 0.0
    try:
        async for chunk in stream:
            if can_check_cancel and time.monotonic() - last_cancel_check > 0.3:
                last_cancel_check = time.monotonic()
                if await cancel_service.consume_cancel(
                    capability="chat",
                    user_id=str(ctx.user_id),
                    request_id=str(request_id),
                ):
                    ctx.mark_error(ErrorSource.CLIENT, "CLIENT_CANCELLED", "client canceled")
                    accumulator.error = "client canceled"
                    break
            # 解析并累计 token
            accumulator.parse_sse_chunk(chunk)
            if (
                not tool_call_emitted
                and accumulator.tool_call_names
            ):
                ctx.emit_status(
                    stage="evolve",
                    step="tool_call",
                    state="running",
                    code="tool.call",
                    meta={"name": accumulator.tool_call_names[0]},
                )
                tool_call_emitted = True
            yield chunk
    except Exception as e:
        accumulator.error = str(e)
        logger.error(f"Stream error trace_id={ctx.trace_id}: {e}")
    finally:
        # 更新上下文中的 billing 信息
        output_tokens = accumulator.output_tokens or accumulator.estimate_output_tokens()
        ctx.billing.input_tokens = accumulator.input_tokens
        ctx.billing.output_tokens = output_tokens

        logger.info(
            f"Stream completed trace_id={ctx.trace_id} "
            f"input_tokens={accumulator.input_tokens} "
            f"output_tokens={output_tokens} "
            f"chunks={accumulator.chunks_count} "
            f"completed={accumulator.is_completed}"
        )

        # 触发计费回调
        if on_complete:
            try:
                result = on_complete(ctx, accumulator)
                if hasattr(result, "__await__"):
                    await result
            except Exception as e:
                logger.error(f"Billing callback error trace_id={ctx.trace_id}: {e}")


class UpstreamError(Exception):
    """上游调用异常"""

    def __init__(
        self,
        status_code: int | None,
        message: str,
        upstream_body: dict | None = None,
    ):
        self.status_code = status_code
        self.upstream_body = upstream_body
        super().__init__(f"Upstream error: status={status_code}, message={message}")


class UpstreamTimeoutError(UpstreamError):
    """上游超时"""

    def __init__(self, timeout: float):
        super().__init__(None, f"Request timed out after {timeout}s")
        self.timeout = timeout


class UpstreamSecurityError(Exception):
    """上游安全策略拦截"""


class UpstreamAuthError(Exception):
    """上游鉴权缺失/不可用"""


@step_registry.register
class UpstreamCallStep(BaseStep):
    """
    上游调用步骤

    从上下文读取:
        - template_render.upstream_url: 渲染后的 URL
        - template_render.request_body: 渲染后的请求体
        - template_render.headers: 渲染后的请求头
        - routing.auth_config: 鉴权配置

    写入上下文:
        - upstream_call.response: 上游响应
        - upstream_call.status_code: HTTP 状态码
        - upstream_call.latency_ms: 调用耗时
        - upstream_call.stream: 是否流式

    同时更新 ctx.upstream_result
    """

    name = "upstream_call"
    depends_on = ["template_render"]
    retry_on = (httpx.TimeoutException, httpx.NetworkError)

    # 熔断状态：优先 Redis，进程内为兜底
    _cb_state: dict[str, dict[str, Any]] = {}

    def __init__(self, config: StepConfig | None = None):
        if config is None:
            config = StepConfig(
                timeout=120.0,
                max_retries=2,
                retry_delay=1.0,
                retry_backoff=2.0,
            )
        super().__init__(config)
        self.secret_manager = SecretManager()
        self.proxy_pool = get_proxy_pool()

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行上游调用"""
        upstream_url = ctx.get("template_render", "upstream_url")
        request_body = ctx.get("template_render", "request_body") or {}
        headers = ctx.get("template_render", "headers") or {}
        async_config = ctx.get("routing", "async_config") or {}
        async_enabled = async_config.get("enabled") is True
        http_method = (ctx.get("routing", "http_method") or "POST").upper()

        if async_enabled:
            submit_headers = async_config.get("submit_headers") or {}
            submit_headers = render_value(
                submit_headers,
                {"request": request_body, "input": request_body},
            )
            headers = deep_merge(headers, submit_headers)

        if (ctx.capability or "").lower() in {"image_generation"}:
            has_response_format = "response_format" in request_body
            response_format = request_body.get("response_format")
            logger.info(
                "image_upstream_request_format trace_id=%s provider=%s model=%s present=%s value=%s",
                ctx.trace_id,
                ctx.get("routing", "provider") or "unknown",
                ctx.requested_model or "unknown",
                has_response_format,
                response_format,
            )

        if not upstream_url:
            return StepResult(
                status=StepStatus.FAILED,
                message="No upstream URL provided",
            )

        auth_config = ctx.get("routing", "auth_config") or {}
        cb_key = self._build_cb_key(upstream_url, auth_config.get("secret_ref_id"))

        # 上游地址安全校验（白名单直通 + SSRF 阻断）
        if not is_safe_upstream_url(upstream_url):
            ctx.mark_error(
                ErrorSource.GATEWAY,
                "UPSTREAM_DOMAIN_NOT_ALLOWED",
                "Upstream URL blocked by security policy",
            )
            return StepResult(
                status=StepStatus.FAILED,
                message="Upstream URL blocked by security policy",
            )

        # 熔断保护
        if await self._is_circuit_open(cb_key):
            ctx.mark_error(
                ErrorSource.UPSTREAM,
                "UPSTREAM_CIRCUIT_OPEN",
                "Upstream temporarily blocked due to failures",
            )
            return StepResult(
                status=StepStatus.FAILED,
                message="Upstream circuit open",
            )

        # 添加认证头
        auth_headers = await self._get_auth_headers(ctx)
        headers.update(auth_headers)

        # 判断是否流式
        is_stream = request_body.get("stream", False)
        if async_enabled and is_stream:
            logger.warning(
                "async_flow_disable_stream trace_id=%s provider=%s model=%s",
                ctx.trace_id,
                ctx.get("routing", "provider") or "unknown",
                ctx.requested_model or "unknown",
            )
            request_body["stream"] = False
            is_stream = False
        ctx.set("upstream_call", "stream", is_stream)
        ctx.emit_status(
            stage="evolve",
            step=self.name,
            state="running",
            code="upstream.request.stream" if is_stream else "upstream.request.batch",
        )

        # 允许从 routing.limit_config 覆盖超时
        limit_config = ctx.get("routing", "limit_config") or {}
        timeout = float(limit_config.get("timeout") or self.config.timeout)

        start_time = time.perf_counter()

        try:
            if is_stream:
                # 流式请求：创建累计器并返回生成器
                accumulator = StreamTokenAccumulator()
                ctx.set("upstream_call", "stream_accumulator", accumulator)

                response_stream = self._call_upstream_stream(
                    ctx=ctx,
                    url=upstream_url,
                    body=request_body,
                    headers=headers,
                    timeout=timeout,
                    accumulator=accumulator,
                )
                ctx.set("upstream_call", "response_stream", response_stream)
                ctx.set("upstream_call", "status_code", 200)  # 流式假设成功
                await self._mark_success(cb_key)
                record_upstream_call(
                    provider=ctx.get("routing", "provider") or "unknown",
                    model=ctx.requested_model or "unknown",
                    success=True,
                    latency_ms=0,
                )

            else:
                # 非流式请求
                response = await self._call_upstream(
                    ctx=ctx,
                    url=upstream_url,
                    body=request_body,
                    headers=headers,
                    timeout=timeout,
                    method=http_method,
                )

                if async_enabled:
                    submit_payload = self._normalize_json_response(response.get("body"))
                    final_response = await self._poll_async_result(
                        ctx=ctx,
                        submit_response=submit_payload,
                        async_config=async_config,
                        base_headers=headers,
                        submit_url=upstream_url,
                    )
                    ctx.set("upstream_call", "response", final_response)
                    ctx.set("upstream_call", "status_code", 200)
                    ctx.set("upstream_call", "headers", response.get("headers") or {})
                else:
                    # 响应大小限制
                    if response.get("raw_bytes"):
                        if len(response["raw_bytes"]) > settings.MAX_RESPONSE_BYTES:
                            ctx.mark_error(
                                ErrorSource.UPSTREAM,
                                "UPSTREAM_RESPONSE_TOO_LARGE",
                                "Upstream response exceeds size limit",
                                upstream_status=response.get("status_code"),
                            )
                            await self._mark_failure(cb_key)
                            return StepResult(
                                status=StepStatus.FAILED,
                                message="Upstream response too large",
                            )

                    ctx.set("upstream_call", "response", response["body"])
                    ctx.set("upstream_call", "status_code", response["status_code"])
                    ctx.set("upstream_call", "headers", response["headers"])

            latency_ms = (time.perf_counter() - start_time) * 1000
            ctx.set("upstream_call", "latency_ms", latency_ms)

            # 更新 upstream_result
            ctx.upstream_result.provider = ctx.get("routing", "provider")
            ctx.upstream_result.model = ctx.requested_model
            ctx.upstream_result.upstream_url = upstream_url
            ctx.upstream_result.status_code = ctx.get("upstream_call", "status_code")
            ctx.upstream_result.latency_ms = latency_ms

            await self._mark_success(cb_key)
            record_upstream_call(
                provider=ctx.get("routing", "provider") or "unknown",
                model=ctx.requested_model or "unknown",
                success=True,
                latency_ms=latency_ms,
            )
            await self._record_bandit_feedback(
                ctx=ctx,
                success=True,
                latency_ms=latency_ms,
            )
            
            # 记录路由亲和成功（P1-5）
            await self._record_affinity_success(ctx)

            # 亲和节省估算：仅在命中亲和且有 token 计费数据时计算
            affinity_hit = ctx.get("routing", "affinity_hit", False)
            if affinity_hit and getattr(ctx, "billing", None) and ctx.billing.total_tokens > 0:
                discount = max(0.0, min(1.0, float(settings.AFFINITY_ROUTING_DISCOUNT_RATE)))
                saved_tokens = int(ctx.billing.total_tokens * discount)
                saved_cost = float(ctx.billing.total_cost) * discount if ctx.billing.total_cost else 0.0
                ctx.set("routing", "affinity_saved_tokens_est", saved_tokens)
                ctx.set("routing", "affinity_saved_cost_est", saved_cost)
            else:
                ctx.set("routing", "affinity_saved_tokens_est", 0)
                ctx.set("routing", "affinity_saved_cost_est", 0.0)

            logger.info(
                f"Upstream call completed trace_id={ctx.trace_id} "
                f"url={upstream_url} status={ctx.upstream_result.status_code} "
                f"latency_ms={latency_ms:.2f}"
            )

            if is_stream:
                ctx.emit_status(
                    stage="evolve",
                    step=self.name,
                    state="streaming",
                    code="upstream.streaming",
                )
            else:
                ctx.emit_status(
                    stage="evolve",
                    step=self.name,
                    state="success",
                    code="upstream.response",
                    meta={"latency_ms": round(latency_ms)},
                )

            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "status_code": ctx.upstream_result.status_code,
                    "latency_ms": latency_ms,
                    "stream": is_stream,
                },
            )

        except UpstreamSecurityError as e:
            ctx.mark_error(
                ErrorSource.GATEWAY,
                "UPSTREAM_DOMAIN_NOT_ALLOWED",
                str(e),
            )
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )

        except httpx.TimeoutException:
            latency_ms = (time.perf_counter() - start_time) * 1000
            ctx.upstream_result.latency_ms = latency_ms
            ctx.upstream_result.error_code = "UPSTREAM_TIMEOUT"
            ctx.mark_error(
                ErrorSource.UPSTREAM,
                "UPSTREAM_TIMEOUT",
                f"Request timed out after {self.config.timeout}s",
                upstream_status=None,
                upstream_code="UPSTREAM_TIMEOUT",
            )
            await self._mark_failure(cb_key)
            record_upstream_call(
                provider=ctx.get("routing", "provider") or "unknown",
                model=ctx.requested_model or "unknown",
                success=False,
                latency_ms=latency_ms,
                error_code="timeout",
            )
            await self._record_bandit_feedback(
                ctx=ctx,
                success=False,
                latency_ms=latency_ms,
            )
            await self._record_affinity_failure(ctx)
            raise UpstreamTimeoutError(self.config.timeout)

        except httpx.HTTPStatusError as e:
            latency_ms = (time.perf_counter() - start_time) * 1000
            ctx.upstream_result.status_code = e.response.status_code
            ctx.upstream_result.latency_ms = latency_ms
            ctx.upstream_result.error_code = f"HTTP_{e.response.status_code}"
            upstream_body = _parse_response_body(e.response)
            safe_headers = _filter_headers_for_log(e.response.headers)
            logger.warning(
                "Upstream http error trace_id=%s status=%s url=%s provider=%s body=%s headers=%s",
                ctx.trace_id,
                e.response.status_code,
                upstream_url,
                ctx.get("routing", "provider") or "unknown",
                _safe_log_payload(upstream_body),
                safe_headers,
            )
            ctx.mark_error(
                ErrorSource.UPSTREAM,
                f"UPSTREAM_{e.response.status_code}",
                str(e),
                upstream_status=e.response.status_code,
                upstream_code=f"HTTP_{e.response.status_code}",
            )
            await self._mark_failure(cb_key)
            record_upstream_call(
                provider=ctx.get("routing", "provider") or "unknown",
                model=ctx.requested_model or "unknown",
                success=False,
                latency_ms=latency_ms,
                error_code=f"http_{e.response.status_code}",
            )
            await self._record_bandit_feedback(
                ctx=ctx,
                success=False,
                latency_ms=latency_ms,
            )
            await self._record_affinity_failure(ctx)
            raise UpstreamError(e.response.status_code, str(e))

        except Exception as e:
            ctx.mark_error(ErrorSource.UPSTREAM, "UPSTREAM_ERROR", str(e))
            await self._mark_failure(cb_key)
            await self._record_bandit_feedback(
                ctx=ctx,
                success=False,
                latency_ms=None,
            )
            await self._record_affinity_failure(ctx)
            raise

    async def _get_auth_headers(self, ctx: "WorkflowContext") -> dict[str, str]:
        """
        获取上游认证头

        实际实现应该：
        1. 从 auth_config 获取密钥引用 ID
        2. 从密钥管理器获取实际密钥
        3. 根据 auth_type 构建认证头
        """
        auth_type = ctx.get("routing", "auth_type") or "bearer"
        auth_config = ctx.get("routing", "auth_config") or {}
        provider = ctx.get("routing", "provider") or auth_config.get("provider")
        secret_ref = auth_config.get("secret_ref_id") or auth_config.get("secret")
        secret = await self.secret_manager.get(provider, secret_ref, ctx.db_session)
        if not secret:
            masked_ref = _mask_secret_ref(secret_ref)
            logger.warning(
                "Upstream auth secret missing trace_id=%s provider=%s auth_type=%s secret_ref_id=%s",
                ctx.trace_id,
                provider,
                auth_type,
                masked_ref,
            )
            if auth_type != "none":
                message = f"Upstream auth secret missing provider={provider} auth_type={auth_type} secret_ref_id={masked_ref}"
                ctx.mark_error(ErrorSource.UPSTREAM, "UPSTREAM_AUTH_MISSING", message, upstream_code="AUTH_MISSING")
                raise UpstreamAuthError(message)

        if auth_type == "api_key":
            header_name = auth_config.get("header", "x-api-key")
            return {header_name: secret or ""}
        if auth_type == "basic":
            return {"Authorization": f"Basic {secret or ''}"}
        if auth_type == "none":
            return {}
        # 默认 Bearer
        return {"Authorization": f"Bearer {secret or ''}"}

    @staticmethod
    def _resolve_redirect_url(current_url: str, location: str | None) -> str | None:
        if not location:
            return None
        return urljoin(current_url, location)

    async def _request_with_redirects(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        body: dict,
        headers: dict,
        timeout: float,
    ) -> httpx.Response:
        current_url = url
        redirect_count = 0

        while True:
            response = await client.request(
                method,
                current_url,
                json=body,
                headers=headers,
                timeout=timeout,
                follow_redirects=False,
            )
            if response.is_redirect:
                await response.aclose()
                if redirect_count >= MAX_UPSTREAM_REDIRECTS:
                    raise UpstreamSecurityError("Upstream redirect exceeds limit")

                next_url = self._resolve_redirect_url(
                    current_url,
                    response.headers.get("Location"),
                )
                if not next_url:
                    raise UpstreamSecurityError("Upstream redirect missing location")
                if not is_safe_upstream_url(next_url):
                    raise UpstreamSecurityError("Upstream redirect blocked by security policy")

                logger.info("Upstream redirecting url=%s -> %s", current_url, next_url)
                current_url = next_url
                redirect_count += 1
                continue
            return response

    async def _stream_with_redirects(
        self,
        client: httpx.AsyncClient,
        url: str,
        body: dict,
        headers: dict,
        timeout: float,
    ) -> AsyncIterator[bytes]:
        current_url = url
        redirect_count = 0

        while True:
            stream_ctx = client.stream(
                "POST",
                current_url,
                json=body,
                headers=headers,
                timeout=timeout,
                follow_redirects=False,
            )
            async with stream_ctx as response:
                if response.is_redirect:
                    if redirect_count >= MAX_UPSTREAM_REDIRECTS:
                        raise UpstreamSecurityError("Upstream redirect exceeds limit")

                    next_url = self._resolve_redirect_url(
                        current_url,
                        response.headers.get("Location"),
                    )
                    if not next_url:
                        raise UpstreamSecurityError("Upstream redirect missing location")
                    if not is_safe_upstream_url(next_url):
                        raise UpstreamSecurityError("Upstream redirect blocked by security policy")

                    logger.info("Upstream redirecting url=%s -> %s", current_url, next_url)
                    current_url = next_url
                    redirect_count += 1
                    continue

                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
                return

    async def _call_upstream(
        self,
        ctx: "WorkflowContext",
        url: str,
        body: dict,
        headers: dict,
        timeout: float,
        method: str,
    ) -> dict[str, Any]:
        """非流式上游调用"""
        safe_body = _jsonify_payload(body)
        proxy_attempts = max(1, settings.UPSTREAM_PROXY_MAX_RETRIES + 1)
        tried_endpoints: set[str] = set()
        last_error: Exception | None = None

        for attempt in range(proxy_attempts):
            # 模型白名单检查（如有）
            principal_models = ctx.get("external_auth", "allowed_models")
            request_model = ctx.get("request", "model")
            if not _model_allowed(principal_models, request_model):
                ctx.mark_error(
                    ErrorSource.GATEWAY,
                    "MODEL_NOT_ALLOWED",
                    "model not allowed by api key",
                )
                return {"error": "model not allowed"}
            selection = await self.proxy_pool.pick(exclude_endpoints=tried_endpoints)
            proxies = selection.as_httpx_proxies() if selection else None
            transport_kwargs = self.proxy_pool.build_transport_kwargs(selection)

            client = create_async_http_client(
                timeout=timeout,
                http2=True,
                transport_kwargs=transport_kwargs,
                proxies=proxies,
            )
            try:
                response = await self._request_with_redirects(
                    client=client,
                    method=method,
                    url=url,
                    body=safe_body,
                    headers=headers,
                    timeout=timeout,
                )
                response.raise_for_status()

                raw_bytes = response.content
                return {
                    "status_code": response.status_code,
                    "headers": dict(response.headers),
                    "body": _parse_response_body(response),
                    "raw_bytes": raw_bytes,
                }
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if selection:
                    tried_endpoints.add(selection.endpoint_id)
                    await self.proxy_pool.report_failure(selection.endpoint_id)
                    logger.debug(
                        "Upstream call retry with new proxy (attempt=%s/%s, proxy=%s)",
                        attempt + 1,
                        proxy_attempts,
                        mask_proxy_url(selection.url),
                    )
                if attempt >= proxy_attempts - 1:
                    raise
            finally:
                await client.aclose()

        if last_error:
            raise last_error
        raise RuntimeError("Upstream call failed without error context")

    def _normalize_location(self, path: str | None) -> str:
        if not path:
            return ""
        if path.startswith("body."):
            return path[5:]
        if path == "body":
            return ""
        return path

    def _normalize_json_response(self, data: Any) -> dict[str, Any]:
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"data": data}
        return {}

    def _extract_async_result(self, payload: dict[str, Any], async_config: dict[str, Any]) -> dict[str, Any]:
        extraction = async_config.get("result_extraction") or {}
        location = self._normalize_location(extraction.get("location") or "")
        result_format = extraction.get("format") or "raw"

        extracted = extract_by_path(payload, location) if location else payload
        if result_format == "url_list":
            urls = extracted if isinstance(extracted, list) else []
            return {"data": [{"url": url} for url in urls if isinstance(url, str)]}
        if result_format == "b64_list":
            items = extracted if isinstance(extracted, list) else []
            return {"data": [{"b64_json": item} for item in items if isinstance(item, str)]}
        return payload

    async def _poll_async_result(
        self,
        *,
        ctx: "WorkflowContext",
        submit_response: dict[str, Any],
        async_config: dict[str, Any],
        base_headers: dict[str, Any],
        submit_url: str,
    ) -> dict[str, Any]:
        extraction = async_config.get("task_id_extraction") or {}
        location = extraction.get("location") or "body"
        key_path = self._normalize_location(extraction.get("key_path") or "")
        source = submit_response if location == "body" else submit_response
        task_id = extract_by_path(source, key_path)
        if not task_id:
            raise RuntimeError("async task_id extraction failed")

        poll = async_config.get("poll") or {}
        url_template = poll.get("url_template")
        if not url_template:
            raise RuntimeError("async poll.url_template missing")

        base_url = submit_url.split("?")[0].rsplit("/", 1)[0] + "/"
        context = {"task_id": task_id, "base_url": base_url}
        poll_url = render_value(url_template, context)
        poll_headers = deep_merge(base_headers, poll.get("headers") or {})
        poll_headers = render_value(poll_headers, context)

        status_check = poll.get("status_check") or {}
        status_path = self._normalize_location(status_check.get("location") or "")
        success_values = set(status_check.get("success_values") or [])
        fail_values = set(status_check.get("fail_values") or [])
        pending_values = set(status_check.get("pending_values") or [])
        interval = int(poll.get("interval") or 5)
        timeout = int(poll.get("timeout") or 300)

        start = time.time()
        while True:
            async with create_async_http_client(timeout=60.0, http2=True) as client:
                response = await client.request(
                    poll.get("method") or "GET",
                    poll_url,
                    headers=poll_headers,
                )
                if response.status_code >= 400:
                    raise RuntimeError(f"async poll failed status={response.status_code}")
                payload = self._normalize_json_response(_parse_response_body(response))

            status_value = extract_by_path(payload, status_path) if status_path else None
            if status_value in success_values:
                return self._extract_async_result(payload, async_config)
            if status_value in fail_values:
                raise RuntimeError(f"async task failed status={status_value}")
            if pending_values and status_value not in pending_values:
                logger.warning(
                    "async_poll_unexpected_status trace_id=%s status=%s",
                    ctx.trace_id,
                    status_value,
                )

            if time.time() - start > timeout:
                raise RuntimeError("async task timeout")
            await asyncio.sleep(interval)

    async def _call_upstream_stream(
        self,
        ctx: "WorkflowContext",
        url: str,
        body: dict,
        headers: dict,
        timeout: float,
        accumulator: StreamTokenAccumulator | None = None,
    ) -> AsyncIterator[bytes]:
        """
        流式上游调用

        返回异步字节流生成器，同时累计 token 用量

        Args:
            accumulator: Token 累计器，用于跟踪流式响应中的 token 用量
        """
        safe_body = _jsonify_payload(body)
        proxy_attempts = max(1, settings.UPSTREAM_PROXY_MAX_RETRIES + 1)
        tried_endpoints: set[str] = set()

        for attempt in range(proxy_attempts):
            # 模型白名单检查（如有）
            principal_models = ctx.get("external_auth", "allowed_models")
            request_model = ctx.get("request", "model")
            if not _model_allowed(principal_models, request_model):
                ctx.mark_error(
                    ErrorSource.GATEWAY,
                    "MODEL_NOT_ALLOWED",
                    "model not allowed by api key",
                )
                return
            selection = await self.proxy_pool.pick(exclude_endpoints=tried_endpoints)
            proxies = selection.as_httpx_proxies() if selection else None
            transport_kwargs = self.proxy_pool.build_transport_kwargs(selection)
            client = create_async_http_client(
                timeout=timeout,
                http2=True,
                transport_kwargs=transport_kwargs,
                proxies=proxies,
            )
            try:
                async for chunk in self._stream_with_redirects(
                    client=client,
                    url=url,
                    body=safe_body,
                    headers=headers,
                    timeout=timeout,
                ):
                    if accumulator:
                        accumulator.parse_sse_chunk(chunk)
                    yield chunk
                return
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if selection:
                    tried_endpoints.add(selection.endpoint_id)
                    await self.proxy_pool.report_failure(selection.endpoint_id)
                    logger.debug(
                        "Upstream stream retry with new proxy (attempt=%s/%s, proxy=%s, err=%s)",
                        attempt + 1,
                        proxy_attempts,
                        mask_proxy_url(selection.url),
                        exc,
                    )
                if attempt >= proxy_attempts - 1:
                    if accumulator:
                        accumulator.error = str(exc)
                    raise
            except httpx.HTTPStatusError as exc:
                upstream_body = _parse_response_body(exc.response)
                safe_headers = _filter_headers_for_log(exc.response.headers)
                logger.warning(
                    "Upstream stream http error trace_id=%s status=%s url=%s provider=%s body=%s headers=%s",
                    ctx.trace_id,
                    exc.response.status_code,
                    url,
                    ctx.get("routing", "provider") or "unknown",
                    _safe_log_payload(upstream_body),
                    safe_headers,
                )
                if accumulator:
                    accumulator.error = str(exc)
                if selection:
                    await self.proxy_pool.report_failure(selection.endpoint_id)
                raise
            except Exception as e:
                if accumulator:
                    accumulator.error = str(e)
                if selection:
                    await self.proxy_pool.report_failure(selection.endpoint_id)
                raise
            finally:
                await client.aclose()

    async def on_failure(
        self,
        ctx: "WorkflowContext",
        error: Exception,
        attempt: int,
    ) -> FailureAction:
        """
        失败处理：支持重试和降级

        - 超时/网络错误：重试
        - 5xx 错误：重试
        - 4xx 错误：中止
        - 重试耗尽：尝试降级（切换备用上游）
        """
        ctx.upstream_result.retry_count = attempt

        if isinstance(error, UpstreamTimeoutError):
            if attempt <= self.config.max_retries:
                logger.info(f"Retrying upstream call after timeout, attempt={attempt}")
                return FailureAction.RETRY
            return FailureAction.DEGRADE

        if isinstance(error, UpstreamError):
            if error.status_code and 500 <= error.status_code < 600:
                if attempt <= self.config.max_retries:
                    return FailureAction.RETRY
                return FailureAction.DEGRADE
            # 4xx 不重试
            return FailureAction.ABORT

        if isinstance(error, UpstreamAuthError):
            return FailureAction.DEGRADE

        if isinstance(error, (httpx.TimeoutException, httpx.NetworkError)):
            if attempt <= self.config.max_retries:
                return FailureAction.RETRY
            return FailureAction.DEGRADE

        return FailureAction.ABORT

    async def on_degrade(
        self,
        ctx: "WorkflowContext",
        error: Exception,
    ) -> StepResult:
        """
        降级处理：尝试切换备用上游

        实际实现应该：
        1. 从路由表获取备用上游
        2. 将当前上游标记为故障
        3. 使用备用上游重试
        """
        logger.warning(
            f"Upstream degraded trace_id={ctx.trace_id} "
            f"original_error={error}"
        )

        candidates = ctx.get("routing", "candidates") or []
        current_idx = ctx.get("routing", "candidate_index", 0)
        next_idx = current_idx + 1

        if next_idx < len(candidates):
            backup = candidates[next_idx]
            ctx.set("routing", "candidate_index", next_idx)
            ctx.set("routing", "preset_id", backup["preset_id"])
            ctx.set("routing", "preset_item_id", backup["preset_item_id"])
            ctx.set("routing", "upstream_url", backup["upstream_url"])
            ctx.set("routing", "provider", backup["provider"])
            ctx.set("routing", "template_engine", backup["template_engine"])
            ctx.set("routing", "request_template", backup["request_template"])
            ctx.set("routing", "response_transform", backup["response_transform"])
            ctx.set("routing", "routing_config", backup["routing_config"])
            ctx.set("routing", "instance_id", backup.get("instance_id"))
            ctx.set("routing", "provider_model_id", backup.get("provider_model_id"))

            ctx.selected_preset_id = backup["preset_id"]
            ctx.selected_preset_item_id = backup["preset_item_id"]
            ctx.selected_instance_id = backup.get("instance_id")
            ctx.selected_provider_model_id = backup.get("provider_model_id")
            ctx.selected_upstream = backup["upstream_url"]

            # 直接使用新的上游重试
            return await self.execute(ctx)

        return StepResult(
            status=StepStatus.DEGRADED,
            message=f"All upstreams failed: {error}",
        )

    async def _record_bandit_feedback(
        self,
        ctx: "WorkflowContext",
        success: bool,
        latency_ms: float | None,
        reward: float | None = None,
    ) -> None:
        """
        将上游调用结果回写 bandit 状态
        """
        if not ctx.db_session:
            return
        preset_item_id = ctx.selected_preset_item_id or ctx.get("routing", "preset_item_id")
        if not preset_item_id:
            return

        repo = BanditRepository(ctx.db_session)
        routing_config = ctx.get("routing", "routing_config") or {}
        cost = ctx.billing.total_cost if hasattr(ctx, "billing") else None
        try:
            await repo.record_feedback(
                preset_item_id=str(preset_item_id),
                success=success,
                latency_ms=latency_ms,
                cost=cost,
                reward=reward if reward is not None else (1.0 if success else 0.0),
                routing_config=routing_config,
            )
        except Exception as exc:
            logger.warning(f"Bandit feedback write failed: {exc}")

    async def _record_affinity_success(self, ctx: "WorkflowContext") -> None:
        """
        记录路由亲和成功（P1-5）
        
        在上游调用成功后调用，更新亲和状态机。
        """
        affinity_machine = ctx.get("routing", "affinity_machine")
        if not affinity_machine:
            return
        
        provider = ctx.get("routing", "affinity_provider")
        item_id = ctx.get("routing", "affinity_item_id")
        
        if not provider or not item_id:
            return
        
        try:
            await affinity_machine.record_request(
                provider=provider,
                item_id=item_id,
                success=True,
            )
            logger.debug(
                "routing_affinity_success_recorded session=%s model=%s provider=%s",
                affinity_machine.session_id,
                affinity_machine.model,
                provider,
            )
        except Exception as exc:
            logger.warning("routing_affinity_record_failed err=%s", exc)

    async def _record_affinity_failure(self, ctx: "WorkflowContext") -> None:
        """
        记录路由亲和失败（P1-5）
        
        在上游调用失败后调用，更新亲和状态机。
        """
        affinity_machine = ctx.get("routing", "affinity_machine")
        if not affinity_machine:
            return
        
        provider = ctx.get("routing", "affinity_provider")
        item_id = ctx.get("routing", "affinity_item_id")
        
        if not provider or not item_id:
            return
        
        try:
            await affinity_machine.record_request(
                provider=provider,
                item_id=item_id,
                success=False,
            )
            logger.debug(
                "routing_affinity_failure_recorded session=%s model=%s provider=%s",
                affinity_machine.session_id,
                affinity_machine.model,
                provider,
            )
        except Exception as exc:
            logger.warning("routing_affinity_record_failed err=%s", exc)

    def _is_whitelisted(self, url: str | None) -> bool:
        """检查上游域名是否在白名单中"""
        if not url:
            return False
        try:
            host = urlparse(url).hostname or ""
        except Exception:
            return False
        return is_hostname_whitelisted(host, settings.OUTBOUND_WHITELIST)

    def _build_cb_key(self, url: str, secret_ref: str | None) -> str:
        host = urlparse(url).hostname or url
        cred_part = secret_ref or "default"
        return f"{host}:{cred_part}"

    async def _is_circuit_open(self, cb_key: str) -> bool:
        state = await self._get_cb_state(cb_key)
        if state["state"] != "open":
            return False
        if time.time() - state["opened_at"] > settings.CIRCUIT_BREAKER_RESET_SECONDS:
            state["state"] = "half_open"
            state["success_count"] = 0
            await self._set_cb_state(cb_key, state)
            return False
        return True

    async def _mark_failure(self, cb_key: str) -> None:
        state = await self._get_cb_state(cb_key)
        state["failures"] += 1
        if state["state"] == "half_open":
            state["state"] = "open"
            state["opened_at"] = time.time()
        elif state["failures"] >= settings.CIRCUIT_BREAKER_FAILURE_THRESHOLD:
            state["state"] = "open"
            state["opened_at"] = time.time()
        await self._set_cb_state(cb_key, state)

    async def _mark_success(self, cb_key: str) -> None:
        state = await self._get_cb_state(cb_key)
        if state["state"] == "half_open":
            state["success_count"] += 1
            if state["success_count"] >= settings.CIRCUIT_BREAKER_HALF_OPEN_SUCCESS:
                state = {"failures": 0, "state": "closed", "opened_at": 0, "success_count": 0}
        else:
            state["failures"] = 0
        await self._set_cb_state(cb_key, state)

    async def _get_cb_state(self, cb_key: str) -> dict[str, Any]:
        """从 Redis 读取熔断状态，失败时使用进程内兜底"""
        redis_client = getattr(cache, "_redis", None)
        default = {"failures": 0, "state": "closed", "opened_at": 0, "success_count": 0}

        if not redis_client:
            return self._cb_state.setdefault(cb_key, default.copy())

        key = f"{settings.CACHE_PREFIX}{CacheKeys.circuit_breaker(cb_key)}"
        try:
            data = await redis_client.hgetall(key)
            if not data:
                return default.copy()
            state = {
                "failures": int(data.get(b"failures", b"0")),
                "state": data.get(b"state", b"closed").decode(),
                "opened_at": float(data.get(b"opened_at", b"0")),
                "success_count": int(data.get(b"success_count", b"0")),
            }
            return state
        except Exception as exc:
            logger.warning(f"read circuit state failed key={cb_key}: {exc}")
            return self._cb_state.setdefault(cb_key, default.copy())

    async def _set_cb_state(self, cb_key: str, state: dict[str, Any]) -> None:
        """写入熔断状态到 Redis，失败时写入进程内兜底"""
        redis_client = getattr(cache, "_redis", None)
        ttl = settings.CIRCUIT_BREAKER_RESET_SECONDS * 2

        if not redis_client:
            self._cb_state[cb_key] = state
            return

        key = f"{settings.CACHE_PREFIX}{CacheKeys.circuit_breaker(cb_key)}"
        try:
            await redis_client.hset(
                key,
                mapping={
                    "failures": state.get("failures", 0),
                    "state": state.get("state", "closed"),
                    "opened_at": state.get("opened_at", 0),
                    "success_count": state.get("success_count", 0),
                },
            )
            await redis_client.expire(key, ttl)
        except Exception as exc:
            logger.warning(f"write circuit state failed key={cb_key}: {exc}")
            self._cb_state[cb_key] = state
