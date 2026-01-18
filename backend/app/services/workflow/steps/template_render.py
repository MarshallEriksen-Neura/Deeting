"""
TemplateRenderStep: 模板渲染步骤

职责：
- 根据 template_engine 渲染 upstream_path 和 body
- 支持 simple_replace 和 jinja2 两种引擎
- 处理占位符替换
"""

import logging
import re
from typing import TYPE_CHECKING, Any

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


class TemplateRenderError(Exception):
    """模板渲染失败"""

    pass


@step_registry.register
class TemplateRenderStep(BaseStep):
    """
    模板渲染步骤

    从上下文读取:
        - routing.upstream_url: 上游 URL（可能含占位符）
        - routing.template_engine: 模板引擎类型
        - routing.template_config: 模板配置
        - validation.validated: 已校验的请求数据

    写入上下文:
        - template_render.upstream_url: 渲染后的 URL
        - template_render.request_body: 渲染后的请求体
        - template_render.headers: 渲染后的请求头
    """

    name = "template_render"
    depends_on = ["routing"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行模板渲染"""
        upstream_url = ctx.get("routing", "upstream_url") or ctx.selected_upstream
        template_engine = ctx.get("routing", "template_engine") or "simple_replace"
        request_data = ctx.get("validation", "validated") or {}
        default_params = ctx.get("routing", "default_params") or {}
        default_headers = ctx.get("routing", "default_headers") or {}

        try:
            # 构建渲染上下文
            render_context = self._build_render_context(ctx, request_data)

            # 渲染 URL
            rendered_url = await self._render_template(
                template=upstream_url,
                engine=template_engine,
                context=render_context,
            )

            # 渲染请求体
            rendered_body = await self._render_body(
                request_data=request_data,
                default_params=default_params,
                engine=template_engine,
                context=render_context,
            )

            # 渲染请求头
            rendered_headers = await self._render_headers(
                ctx=ctx,
                default_headers=default_headers,
                engine=template_engine,
                context=render_context,
            )

            # 写入上下文
            ctx.set("template_render", "upstream_url", rendered_url)
            ctx.set("template_render", "request_body", rendered_body)
            ctx.set("template_render", "headers", rendered_headers)

            ctx.emit_status(
                stage="evolve",
                step=self.name,
                state="success",
                code="template.rendered",
                meta={"engine": template_engine},
            )

            logger.debug(
                f"Template rendered trace_id={ctx.trace_id} "
                f"engine={template_engine} url={rendered_url}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "upstream_url": rendered_url,
                    "engine": template_engine,
                },
            )

        except TemplateRenderError as e:
            logger.error(f"Template render failed: {e}")
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )

    def _build_render_context(
        self,
        ctx: "WorkflowContext",
        request_data: dict,
    ) -> dict[str, Any]:
        """构建模板渲染上下文"""
        conversation_messages = ctx.get("conversation", "merged_messages") or request_data.get("messages", [])
        summary = ctx.get("conversation", "summary")
        return {
            # 请求数据
            "model": ctx.requested_model or request_data.get("model"),
            "messages": conversation_messages,
            "stream": request_data.get("stream", False),
            # 路由信息
            "provider": ctx.get("routing", "provider"),
            "capability": ctx.capability,
            # 会话
            "session_id": ctx.get("conversation", "session_id"),
            "summary": summary,
            # 租户信息
            "tenant_id": ctx.tenant_id,
            "api_key_id": ctx.api_key_id,
            # 原始请求
            "request": request_data,
        }

    async def _render_template(
        self,
        template: str,
        engine: str,
        context: dict,
    ) -> str:
        """渲染模板字符串"""
        if not template:
            return ""

        if engine == "simple_replace":
            return self._simple_replace(template, context)
        elif engine == "jinja2":
            return await self._jinja2_render(template, context)
        else:
            # 不支持的引擎，返回原始模板
            logger.warning(f"Unknown template engine: {engine}")
            return template

    def _simple_replace(self, template: str, context: dict) -> str:
        """
        简单占位符替换

        支持格式: ${key} 或 {{key}}
        """
        result = template

        # 处理 ${key} 格式
        def replace_dollar(match: re.Match) -> str:
            key = match.group(1)
            value = context.get(key, match.group(0))
            return str(value) if value is not None else ""

        result = re.sub(r"\$\{(\w+)\}", replace_dollar, result)

        # 处理 {{key}} 格式
        def replace_brace(match: re.Match) -> str:
            key = match.group(1).strip()
            value = context.get(key, match.group(0))
            return str(value) if value is not None else ""

        result = re.sub(r"\{\{(\w+)\}\}", replace_brace, result)

        return result

    async def _jinja2_render(self, template: str, context: dict) -> str:
        """
        Jinja2 模板渲染

        支持完整的 Jinja2 语法
        """
        try:
            from jinja2 import BaseLoader, Environment, select_autoescape

            env = Environment(
                loader=BaseLoader(),
                autoescape=select_autoescape(default=False),
            )
            tpl = env.from_string(template)
            return tpl.render(**context)
        except ImportError:
            logger.warning("Jinja2 not installed, falling back to simple_replace")
            return self._simple_replace(template, context)
        except Exception as e:
            raise TemplateRenderError(f"Jinja2 render failed: {e}")

    async def _render_body(
        self,
        request_data: dict,
        default_params: dict,
        engine: str,
        context: dict,
    ) -> dict:
        """
        渲染请求体

        通常直接透传请求数据，但可根据配置进行转换
        """
        merged = {**default_params, **request_data}
        merged.pop("status_stream", None)
        return merged

    async def _render_headers(
        self,
        ctx: "WorkflowContext",
        default_headers: dict,
        engine: str,
        context: dict,
    ) -> dict[str, str]:
        """渲染请求头"""
        headers = {
            "Content-Type": "application/json",
            "X-Trace-Id": ctx.trace_id,
        }
        headers.update({k: str(v) for k, v in (default_headers or {}).items()})

        # 根据 provider 添加特定 header
        provider = ctx.get("routing", "provider")
        if provider == "openai":
            headers["OpenAI-Organization"] = ctx.tenant_id or ""

        return headers
