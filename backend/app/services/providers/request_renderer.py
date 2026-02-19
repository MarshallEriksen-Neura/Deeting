import json
import logging
import re
from typing import Any

from jinja2 import BaseLoader, Environment, select_autoescape

from app.schemas.gateway import ChatCompletionRequest
from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)

# 初始化 Jinja2 环境
from jinja2 import Undefined


class SilentUndefined(Undefined):
    def _fail_with_undefined_error(self, *args, **kwargs):
        return None

    def __getattr__(self, name):
        return SilentUndefined()

    def __str__(self):
        return ""


class ModelRef(str):
    """兼容 `model` 与 `model.uid` 两种模板写法。"""

    @property
    def uid(self) -> str:
        return str(self)

    @property
    def id(self) -> str:
        return str(self)

    @property
    def name(self) -> str:
        return str(self)


jinja_env = Environment(
    loader=BaseLoader(),
    autoescape=select_autoescape(),
    undefined=SilentUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)

_PYTHON_LITERAL_TO_JINJA = {
    "None": "none",
    "True": "true",
    "False": "false",
}
_PYTHON_LITERAL_PATTERN = re.compile(r"\b(None|True|False)\b")
_PYTHON_TEST_PATTERN = re.compile(r"No test named '(None|True|False)'")
_TOJSON_FILTER_PATTERN = re.compile(r"\|\s*tojson\b")


class RequestRenderer:
    """
    优雅的请求渲染服务。
    连接 Agent 配置 (Template) 与 内部逻辑 (Internal Schema)。
    """

    def render(
        self,
        item_config: Any,  # provider_model config
        internal_req: ChatCompletionRequest | dict,
        tools: list[ToolDefinition] | None = None,
        extra_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        统一入口：根据 item 配置的引擎类型，调度不同的渲染逻辑。
        """
        engine = item_config.template_engine or "simple_replace"

        # 1. 准备上下文 (Context)
        if hasattr(internal_req, "model_dump"):
            context = internal_req.model_dump(exclude_none=True)
        else:
            context = dict(internal_req)

        if extra_context:
            context.update(extra_context)
        context = self._apply_context_aliases(context)

        # 2. 调度 Body 渲染
        try:
            body = {}
            if engine == "jinja2":
                body = self._render_jinja2(item_config.request_template, context)

            elif engine == "openai_compat":
                body = self._render_simple_merge(item_config.request_template, context)

            elif engine == "anthropic_messages":
                # 预留给 Claude Adapter
                # body = AnthropicAdapter.convert(internal_req)
                # 暂时 fallback 到 simple merge 以免报错
                body = self._render_simple_merge(item_config.request_template, context)
            else:
                body = self._render_simple_merge(item_config.request_template, context)

            # 3. 注入工具 (Tool Injection)
            # 只有当 internal_req 包含 tools 或者显式传入了 tools 时才处理
            if tools:
                self._inject_tools(body, tools, engine)

            return body

        except Exception as e:
            logger.error(f"Request render failed: engine={engine} error={e}")
            raise ValueError(f"Failed to render request: {e!s}")

    @staticmethod
    def _apply_context_aliases(context: dict[str, Any]) -> dict[str, Any]:
        """补齐常见模板别名，兼容历史模板约定。"""
        input_ctx = context.get("input")
        if not isinstance(input_ctx, dict):
            request_ctx = context.get("request")
            if isinstance(request_ctx, dict):
                context["input"] = dict(request_ctx)
            else:
                context["input"] = dict(context)

        model_ctx = context.get("model")
        if isinstance(model_ctx, str):
            context["model"] = ModelRef(model_ctx)
        elif model_ctx is None:
            input_model = context.get("input", {}).get("model")
            if isinstance(input_model, str):
                context["model"] = ModelRef(input_model)

        return context

    def _inject_tools(self, body: dict, tools: list[ToolDefinition], engine: str):
        """
        根据引擎类型，将内部 ToolDefinition 转为厂商格式并注入 body
        """
        if not tools:
            return

        # OpenAI 格式 (也是默认格式)
        if engine == "openai_compat" or engine == "simple_replace":
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    },
                }
                for t in tools
            ]
            # 默认 auto
            if "tool_choice" not in body:
                body["tool_choice"] = "auto"

        # Anthropic 格式
        elif engine == "anthropic_messages":
            body["tools"] = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                }
                for t in tools
            ]
            # Anthropic 不需要 tool_choice="auto"，它是默认的

        # Gemini 格式 (function_declarations)
        elif engine == "google_gemini":
            # Gemini 的结构比较深: tools = [{ function_declarations: [...] }]
            declarations = [
                {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                }
                for t in tools
            ]
            body["tools"] = [{"function_declarations": declarations}]

        # Jinja2 引擎通常由模板自己控制 tool 格式，但如果我们想自动注入，
        # 需要看模板是否预留了 {{ tools }} 变量。
        # 这里为了简单，如果 body 是字典，我们尝试智能注入。
        elif engine == "jinja2" and isinstance(body, dict):
            # 假设 Jinja2 模板也是生成 OpenAI 风格的 JSON
            # 如果不是，那 Agent 在写模板时就应该自己把 tools 渲染进去
            pass

    def _render_jinja2(self, template_schema: dict | str, context: dict) -> dict:
        """Jinja2 渲染逻辑"""
        if not template_schema:
            return context

        def render_string(template: str) -> str:
            try:
                return jinja_env.from_string(template).render(**context)
            except Exception as exc:
                # 兼容 AI 常生成的 Python 字面量写法（None/True/False）。
                # Jinja2 语法要求使用 none/true/false。
                msg = str(exc)
                should_retry = (
                    " is undefined" in msg
                    and any(k in msg for k in _PYTHON_LITERAL_TO_JINJA)
                ) or bool(_PYTHON_TEST_PATTERN.search(msg))
                if not should_retry:
                    raise

                normalized = _PYTHON_LITERAL_PATTERN.sub(
                    lambda m: _PYTHON_LITERAL_TO_JINJA[m.group(1)], template
                )
                if normalized == template:
                    raise
                return jinja_env.from_string(normalized).render(**context)

        def recursive_render(obj):
            if isinstance(obj, str):
                if "{{" in obj or "{%" in obj:
                    rendered_value = render_string(obj)
                    if _TOJSON_FILTER_PATTERN.search(obj):
                        try:
                            return json.loads(rendered_value)
                        except Exception:
                            return rendered_value
                    return rendered_value
                return obj
            elif isinstance(obj, dict):
                return {k: recursive_render(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [recursive_render(elem) for elem in obj]
            return obj

        try:
            rendered = recursive_render(template_schema)
            if isinstance(rendered, str):
                try:
                    return json.loads(rendered)
                except:
                    return {"raw_body": rendered}
            return rendered
        except Exception:
            raise

    def _render_simple_merge(self, template: dict | None, context: dict) -> dict:
        """简单合并策略"""
        if not template:
            return context
        body = template.copy()
        for k, v in context.items():
            if v is not None:
                body[k] = v
        return body


request_renderer = RequestRenderer()
