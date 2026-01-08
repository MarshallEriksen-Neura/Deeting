"""
AuditRepository: 审计日志写入占位实现

暂未创建专门审计表，先写入 GatewayLog 兼容字段或缓存。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.gateway_log_repository import GatewayLogRepository


class AuditRepository:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._gateway_log_repo = GatewayLogRepository(session)

    async def create(self, audit_data: dict[str, Any]) -> None:
        """
        尝试写入 gateway_log，字段缺失时忽略。
        """
        try:
            await self._gateway_log_repo.create(
                {
                    "model": audit_data.get("requested_model") or "unknown",
                    "status_code": audit_data.get("upstream", {}).get("status_code")
                    or 0,
                    "duration_ms": int(audit_data.get("total_duration_ms") or 0),
                    "input_tokens": audit_data.get("billing", {}).get(
                        "input_tokens", 0
                    ),
                    "output_tokens": audit_data.get("billing", {}).get(
                        "output_tokens", 0
                    ),
                    "total_tokens": audit_data.get("billing", {}).get(
                        "input_tokens", 0
                    )
                    + audit_data.get("billing", {}).get("output_tokens", 0),
                    "cost_user": audit_data.get("billing", {}).get("total_cost", 0.0),
                    "preset_id": audit_data.get("selected_preset_id"),
                    "error_code": audit_data.get("error_code"),
                    "upstream_url": audit_data.get("upstream_result", {}).get("upstream_url"),
                    "retry_count": audit_data.get("upstream_result", {}).get("retry_count", 0),
                    "meta": audit_data.get("meta"),
                }
            )
        except Exception:
            # 若字段不匹配则跳过，避免阻塞主流程
            pass
