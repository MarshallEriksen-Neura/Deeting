"""
AuditLogStep: 审计日志步骤

职责：
- 记录请求完整链路信息
- 内部通道记录更多调试信息
- 外部通道脱敏处理
"""

import logging
from typing import TYPE_CHECKING

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class AuditLogStep(BaseStep):
    """
    审计日志步骤

    从上下文读取:
        - 所有步骤的执行结果

    写入:
        - 审计日志（异步写入 DB/日志系统）
    """

    name = "audit_log"
    depends_on = []  # 放在最后，但不强制依赖特定步骤

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """记录审计日志"""
        audit_data = ctx.to_audit_dict()

        # 根据通道决定日志级别和详细程度
        if ctx.is_internal:
            logger.info(
                f"Audit[internal] trace_id={ctx.trace_id} "
                f"model={ctx.requested_model} "
                f"success={ctx.is_success} "
                f"duration_ms={sum(ctx.step_timings.values()):.2f}"
            )
        else:
            logger.info(
                f"Audit[external] trace_id={ctx.trace_id} "
                f"tenant={ctx.tenant_id} "
                f"success={ctx.is_success} "
                f"tokens={ctx.billing.total_tokens} "
                f"cost={ctx.billing.total_cost:.6f}"
            )

        # 异步写入审计日志 (Celery)
        try:
            from app.tasks.audit import record_audit_log_task

            # 构建元数据
            meta = {
                "request_summary": self._get_request_summary(ctx),
                "routing_result": self._get_routing_result(ctx),
                "upstream": {
                    "provider": ctx.get("routing", "provider"),
                    "url": ctx.upstream_result.upstream_url or ctx.get("routing", "upstream_url"),
                    "latency_ms": ctx.upstream_result.latency_ms,
                    "retry_count": ctx.upstream_result.retry_count,
                    "status_code": ctx.upstream_result.status_code,
                },
                "billing_details": vars(ctx.billing) if hasattr(ctx, "billing") else {},
                "capability": ctx.capability,
                "client_ip": ctx.client_ip,
            }

            # 全局脱敏 (Meta & URL)
            upstream_url = ctx.upstream_result.upstream_url or ctx.get("routing", "upstream_url")
            try:
                from app.services.workflow.steps.sanitize import SanitizeStep
                meta = SanitizeStep.sanitize_for_log(meta)
                upstream_url = SanitizeStep.sanitize_for_log(upstream_url)
            except Exception as e:
                logger.warning(f"Failed to sanitize audit log data: {e}")

            # 映射字段到 GatewayLog 模型
            log_payload = {
                "model": ctx.requested_model or "unknown",
                "status_code": ctx.upstream_result.status_code or 0,
                "duration_ms": int(sum(ctx.step_timings.values())),
                "input_tokens": ctx.billing.input_tokens,
                "output_tokens": ctx.billing.output_tokens,
                "total_tokens": ctx.billing.total_tokens,
                "cost_user": ctx.billing.total_cost,
                "preset_id": str(ctx.selected_preset_id) if ctx.selected_preset_id else None,
                "error_code": ctx.error_code,
                "upstream_url": upstream_url,
                "retry_count": ctx.upstream_result.retry_count,
                "meta": meta,
            }
            if ctx.user_id:
                log_payload["user_id"] = str(ctx.user_id)

            record_audit_log_task.delay(log_payload)

        except Exception as exc:
            logger.warning(f"Audit task dispatch failed: {exc}")

        return StepResult(
            status=StepStatus.SUCCESS,
            data={"trace_id": ctx.trace_id},
        )

    def _get_request_summary(self, ctx: "WorkflowContext") -> dict:
        """获取请求摘要（已脱敏）"""
        request = ctx.get("validation", "request")
        if not request:
            return {}

        # 尝试转换为 dict
        data = {}
        if hasattr(request, "model_dump"):
            data = request.model_dump()
        elif hasattr(request, "dict"):
            data = request.dict()
        else:
            return {"raw": str(request)}

        # 仅保留关键字段并脱敏
        summary = {
            "model": data.get("model"),
            "stream": data.get("stream"),
            "messages_count": len(data.get("messages", [])),
            # 仅记录第一条和最后一条消息的角色，不记录内容
            "messages_structure": [
                {"role": m.get("role")} for m in data.get("messages", [])
            ] if "messages" in data else None,
            "max_tokens": data.get("max_tokens"),
            "temperature": data.get("temperature"),
        }
        try:
            from app.services.workflow.steps.sanitize import SanitizeStep
            summary = SanitizeStep.sanitize_for_log(summary)
        except Exception:
            pass
        return summary

    def _get_routing_result(self, ctx: "WorkflowContext") -> dict:
        """获取选路结果快照"""
        return {
            "provider": ctx.get("routing", "provider"),
            "preset_id": str(ctx.selected_preset_id) if ctx.selected_preset_id else None,
            "preset_item_id": str(ctx.selected_preset_item_id) if ctx.selected_preset_item_id else None,
            "template_engine": ctx.get("routing", "template_engine"),
            "upstream_url": ctx.get("routing", "upstream_url"),
        }

    def should_skip(self, ctx: "WorkflowContext") -> bool:
        """
        根据 API Key 配置决定是否跳过日志记录
        """
        # 1. 外部通道：检查 API Key 的 enable_logging 配置
        if ctx.is_external:
            enable_logging = ctx.get("external_auth", "enable_logging")
            # 仅当显式设置为 False 时才跳过；None 或 True 均记录
            if enable_logging is False:
                return True

        # 2. 内部通道：默认记录，除非显式关闭（预留）
        return False
