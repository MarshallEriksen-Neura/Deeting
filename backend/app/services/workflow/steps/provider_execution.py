"""
ProviderExecutionStep: 配置驱动的执行步骤

职责：
- 替代 TemplateRenderStep + UpstreamCallStep (针对 ConfigDrivenProvider)
- 准备 ConfigDrivenProvider 所需的配置 (从 RoutingStep 结果获取)
- 准备渲染上下文 (Secret, Input, etc.)
- 调用 ConfigDrivenProvider.execute
- 将结果写入 upstream_call.response
"""

import logging
import time
from typing import TYPE_CHECKING, Any

import httpx

from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.core.metrics import record_upstream_call
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.secrets.manager import SecretManager
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepConfig,
    StepResult,
    StepStatus,
)
from app.core.provider.config_driven_provider import ConfigDrivenProvider

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class ProviderExecutionStep(BaseStep):
    """
    Provider Execution Step (Config Driven)
    """

    name = "provider_execution"
    depends_on = ["routing"]
    retry_on = (httpx.TimeoutException, httpx.NetworkError)

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

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """Execute the provider call using ConfigDrivenProvider"""
        
        # 1. Gather Configuration from Routing Context
        routing_info = ctx.get_all("routing")
        if not routing_info or not routing_info.get("upstream_url"):
            return StepResult(
                status=StepStatus.FAILED,
                message="Routing information missing or incomplete",
            )

        provider_config = {
            "upstream_url": routing_info.get("upstream_url"),
            "request_template": routing_info.get("request_template") or {},
            "headers": routing_info.get("default_headers") or {},
            "async_config": routing_info.get("async_config") or {},
            "http_method": routing_info.get("http_method") or "POST",
        }

        # 2. Prepare Context (Secrets, Input)
        request_data = ctx.get("resolve_assets", "request_data") or ctx.get("validation", "validated") or {}
        
        # Resolve Secret
        auth_config = routing_info.get("auth_config") or {}
        provider = routing_info.get("provider")
        secret_ref = auth_config.get("secret_ref_id") or auth_config.get("secret")
        
        api_key = ""
        if secret_ref:
            secret = await self.secret_manager.get(provider, secret_ref, ctx.db_session)
            if secret:
                api_key = secret
            else:
                logger.warning(f"Secret not found for ref: {secret_ref}")

        extra_context = {
            "credentials": {
                "api_key": api_key,
                # Add other auth params if needed
            },
            # Add other context vars if needed (e.g. user_id, etc)
        }

        # 3. Initialize Provider
        provider_instance = ConfigDrivenProvider(config=provider_config)

        # 4. Execute
        timeout = float(routing_info.get("limit_config", {}).get("timeout") or self.config.timeout)
        start_time = time.perf_counter()
        
        try:
            async with create_async_http_client(timeout=timeout) as client:
                response_data = await provider_instance.execute(
                    request_payload=request_data,
                    client=client,
                    extra_context=extra_context
                )
            
            latency_ms = (time.perf_counter() - start_time) * 1000
            
            # 5. Store Result
            ctx.set("upstream_call", "response", response_data)
            ctx.set("upstream_call", "status_code", 200) # Assumed success if no exception
            ctx.set("upstream_call", "latency_ms", latency_ms)
            
            # Metrics & Status
            record_upstream_call(
                provider=provider or "unknown",
                model=ctx.requested_model or "unknown",
                success=True,
                latency_ms=latency_ms,
            )
            
            ctx.emit_status(
                stage="evolve",
                step=self.name,
                state="success",
                code="provider.executed",
                meta={"latency_ms": round(latency_ms)},
            )
            
            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "status_code": 200,
                    "latency_ms": latency_ms,
                },
            )

        except httpx.TimeoutException:
            latency_ms = (time.perf_counter() - start_time) * 1000
            ctx.mark_error(ErrorSource.UPSTREAM, "UPSTREAM_TIMEOUT", f"Request timed out after {timeout}s")
            record_upstream_call(provider=provider, model=ctx.requested_model, success=False, latency_ms=latency_ms, error_code="timeout")
            raise

        except Exception as e:
            latency_ms = (time.perf_counter() - start_time) * 1000
            ctx.mark_error(ErrorSource.UPSTREAM, "UPSTREAM_ERROR", str(e))
            record_upstream_call(provider=provider, model=ctx.requested_model, success=False, latency_ms=latency_ms, error_code="error")
            raise
