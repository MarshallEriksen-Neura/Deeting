import inspect
import asyncio
import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Callable, Awaitable

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate

from app.agent_plugins.core.manager import PluginManager
from app.core.plugin_config import plugin_config_loader
from app.models.spec_agent import SpecPlan
from app.models.user_mcp_server import UserMcpServer
from app.models.conversation import ConversationChannel
from app.prompts.spec_planner import SPEC_PLANNER_SYSTEM_PROMPT
from app.repositories.conversation_message_repository import ConversationMessageRepository
from app.repositories.conversation_session_repository import ConversationSessionRepository
from app.repositories.provider_instance_repository import ProviderModelRepository
from app.repositories.spec_agent_repository import SpecAgentRepository
from app.schemas.spec_agent import SpecManifest, SpecNode
from app.schemas.tool import ToolCall, ToolDefinition
from app.services.conversation.service import ConversationService
from app.services.mcp.client import mcp_client
from app.services.mcp.discovery import mcp_discovery_service
from app.services.providers.llm import llm_service
from app.utils.time_utils import Datetime

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
        conversation_session_id: uuid.UUID | None = None,
        conversation_append: Callable[
            [AsyncSession, uuid.UUID, uuid.UUID, str, str, str], Awaitable[None]
        ]
        | None = None,
    ):
        self.plan_id = plan_id
        self.manifest = manifest
        self.repo = repo
        self.plugin_manager = plugin_manager
        self.user_id = user_id
        self.mcp_tools_map = mcp_tools_map
        self.available_tool_defs = available_tool_defs
        self.local_tool_handlers = local_tool_handlers
        self.conversation_session_id = conversation_session_id
        self.conversation_append = conversation_append

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

    async def _emit_node_event(self, event: str, node_id: str, content: str) -> None:
        if not self.conversation_append or not self.conversation_session_id:
            return
        try:
            await self.conversation_append(
                self.repo.session,
                self.conversation_session_id,
                self.user_id,
                node_id,
                event,
                content,
            )
        except Exception as exc:
            logger.warning("spec_agent_conversation_event_failed: %s", exc)

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
        latest_status = {log.node_id: log.status for log in latest_logs}
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
            if latest_status.get(node.id) in ("RUNNING", "WAITING_APPROVAL"):
                continue
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
        await self._emit_node_event(
            "node_started",
            node.id,
            f"Node {node.id} started",
        )

        if getattr(node, "check_in", False):
            await self.repo.finish_node_execution(log_entry.id, "WAITING_APPROVAL")
            await self._commit()
            await self._emit_node_event(
                "node_waiting",
                node.id,
                f"Node {node.id} waiting approval",
            )
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
                    "model": getattr(node, "model_override", None) or "auto",
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
                await self._emit_node_event(
                    "node_failed",
                    node.id,
                    f"Node {node.id} failed",
                )
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
            model_hint = getattr(node, "model_override", None)
            response = await llm_service.chat_completion(
                messages=messages,
                tools=tools_for_llm,
                temperature=0,
                model=model_hint,
                tenant_id=str(self.user_id),
                user_id=str(self.user_id),
                api_key_id=str(self.user_id),
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

    @staticmethod
    def _build_tools_description(tools: List[ToolDefinition]) -> str:
        if not tools:
            return "- None"
        lines: list[str] = []
        for tool in tools:
            schema = json.dumps(tool.input_schema or {}, ensure_ascii=False, default=str)
            lines.append(
                f"- Tool: {tool.name}\n  Desc: {tool.description or ''}\n  Schema: {schema}"
            )
        return "\n".join(lines)

    @staticmethod
    def _extract_json_payload(raw_text: str) -> dict[str, Any]:
        """
        Robust JSON extraction from LLM output.
        Handles:
        1. Pure JSON
        2. Markdown code blocks (```json ... ```)
        3. Text with JSON embedded
        """
        cleaned = raw_text.strip()
        
        # 1. Try finding markdown code block first
        code_block_pattern = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
        match = code_block_pattern.search(cleaned)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass # Fallback to wider search

        # 2. Try direct parsing
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # 3. Fuzzy search for outer braces
        try:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                potential_json = cleaned[start : end + 1]
                return json.loads(potential_json)
        except json.JSONDecodeError:
            pass
            
        # 4. If strict parsing fails, try to repair common issues (optional, risky but helpful)
        # For now, we just re-raise the last error or a generic one
        raise ValueError("Failed to extract valid JSON from response")

    def _parse_manifest(self, planner_output: Any) -> SpecManifest:
        if isinstance(planner_output, list):
            raise ValueError("planner_output_is_tool_call")
        if not isinstance(planner_output, str):
            raise ValueError("planner_output_invalid_type")
        payload = self._extract_json_payload(planner_output)
        return SpecManifest(**payload)

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text) / 4)) if text else 1

    async def _append_conversation_messages(
        self,
        session: AsyncSession,
        *,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        query: str,
        project_name: str,
    ) -> None:
        created_at = Datetime.now().isoformat()
        messages = [
            {
                "role": "user",
                "content": query,
                "token_estimate": self._estimate_tokens(query),
                "is_truncated": False,
                "meta_info": {"created_at": created_at},
            },
            {
                "role": "system",
                "content": "Drafting execution blueprint...",
                "token_estimate": self._estimate_tokens("Drafting execution blueprint..."),
                "is_truncated": False,
                "meta_info": {
                    "spec_agent_event": "drafting",
                    "created_at": created_at,
                },
            },
            {
                "role": "system",
                "content": f"Blueprint ready: {project_name}",
                "token_estimate": self._estimate_tokens(
                    f"Blueprint ready: {project_name}"
                ),
                "is_truncated": False,
                "meta_info": {
                    "spec_agent_event": "ready",
                    "project_name": project_name,
                    "created_at": Datetime.now().isoformat(),
                },
            },
        ]

        redis_messages = [dict(message) for message in messages]
        db_messages = [dict(message) for message in messages]
        redis_available = True
        conv_service: ConversationService | None = None
        result: dict[str, Any] = {"last_turn": None}

        try:
            conv_service = ConversationService()
        except Exception as exc:
            redis_available = False
            logger.warning("spec_agent_conversation_redis_unavailable: %s", exc)

        if redis_available and conv_service:
            try:
                result = await asyncio.wait_for(
                    conv_service.append_messages(
                        session_id=str(session_id),
                        messages=redis_messages,
                        channel=ConversationChannel.INTERNAL,
                    ),
                    timeout=1.0,
                )
            except Exception as exc:
                redis_available = False
                logger.warning("spec_agent_conversation_append_failed: %s", exc)

        session_repo = ConversationSessionRepository(session)
        message_repo = ConversationMessageRepository(session)

        if redis_available:
            for idx, msg in enumerate(db_messages):
                if idx < len(redis_messages):
                    msg["turn_index"] = redis_messages[idx].get("turn_index")
            last_turn = result.get("last_turn") if isinstance(result, dict) else None
        else:
            turn_indexes = await session_repo.reserve_turn_indexes(
                session_id=session_id,
                user_id=user_id,
                tenant_id=None,
                assistant_id=None,
                channel=ConversationChannel.INTERNAL,
                count=len(db_messages),
            )
            last_turn = turn_indexes[-1] if turn_indexes else None
            for msg, turn_index in zip(db_messages, turn_indexes, strict=False):
                msg["turn_index"] = turn_index

        await session_repo.upsert_session(
            session_id=session_id,
            user_id=user_id,
            tenant_id=None,
            assistant_id=None,
            channel=ConversationChannel.INTERNAL,
            last_active_at=Datetime.now(),
            message_count=last_turn,
            first_message_at=Datetime.now(),
            title=project_name,
        )
        await message_repo.bulk_insert_messages(
            session_id=session_id,
            messages=db_messages,
        )

    async def _append_spec_agent_event(
        self,
        session: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        node_id: str,
        event: str,
        content: str,
        source: Optional[str] = None,
    ) -> None:
        created_at = Datetime.now().isoformat()
        meta_info = {
            "spec_agent_event": event,
            "spec_agent_node_id": node_id,
            "created_at": created_at,
        }
        if source:
            meta_info["spec_agent_source"] = source

        message = {
            "role": "system",
            "content": content,
            "token_estimate": self._estimate_tokens(content),
            "is_truncated": False,
            "meta_info": meta_info,
        }

        redis_messages = [dict(message)]
        db_messages = [dict(message)]
        redis_available = True
        conv_service: ConversationService | None = None
        result: dict[str, Any] = {"last_turn": None}

        try:
            conv_service = ConversationService()
        except Exception as exc:
            redis_available = False
            logger.warning("spec_agent_conversation_redis_unavailable: %s", exc)

        if redis_available and conv_service:
            try:
                result = await asyncio.wait_for(
                    conv_service.append_messages(
                        session_id=str(session_id),
                        messages=redis_messages,
                        channel=ConversationChannel.INTERNAL,
                    ),
                    timeout=1.0,
                )
            except Exception as exc:
                redis_available = False
                logger.warning("spec_agent_conversation_append_failed: %s", exc)

        session_repo = ConversationSessionRepository(session)
        message_repo = ConversationMessageRepository(session)

        if redis_available:
            for idx, msg in enumerate(db_messages):
                if idx < len(redis_messages):
                    msg["turn_index"] = redis_messages[idx].get("turn_index")
            last_turn = result.get("last_turn") if isinstance(result, dict) else None
        else:
            turn_indexes = await session_repo.reserve_turn_indexes(
                session_id=session_id,
                user_id=user_id,
                tenant_id=None,
                assistant_id=None,
                channel=ConversationChannel.INTERNAL,
                count=len(db_messages),
            )
            last_turn = turn_indexes[-1] if turn_indexes else None
            for msg, turn_index in zip(db_messages, turn_indexes, strict=False):
                msg["turn_index"] = turn_index

        await session_repo.upsert_session(
            session_id=session_id,
            user_id=user_id,
            tenant_id=None,
            assistant_id=None,
            channel=ConversationChannel.INTERNAL,
            last_active_at=Datetime.now(),
            message_count=last_turn,
        )
        await message_repo.bulk_insert_messages(
            session_id=session_id,
            messages=db_messages,
        )

    async def generate_plan(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
    ) -> tuple["SpecPlan", SpecManifest]:
        await self.initialize_plugins(user_id=user_id)

        trimmed_query = query.strip()
        local_tools, _ = self._load_local_tools()
        mcp_tools, _ = await self._load_mcp_tools(session, user_id)
        tools_desc = self._build_tools_description(local_tools + mcp_tools)
        
        # Fetch available models for the user
        model_repo = ProviderModelRepository(session)
        user_models = await model_repo.get_available_models_for_user(str(user_id))
        if user_models:
            models_desc = "\n".join([f"- {m}" for m in user_models])
        else:
            models_desc = "(No user-configured models found. Leave model_override empty.)"

        system_prompt = SPEC_PLANNER_SYSTEM_PROMPT.replace("{{available_tools}}", tools_desc)
        system_prompt = system_prompt.replace("{{available_models}}", models_desc)

        user_prompt = trimmed_query
        if context:
            user_prompt = (
                f"{user_prompt}\n\nContext JSON: "
                f"{json.dumps(context, ensure_ascii=False, default=str)}"
            )

        response = await llm_service.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            model=model,
            temperature=0.4,
            max_tokens=2048,
            tenant_id=str(user_id),
            user_id=str(user_id),
            api_key_id=str(user_id),
        )
        manifest = self._parse_manifest(response)
        if context:
            manifest.context.update(context)

        repo = SpecAgentRepository(session)
        conversation_session_id = uuid.uuid4()
        plan = await repo.create_plan(
            user_id=user_id,
            project_name=manifest.project_name,
            manifest_data=manifest.model_dump(),
            conversation_session_id=conversation_session_id,
        )
        if manifest.context:
            await repo.update_plan_context(plan.id, manifest.context)
        await session.commit()
        await session.refresh(plan)
        try:
            await self._append_conversation_messages(
                session,
                session_id=conversation_session_id,
                user_id=user_id,
                query=trimmed_query,
                project_name=manifest.project_name,
            )
        except Exception as exc:
            logger.warning("spec_agent_conversation_append_failed: %s", exc)
        return plan, manifest

    async def start_plan(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        max_steps: int = 8,
    ) -> Dict[str, Any]:
        executor = await self.execute_plan(session, user_id, plan_id)
        executed_total = 0
        result: Dict[str, Any] = {}
        for _ in range(max_steps):
            result = await executor.run_step()
            executed_total += int(result.get("executed", 0) or 0)
            status = result.get("status")
            if status in ("waiting_approval", "completed", "failed", "stalled"):
                break
        if executed_total and "executed" not in result:
            result["executed"] = executed_total
        return result

    async def interact_with_plan(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        node_id: str,
        decision: str,
        feedback: Optional[str] = None,
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        log = await repo.get_latest_log_for_node(plan_id, node_id)
        if not log or log.status != "WAITING_APPROVAL":
            raise ValueError("checkpoint_not_found")

        decision_lower = decision.lower()
        payload = {"decision": decision_lower, "feedback": feedback}
        if decision_lower == "approve":
            await repo.finish_node_execution(log.id, "SUCCESS", output_data=payload)
            await repo.update_plan_status(plan_id, "RUNNING")
        elif decision_lower == "reject":
            await repo.finish_node_execution(
                log.id,
                "FAILED",
                output_data=payload,
                error_message="rejected_by_user",
            )
            await repo.update_plan_status(plan_id, "FAILED")
        elif decision_lower == "modify":
            await repo.finish_node_execution(log.id, "SUCCESS", output_data=payload)
            await repo.update_plan_status(plan_id, "RUNNING")
        else:
            raise ValueError("invalid_decision")

        await session.commit()
        return {"plan_id": str(plan_id), "node_id": node_id, "decision": decision_lower}

    async def update_plan_node_model(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        node_id: str,
        model_override: Optional[str],
        instruction: Optional[str] = None,
        model_override_set: bool = True,
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        target_node = next((node for node in manifest.nodes if node.id == node_id), None)
        if not target_node:
            raise ValueError("node_not_found")
        if getattr(target_node, "type", None) != "action":
            raise ValueError("node_not_action")

        normalized_model = target_node.model_override
        if model_override_set:
            normalized_model = model_override.strip() if model_override else None
            if normalized_model:
                model_repo = ProviderModelRepository(session)
                candidates = await model_repo.get_candidates(
                    capability="chat",
                    model_id=normalized_model,
                    user_id=str(user_id),
                    include_public=True,
                )
                if not candidates:
                    raise ValueError("model_not_available")

        instruction_value = instruction.strip() if instruction is not None else None
        pending_instruction: Optional[str] = None
        if instruction is not None:
            if not instruction_value:
                raise ValueError("instruction_empty")
            log = await repo.get_latest_log_for_node(plan_id, node_id)
            log_status = log.status if log else None
            if log_status == "RUNNING":
                target_node.pending_instruction = instruction_value
                pending_instruction = instruction_value
            elif log_status in ("WAITING_APPROVAL", None) or plan.status == "DRAFT":
                target_node.instruction = instruction_value
                target_node.pending_instruction = None
            else:
                raise ValueError("node_not_waiting")

        if model_override_set:
            target_node.model_override = normalized_model
        await repo.update_plan_manifest(plan_id, manifest.model_dump())
        await session.commit()
        return {
            "plan_id": str(plan_id),
            "node_id": node_id,
            "model_override": normalized_model,
            "instruction": instruction_value if pending_instruction is None else None,
            "pending_instruction": pending_instruction,
        }

    @staticmethod
    def _map_plan_status(status: str) -> str:
        mapping = {
            "DRAFT": "drafting",
            "RUNNING": "running",
            "PAUSED": "waiting",
            "COMPLETED": "completed",
            "FAILED": "error",
        }
        return mapping.get(status.upper(), "drafting")

    @staticmethod
    def _map_log_status(status: str) -> str:
        mapping = {
            "PENDING": "pending",
            "RUNNING": "active",
            "SUCCESS": "completed",
            "FAILED": "error",
            "WAITING_APPROVAL": "waiting",
            "SKIPPED": "completed",
        }
        return mapping.get(status.upper(), "pending")

    @staticmethod
    def _build_connections(nodes: List[SpecNode]) -> List[Dict[str, str]]:
        connections: list[dict[str, str]] = []
        for node in nodes:
            for dep in node.needs:
                connections.append({"source": dep, "target": node.id})
        return connections

    async def list_plans(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        params: CursorParams,
        status: Optional[str] = None,
    ) -> CursorPage[SpecPlan]:
        stmt = select(SpecPlan).where(SpecPlan.user_id == user_id)
        if status:
            stmt = stmt.where(SpecPlan.status == status)
        stmt = stmt.order_by(desc(SpecPlan.created_at), desc(SpecPlan.id))
        return await paginate(session, stmt, params=params)

    async def get_plan_detail(
        self, session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        logs = await repo.get_latest_node_logs(plan_id)
        progress = 0
        if manifest.nodes:
            done = len([log for log in logs if log.status in ("SUCCESS", "SKIPPED")])
            progress = int((done / len(manifest.nodes)) * 100)
        elif plan.status == "COMPLETED":
            progress = 100

        return {
            "id": plan.id,
            "conversation_session_id": (
                str(plan.conversation_session_id)
                if plan.conversation_session_id
                else None
            ),
            "project_name": plan.project_name,
            "manifest": manifest,
            "connections": self._build_connections(manifest.nodes),
            "execution": {
                "status": self._map_plan_status(plan.status),
                "progress": progress,
            },
        }

    async def get_plan_node_detail(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        node_id: str,
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        target_node = next((node for node in manifest.nodes if node.id == node_id), None)
        if not target_node:
            raise ValueError("node_not_found")

        log = await repo.get_latest_log_for_node(plan_id, node_id)
        worker_sessions = await repo.get_sessions_by_log_ids(
            [log.id] if log else []
        )
        node_logs: List[str] = []
        execution_status = "pending"
        duration_ms = None

        if log:
            execution_status = self._map_log_status(log.status)
            if log.started_at and log.completed_at:
                duration_ms = int(
                    (log.completed_at - log.started_at).total_seconds() * 1000
                )
            if log.error_message:
                node_logs.append(f"> Error: {log.error_message}")
            worker_session = worker_sessions.get(log.id)
            if worker_session and worker_session.thought_trace:
                node_logs.extend(self._format_trace_to_logs(worker_session.thought_trace))

        return {
            "plan_id": str(plan_id),
            "node_id": node_id,
            "node": target_node,
            "execution": {
                "status": execution_status,
                "created_at": log.created_at if log else None,
                "started_at": log.started_at if log else None,
                "completed_at": log.completed_at if log else None,
                "duration_ms": duration_ms,
                "input_snapshot": log.input_snapshot if log else None,
                "output_data": log.output_data if log else None,
                "raw_response": log.raw_response if log else None,
                "error_message": log.error_message if log else None,
                "worker_snapshot": log.worker_snapshot if log else None,
                "logs": node_logs,
            },
        }

    @staticmethod
    def _format_trace_to_logs(trace: List[Dict[str, Any]]) -> List[str]:
        logs = []
        if not trace:
            return logs
        for step in trace:
            kind = step.get("step")
            if kind == "start":
                logs.append(f"> Node started. Tool count: {step.get('tool_count')}")
            elif kind == "tool_calls":
                tools = step.get("tools", [])
                logs.append(f"> Calling tools: {', '.join(tools)}")
            elif kind == "tool_result":
                tool = step.get("tool")
                preview = step.get("result_preview")
                logs.append(f"> Tool '{tool}' returned: {preview}")
            elif kind == "final":
                preview = step.get("preview")
                logs.append(f"> Final answer: {preview}")
                logs.append("> Success.")
        return logs

    async def get_plan_status(
        self, session: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        logs = await repo.get_latest_node_logs(plan_id)
        log_map = {log.node_id: log for log in logs}

        # Batch fetch sessions for logs
        log_ids = [log.id for log in logs]
        worker_sessions = await repo.get_sessions_by_log_ids(log_ids)

        nodes_payload: list[dict[str, Any]] = []
        completed = 0
        waiting_nodes: list[str] = []
        for node in manifest.nodes:
            log = log_map.get(node.id)
            status = "pending"
            duration_ms = None
            output_preview = None
            pulse = None
            skipped = False
            node_logs: List[str] = []

            if log:
                status = self._map_log_status(log.status)
                skipped = log.status == "SKIPPED"
                if log.status in ("SUCCESS", "SKIPPED"):
                    completed += 1
                if log.status == "WAITING_APPROVAL":
                    waiting_nodes.append(node.id)
                    pulse = "waiting_approval"
                if log.started_at and log.completed_at:
                    duration_ms = int(
                        (log.completed_at - log.started_at).total_seconds() * 1000
                    )
                if log.output_data:
                    output_preview = json.dumps(
                        log.output_data, ensure_ascii=False, default=str
                    )[:200]
                if log.error_message:
                    output_preview = log.error_message[:200]
                    node_logs.append(f"> Error: {log.error_message}")
                
                # Format session trace to logs
                worker_session = worker_sessions.get(log.id)
                if worker_session and worker_session.thought_trace:
                    node_logs.extend(self._format_trace_to_logs(worker_session.thought_trace))

            nodes_payload.append(
                {
                    "id": node.id,
                    "status": status,
                    "duration_ms": duration_ms,
                    "output_preview": output_preview,
                    "pulse": pulse,
                    "skipped": skipped,
                    "logs": node_logs,
                }
            )

        progress = 0
        if manifest.nodes:
            progress = int((completed / len(manifest.nodes)) * 100)
        elif plan.status == "COMPLETED":
            progress = 100

        checkpoint = None
        if waiting_nodes:
            checkpoint = {"node_id": waiting_nodes[0]}

        return {
            "execution": {
                "status": self._map_plan_status(plan.status),
                "progress": progress,
            },
            "nodes": nodes_payload,
            "checkpoint": checkpoint,
        }

    async def rerun_plan_node(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        node_id: str,
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        node_map = {node.id: node for node in manifest.nodes}
        if node_id not in node_map:
            raise ValueError("node_not_found")

        target_node = node_map[node_id]
        if getattr(target_node, "type", None) == "action" and getattr(
            target_node, "pending_instruction", None
        ):
            target_node.instruction = target_node.pending_instruction
            target_node.pending_instruction = None

        dependents: dict[str, list[str]] = {n.id: [] for n in manifest.nodes}
        for n in manifest.nodes:
            for dep in n.needs:
                if dep in dependents:
                    dependents[dep].append(n.id)

        queue = [node_id]
        visited: set[str] = set()
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            for child in dependents.get(current, []):
                queue.append(child)

        queued_nodes = sorted(visited)

        for queued_id in queued_nodes:
            await repo.mark_node_pending(
                plan_id=plan_id,
                node_id=queued_id,
                reason="manual_rerun",
            )

        context = dict(plan.current_context or {})
        for queued_id in queued_nodes:
            node = node_map.get(queued_id)
            output_key = getattr(node, "output_as", None)
            if output_key and output_key in context:
                context.pop(output_key, None)
        await repo.update_plan_context(plan_id, context)
        await repo.update_plan_manifest(plan_id, manifest.model_dump())
        await repo.update_plan_status(plan_id, "RUNNING")
        await session.commit()

        return {"plan_id": str(plan_id), "node_id": node_id, "queued_nodes": queued_nodes}

    async def append_plan_node_event(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        node_id: str,
        event: str,
        source: str,
    ) -> Dict[str, Any]:
        repo = SpecAgentRepository(session)
        plan = await repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            raise ValueError("plan_not_found")

        manifest = SpecManifest(**plan.manifest_data)
        if not any(node.id == node_id for node in manifest.nodes):
            raise ValueError("node_not_found")

        content = f"node_event:{event}"
        if not plan.conversation_session_id:
            return {"status": "skip"}

        await self._append_spec_agent_event(
            session,
            session_id=plan.conversation_session_id,
            user_id=user_id,
            node_id=node_id,
            event=event,
            content=content,
            source=source,
        )
        return {"status": "ok"}

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
            conversation_session_id=plan.conversation_session_id,
            conversation_append=self._append_spec_agent_event,
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
