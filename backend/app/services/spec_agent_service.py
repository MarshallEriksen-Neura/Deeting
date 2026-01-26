import inspect
import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_plugins.core.manager import PluginManager
from app.core.plugin_config import plugin_config_loader
from app.models.user_mcp_server import UserMcpServer
from app.repositories.spec_agent_repository import SpecAgentRepository
from app.schemas.spec_agent import SpecManifest, SpecNode
from app.schemas.tool import ToolCall, ToolDefinition
from app.services.mcp.client import mcp_client
from app.services.mcp.discovery import mcp_discovery_service
from app.services.providers.llm import llm_service

logger = logging.getLogger(__name__)


class SpecExecutor:
    """
    Executes a SpecManifest DAG with state persistence and generic Sub-Agents.
    """

    def __init__(
        self,
        plan_id: uuid.UUID,
        manifest: SpecManifest,
        repo: SpecAgentRepository,
        plugin_manager: PluginManager,
        user_id: uuid.UUID,
        mcp_tools_map: Dict[str, Dict[str, Any]],
        available_tool_defs: List[ToolDefinition],
        local_tool_handlers: Dict[str, Any],
    ):
        self.plan_id = plan_id
        self.manifest = manifest
        self.repo = repo
        self.plugin_manager = plugin_manager
        self.user_id = user_id
        self.mcp_tools_map = mcp_tools_map
        self.available_tool_defs = available_tool_defs
        self.local_tool_handlers = local_tool_handlers

        self.context: Dict[str, Any] = self.manifest.context.copy()
        self.node_outputs: Dict[str, Any] = {}
        self.max_turns = 6
        self._skipped_cache: set[str] = set()

        self.node_map = {n.id: n for n in self.manifest.nodes}
        self.dag_children = {n.id: [] for n in self.manifest.nodes}
        for n in self.manifest.nodes:
            for dep in n.needs:
                if dep in self.dag_children:
                    self.dag_children[dep].append(n.id)

    async def initialize(self) -> None:
        """Rebuild state from DB logs for resume."""
        logs = await self.repo.get_latest_node_logs(self.plan_id)
        for log in logs:
            if log.status == "SUCCESS" and log.output_data is not None:
                self.node_outputs[log.node_id] = log.output_data
                node = self.node_map.get(log.node_id)
                if node and getattr(node, "output_as", None):
                    self.context[node.output_as] = log.output_data
            if log.status == "SKIPPED":
                self._skipped_cache.add(log.node_id)

    async def run_step(self) -> Dict[str, Any]:
        """Execute a single scheduling step."""
        latest_logs = await self.repo.get_latest_node_logs(self.plan_id)
        completed_ids = {l.node_id for l in latest_logs if l.status == "SUCCESS"}
        skipped_ids = {l.node_id for l in latest_logs if l.status == "SKIPPED"}
        failed_ids = {l.node_id for l in latest_logs if l.status == "FAILED"}
        waiting_ids = [l.node_id for l in latest_logs if l.status == "WAITING_APPROVAL"]

        if failed_ids:
            await self.repo.update_plan_status(self.plan_id, "FAILED")
            await self._commit()
            return {"status": "failed", "nodes": list(failed_ids)}

        executable_nodes: List[SpecNode] = []
        for node in self.manifest.nodes:
            if node.id in completed_ids or node.id in skipped_ids:
                continue

            deps_satisfied = True
            for dep in node.needs:
                if dep in skipped_ids:
                    await self.skip_subtree_db(node.id, reason=f"dependency {dep} skipped")
                    deps_satisfied = False
                    break
                if dep not in completed_ids:
                    deps_satisfied = False
                    break

            if deps_satisfied:
                executable_nodes.append(node)

        if not executable_nodes:
            total_nodes = len(self.manifest.nodes)
            done_nodes = len(completed_ids) + len(skipped_ids)
            if done_nodes >= total_nodes:
                await self.repo.update_plan_status(self.plan_id, "COMPLETED")
                await self._commit()
                return {"status": "completed"}
            if waiting_ids:
                await self.repo.update_plan_status(self.plan_id, "PAUSED")
                await self._commit()
                return {"status": "waiting_approval", "nodes": waiting_ids}
            return {"status": "stalled"}

        executed = 0
        for node in executable_nodes:
            result = await self.execute_node(node)
            executed += 1
            if result.get("status") == "check_in_required":
                await self.repo.update_plan_status(self.plan_id, "PAUSED")
                await self._commit()
                return {"status": "waiting_approval", "nodes": [node.id]}
            if result.get("status") == "failed":
                await self.repo.update_plan_status(self.plan_id, "FAILED")
                await self._commit()
                return {"status": "failed", "nodes": [node.id]}

        await self.repo.update_plan_context(self.plan_id, self.context)
        await self._commit()
        return {"status": "running", "executed": executed}

    async def execute_node(self, node: SpecNode) -> Dict[str, Any]:
        logger.info("Executing Node: %s", node.id)

        input_snapshot = node.dict()
        if getattr(node, "args", None):
            input_snapshot["resolved_args"] = self._resolve_value(node.args)

        log_entry = await self.repo.init_node_execution(
            self.plan_id,
            node.id,
            input_snapshot=input_snapshot,
            worker_info="generic_task_runner",
        )
        await self._commit()

        if getattr(node, "check_in", False):
            await self.repo.finish_node_execution(log_entry.id, "WAITING_APPROVAL")
            await self._commit()
            return {"status": "check_in_required"}

        if node.type == "action":
            try:
                (
                    result,
                    tool_trace,
                    final_response,
                    used_tools,
                    turns,
                    message_count,
                    session_id,
                    system_prompt,
                ) = await self._run_generic_sub_agent(node, log_entry.id)
                if getattr(node, "output_as", None):
                    self.context[node.output_as] = result
                self.node_outputs[node.id] = result
                worker_snapshot = {
                    "model": "gpt-4o",
                    "max_turns": self.max_turns,
                    "required_tools": getattr(node, "required_tools", None) or [],
                    "tools_available": [t.name for t in self._filter_tools_for_node(node)],
                    "tools_used": sorted(list(used_tools)),
                    "session_id": str(session_id),
                    "message_count": message_count,
                    "turns": turns,
                    "context_keys": list(self.context.keys()),
                    "instruction": self._truncate_text(
                        getattr(node, "instruction", ""), 1000
                    ),
                    "system_prompt": self._truncate_text(system_prompt, 2000),
                    "node_id": getattr(node, "id", ""),
                }
                await self.repo.finish_node_execution(
                    log_entry.id,
                    "SUCCESS",
                    output_data=result if isinstance(result, dict) else {"result": result},
                    raw_response={
                        "tool_trace": tool_trace,
                        "final_response": self._truncate_text(final_response, 4000),
                    },
                    worker_snapshot=worker_snapshot,
                )
                await self._commit()
                return {"status": "success"}
            except Exception as exc:
                logger.exception("Node %s failed", node.id)
                await self.repo.finish_node_execution(
                    log_entry.id,
                    "FAILED",
                    error_message=str(exc),
                    worker_snapshot={"error": str(exc)},
                )
                await self._commit()
                return {"status": "failed"}

        if node.type == "logic_gate":
            try:
                input_val = self.resolve_variable(node.input)
                next_step = self._evaluate_logic_gate(node, input_val)

                children = self.dag_children.get(node.id, [])
                for child_id in children:
                    if child_id != next_step:
                        await self.skip_subtree_db(child_id, reason=f"logic_gate:{node.id}")

                await self.repo.finish_node_execution(log_entry.id, "SUCCESS")
                await self._commit()
                return {"status": "success"}
            except Exception as exc:
                logger.exception("LogicGate %s failed", node.id)
                await self.repo.finish_node_execution(
                    log_entry.id, "FAILED", error_message=str(exc)
                )
                await self._commit()
                return {"status": "failed"}

        if node.type == "replan_trigger":
            await self.repo.finish_node_execution(
                log_entry.id,
                "FAILED",
                error_message="replan_trigger is not implemented",
            )
            await self.repo.update_plan_status(self.plan_id, "FAILED")
            await self._commit()
            return {"status": "failed"}

        return {"status": "unknown"}

    async def skip_subtree_db(self, node_id: str, reason: Optional[str] = None) -> None:
        if node_id in self._skipped_cache:
            return
        self._skipped_cache.add(node_id)
        await self.repo.mark_node_skipped(self.plan_id, node_id, reason=reason)
        await self._commit()
        for child in self.dag_children.get(node_id, []):
            await self.skip_subtree_db(child, reason=reason)

    async def _run_generic_sub_agent(
        self, node: SpecNode, log_id: uuid.UUID
    ) -> tuple[Any, list[dict], str, set[str], int, int, uuid.UUID, str]:
        instruction = getattr(node, "instruction", "")
        tools_for_llm = self._filter_tools_for_node(node)
        tool_trace: list[dict] = []
        used_tools: set[str] = set()

        system_prompt = (
            "You are a capable execution agent.\n"
            "Your goal is to complete the following task:\n"
            f"\"{instruction}\"\n\n"
            "You have access to the following tools. Use them if necessary.\n"
            "Current Context variables are available if you need them.\n"
            "Return the final result as a JSON object."
        )
        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"Context Data: {json.dumps(self.context, default=str)[:2000]}",
            },
        ]

        session = await self.repo.create_session(log_id)
        await self._record_session_message(session.id, messages[0])
        await self._record_session_message(session.id, messages[1])
        await self._record_session_step(
            session.id,
            {"step": "start", "node_id": getattr(node, "id", ""), "tool_count": len(tools_for_llm)},
        )

        turns = 0
        for _ in range(self.max_turns):
            turns += 1
            response = await llm_service.chat_completion(
                messages=messages,
                tools=tools_for_llm,
                model="gpt-4o",
                temperature=0,
            )

            if isinstance(response, list):
                messages.append(
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": json.dumps(tc.arguments),
                                },
                            }
                            for tc in response
                        ],
                    }
                )
                await self._record_session_message(
                    session.id,
                    self._coerce_message(messages[-1]),
                )
                await self._record_session_step(
                    session.id,
                    {
                        "step": "tool_calls",
                        "turn": turns,
                        "tools": [tc.name for tc in response],
                    },
                )
                for tc in response:
                    tool_result = await self._dispatch_tool(tc)
                    used_tools.add(tc.name)
                    tool_trace.append(
                        {
                            "name": tc.name,
                            "arguments": tc.arguments,
                            "result": tool_result,
                        }
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "name": tc.name,
                            "content": json.dumps(tool_result, ensure_ascii=False),
                        }
                    )
                    await self._record_session_message(
                        session.id,
                        self._coerce_message(messages[-1]),
                    )
                    await self._record_session_step(
                        session.id,
                        {
                            "step": "tool_result",
                            "turn": turns,
                            "tool": tc.name,
                            "result_preview": self._truncate_text(
                                json.dumps(tool_result, ensure_ascii=False), 1200
                            ),
                        },
                    )
                continue

            await self._record_session_message(
                session.id,
                self._coerce_message({"role": "assistant", "content": response}),
            )
            await self._record_session_step(
                session.id,
                {
                    "step": "final",
                    "turn": turns,
                    "preview": self._truncate_text(str(response), 1200),
                },
            )
            return (
                self._normalize_result(response),
                tool_trace,
                response,
                used_tools,
                turns,
                len(messages),
                session.id,
                system_prompt,
            )

        raise RuntimeError("Spec sub-agent exceeded max tool turns")

    async def _dispatch_tool(self, tool_call: ToolCall) -> Any:
        if tool_call.name in self.mcp_tools_map:
            mcp_info = self.mcp_tools_map[tool_call.name]
            return await mcp_client.call_tool(
                sse_url=mcp_info["sse_url"],
                tool_name=tool_call.name,
                arguments=tool_call.arguments,
                headers=mcp_info["headers"],
            )

        handler = self.local_tool_handlers.get(tool_call.name)
        if handler:
            try:
                if isinstance(tool_call.arguments, dict):
                    kwargs = dict(tool_call.arguments)
                    sig = inspect.signature(handler)
                    if "__context__" in sig.parameters:
                        kwargs["__context__"] = {
                            "plan_id": str(self.plan_id),
                            "user_id": str(self.user_id),
                            "context": self.context,
                        }
                    return await self._maybe_await(handler, **kwargs)
                return await self._maybe_await(handler, tool_call.arguments)
            except Exception as exc:
                logger.exception("Local tool call failed: %s", tool_call.name)
                return {"error": str(exc)}

        return {"error": f"Tool '{tool_call.name}' not found"}

    async def _maybe_await(self, func, *args, **kwargs) -> Any:
        result = func(*args, **kwargs)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def _record_session_message(self, session_id: uuid.UUID, message: Dict[str, Any]) -> None:
        await self.repo.append_session_message(session_id, message)

    async def _record_session_step(self, session_id: uuid.UUID, step: Dict[str, Any]) -> None:
        await self.repo.append_session_thought(session_id, step)

    def _truncate_text(self, text: str, limit: int) -> str:
        if text is None:
            return ""
        if len(text) <= limit:
            return text
        return f"{text[:limit]}...(truncated)"

    def _coerce_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        for key, value in message.items():
            if key == "content" and isinstance(value, str):
                payload[key] = self._truncate_text(value, 2000)
            else:
                payload[key] = value
        return payload

    def _normalize_result(self, response: str) -> Any:
        try:
            parsed = json.loads(response)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return {"result": response}

    def _filter_tools_for_node(self, node: SpecNode) -> List[ToolDefinition]:
        required = getattr(node, "required_tools", None) or []
        if not required:
            return self.available_tool_defs
        required_set = set(required)
        filtered = [t for t in self.available_tool_defs if t.name in required_set]
        if not filtered:
            logger.warning("No required tools matched for node %s", getattr(node, "id", ""))
            return self.available_tool_defs
        return filtered

    def resolve_variable(self, var_str: Any) -> Any:
        if not (
            isinstance(var_str, str)
            and var_str.startswith("{{")
            and var_str.endswith("}}")
        ):
            return var_str

        expr = var_str[2:-2].strip()
        if not expr:
            return None

        if expr.endswith(".output") and expr.count(".") == 1:
            node_id = expr.split(".", 1)[0]
            return self.node_outputs.get(node_id)

        parts = expr.split(".")
        current = self.context.get(parts[0])
        if current is None:
            current = self.node_outputs.get(parts[0])
        for part in parts[1:]:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current

    def _resolve_value(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {k: self._resolve_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._resolve_value(v) for v in value]
        return self.resolve_variable(value)

    def _evaluate_logic_gate(self, node: SpecNode, input_val: Any) -> str:
        next_step = node.default
        ops = {
            ">=": lambda x, y: x >= y,
            "<=": lambda x, y: x <= y,
            ">": lambda x, y: x > y,
            "<": lambda x, y: x < y,
            "==": lambda x, y: x == y,
            "!=": lambda x, y: x != y,
        }

        for rule in node.rules:
            condition = rule.condition.replace("$.", "").strip()
            op = next((o for o in ops if o in condition), None)
            if not op:
                continue
            left, right = [p.strip() for p in condition.split(op, 1)]
            actual = self._extract_value(input_val, left)
            expected = self._parse_literal(right)
            try:
                if ops[op](actual, expected):
                    return rule.next_node
            except Exception:
                continue

        return next_step

    def _extract_value(self, data: Any, path: str) -> Any:
        if not path:
            return data
        current = data
        for part in path.split("."):
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current

    def _parse_literal(self, value: str) -> Any:
        lowered = value.lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
        if lowered == "null":
            return None
        if re.match(r"^-?\d+(\.\d+)?$", value):
            return float(value) if "." in value else int(value)
        if (
            (value.startswith("'") and value.endswith("'"))
            or (value.startswith('"') and value.endswith('"'))
        ):
            return value[1:-1]
        return value

    async def _commit(self) -> None:
        try:
            await self.repo.session.commit()
        except Exception:
            await self.repo.session.rollback()
            raise


class SpecAgentService:
    def __init__(self):
        self.plugin_manager = PluginManager()
        self._initialized = False

    async def initialize_plugins(self, user_id: uuid.UUID | None = None) -> None:
        if self._initialized:
            return

        all_plugins = plugin_config_loader.get_all_plugins()
        for p_config in all_plugins:
            plugin_class = plugin_config_loader.get_plugin_class(p_config)
            if plugin_class:
                try:
                    self.plugin_manager.register_class(plugin_class)
                except Exception as exc:
                    logger.error("Failed to register plugin %s: %s", p_config.id, exc)

        await self.plugin_manager.activate_all(user_id=user_id)
        self._initialized = True

    async def execute_plan(
        self, session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
    ) -> SpecExecutor:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan:
            raise ValueError(f"Spec plan {plan_id} not found")

        if plan.status in ("DRAFT", "PAUSED"):
            await repo.update_plan_status(plan_id, "RUNNING")
            await session.commit()

        manifest = SpecManifest(**plan.manifest_data)

        await self.initialize_plugins(user_id=user_id)
        local_tools, local_handlers = self._load_local_tools()
        mcp_tools, mcp_map = await self._load_mcp_tools(session, user_id)

        available_tools = local_tools + mcp_tools

        executor = SpecExecutor(
            plan_id=plan_id,
            manifest=manifest,
            repo=repo,
            plugin_manager=self.plugin_manager,
            user_id=user_id,
            mcp_tools_map=mcp_map,
            available_tool_defs=available_tools,
            local_tool_handlers=local_handlers,
        )

        if plan.current_context:
            executor.context.update(plan.current_context)

        await executor.initialize()
        return executor

    def _load_local_tools(self) -> tuple[List[ToolDefinition], Dict[str, Any]]:
        tools: List[ToolDefinition] = []
        handlers: Dict[str, Any] = {}

        raw_tools = self.plugin_manager.get_all_tools()
        for tool_def in raw_tools:
            func_def = tool_def["function"]
            t_name = func_def["name"]

            tools.append(
                ToolDefinition(
                    name=t_name,
                    description=func_def["description"],
                    input_schema=func_def["parameters"],
                )
            )

            handler = self._find_handler(t_name)
            if handler:
                handlers[t_name] = handler
            else:
                logger.warning("Tool '%s' advertised but no handler found.", t_name)

        return tools, handlers

    def _find_handler(self, tool_name: str):
        method_name = f"handle_{tool_name}"
        plugins = getattr(self.plugin_manager, "_plugins", {})
        for plugin in plugins.values():
            if hasattr(plugin, tool_name):
                return getattr(plugin, tool_name)
            if hasattr(plugin, method_name):
                return getattr(plugin, method_name)
        return None

    async def _load_mcp_tools(
        self, session: AsyncSession, user_id: uuid.UUID
    ) -> tuple[List[ToolDefinition], Dict[str, Dict[str, Any]]]:
        tools = await mcp_discovery_service.get_active_tools(session, user_id)

        stmt = select(UserMcpServer).where(
            UserMcpServer.user_id == user_id,
            UserMcpServer.is_enabled == True,
            UserMcpServer.server_type == "sse",
        )
        result = await session.execute(stmt)
        servers = result.scalars().all()

        tool_map: Dict[str, Dict[str, Any]] = {}
        for server in servers:
            if not server.sse_url:
                continue
            headers = await mcp_discovery_service._get_auth_headers(session, server)
            disabled = set(server.disabled_tools or [])
            for tool in server.tools_cache or []:
                name = tool.get("name")
                if not name or name in disabled:
                    continue
                if name in tool_map:
                    continue
                tool_map[name] = {"sse_url": server.sse_url, "headers": headers}

        return tools, tool_map


spec_agent_service = SpecAgentService()
