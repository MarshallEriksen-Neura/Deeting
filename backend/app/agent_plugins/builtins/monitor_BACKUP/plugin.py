from __future__ import annotations

import uuid
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.services.monitor_service import MonitorService


class MonitorPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/monitor",
            version="1.2.0",
            description="Active monitoring system with self-evolving strategies.",
            author="System",
        )

    def get_tools(self) -> list[Any]:
        # 这里的定义应与 llm-tool.yaml 保持同步，但包含更丰富的描述
        return [
            {
                "type": "function",
                "function": {
                    "name": "sys_create_monitor",
                    "description": "Create a new persistent monitoring task. This will also spawn a specialized Insight Assistant.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Task title."},
                            "objective": {"type": "string", "description": "Core intelligence goal and alert triggers."},
                            "cron_expr": {"type": "string", "default": "0 */6 * * *"},
                            "initial_strategies": {
                                "type": "array", 
                                "items": {"type": "string"},
                                "description": "Optional list of initial prompt strategies to test (MAB arms)."
                            },
                            "notify_config": {"type": "object"},
                            "allowed_tools": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["title", "objective"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "sys_list_monitors",
                    "description": "List all active monitors and their evolution stats.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "skip": {"type": "integer", "default": 0},
                            "limit": {"type": "integer", "default": 20}
                        },
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "sys_update_monitor",
                    "description": "Update monitor task: pause/resume/update/delete.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "action": {"type": "string", "enum": ["pause", "resume", "update", "delete"]},
                            "cron_expr": {"type": "string"},
                            "title": {"type": "string"},
                            "objective": {"type": "string"},
                            "notify_config": {"type": "object"},
                            "allowed_tools": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["task_id", "action"],
                    }
                }
            }
        ]

    async def handle_sys_create_monitor(
        self,
        title: str,
        objective: str,
        cron_expr: str = "0 */6 * * *",
        initial_strategies: list[str] | None = None,
        notify_config: dict[str, Any] | None = None,
        allowed_tools: list[str] | None = None,
        __context__: Any | None = None,
        **kwargs
    ) -> str:
        async with AsyncSessionLocal() as session:
            service = MonitorService(session)
            user_id = self.context.user_id
            if not user_id:
                return "Error: User context missing."
            
            # 默认注入几个基础策略变体作为 MAB 的臂
            strategies = initial_strategies or [
                f"专注于【{title}】的最新事实变动，排除噪音。",
                f"深度分析【{title}】的潜在影响，并给出预测建议。",
                f"仅提取【{title}】中与用户目标‘{objective}’严格相关的核心指标。"
            ]
            
            try:
                current_model = self._resolve_model_from_context(__context__)
                
                await service.create_task(
                    user_id=user_id,
                    title=title,
                    objective=objective,
                    cron_expr=cron_expr,
                    notify_config=notify_config,
                    allowed_tools=allowed_tools,
                    strategy_variants={"prompts": strategies},
                    model_id=current_model
                )

                return f"✅ 监控任务【{title}】已启动。已为您开启策略优胜劣汰模式，将自动寻找最懂您的推送逻辑。"
            except Exception as e:
                return f"❌ 创建失败: {str(e)}"

    @staticmethod
    def _resolve_model_from_context(workflow_context: Any | None) -> str | None:
        """
        优先使用当前对话请求的模型（requested_model / validation.model）。
        """
        if workflow_context is None:
            return None

        requested_model = getattr(workflow_context, "requested_model", None)
        if isinstance(requested_model, str) and requested_model.strip():
            return requested_model.strip()

        try:
            model_from_validation = workflow_context.get("validation", "model")
            if isinstance(model_from_validation, str) and model_from_validation.strip():
                return model_from_validation.strip()
        except Exception:
            pass

        try:
            req = workflow_context.get("validation", "request")
            req_model = getattr(req, "model", None)
            if isinstance(req_model, str) and req_model.strip():
                return req_model.strip()
        except Exception:
            pass

        return None

    async def handle_sys_list_monitors(self, skip: int = 0, limit: int = 20) -> str:
        # 复用之前的列表逻辑
        async with AsyncSessionLocal() as session:
            service = MonitorService(session)
            user_id = self.context.user_id
            result = await service.get_user_tasks(user_id, skip, limit)
            tasks = result.get("items", [])
            if not tasks: return "暂无监控任务"
            
            lines = ["### 🛰️ 我的主动寻猎智能体", ""]
            for t in tasks:
                if isinstance(t, dict):
                    title = str(t.get("title") or "未命名任务")
                    objective = str(t.get("objective") or "")
                    total_tokens = int(t.get("total_tokens") or 0)
                    current_interval_minutes = int(t.get("current_interval_minutes") or 0)
                else:
                    title = str(getattr(t, "title", "未命名任务"))
                    objective = str(getattr(t, "objective", "") or "")
                    total_tokens = int(getattr(t, "total_tokens", 0) or 0)
                    current_interval_minutes = int(getattr(t, "current_interval_minutes", 0) or 0)

                if current_interval_minutes > 0:
                    lines.append(f"- **{title}** (每 {current_interval_minutes}min 巡检)")
                else:
                    lines.append(f"- **{title}**")
                lines.append(f"  - 目标: {objective[:40]}...")
                lines.append(f"  - 累积消耗: {total_tokens} Tokens")
            return "\n".join(lines)

    async def handle_sys_update_monitor(
        self,
        task_id: str,
        action: str,
        cron_expr: str | None = None,
        title: str | None = None,
        objective: str | None = None,
        notify_config: dict[str, Any] | None = None,
        allowed_tools: list[str] | None = None,
        **kwargs,
    ) -> str:
        async with AsyncSessionLocal() as session:
            service = MonitorService(session)
            user_id = self.context.user_id

            try:
                parsed_task_id = uuid.UUID(task_id)
            except Exception:
                return "❌ 参数错误: task_id 不是合法 UUID。"

            normalized_action = (action or "").strip().lower()
            try:
                if normalized_action == "pause":
                    await service.pause_task(parsed_task_id, user_id)
                    return "✅ 监控任务已暂停。"
                if normalized_action == "resume":
                    await service.resume_task(parsed_task_id, user_id)
                    return "✅ 监控任务已恢复。"
                if normalized_action == "delete":
                    await service.delete_task(parsed_task_id, user_id)
                    return "✅ 监控任务已删除。"
                if normalized_action == "update":
                    updates: dict[str, Any] = {}
                    if cron_expr is not None:
                        updates["cron_expr"] = cron_expr
                    if title is not None:
                        updates["title"] = title
                    if objective is not None:
                        updates["objective"] = objective
                    if notify_config is not None:
                        updates["notify_config"] = notify_config
                    if allowed_tools is not None:
                        updates["allowed_tools"] = allowed_tools
                    if not updates:
                        return "❌ update 操作至少需要一个更新字段。"
                    await service.update_task(parsed_task_id, user_id, **updates)
                    return "✅ 监控任务已更新。"
                return "❌ action 仅支持 pause/resume/update/delete。"
            except Exception as e:
                return f"❌ 操作失败: {str(e)}"
