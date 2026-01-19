from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from app.services.oss.asset_storage_service import (
    AssetStorageNotConfigured,
    build_signed_asset_url,
)
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

ASSET_URL_PREFIX = "asset://"


@step_registry.register
class ResolveAssetsStep(BaseStep):
    """解析 asset:// 引用为可访问的短链 URL（仅用于上游调用）"""

    name = "resolve_assets"
    depends_on = ["validation"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        if ctx.capability != "chat":
            return StepResult(status=StepStatus.SUCCESS, message="skip_non_chat")

        request_data = ctx.get("validation", "validated") or {}
        if not isinstance(request_data, dict):
            return StepResult(status=StepStatus.SUCCESS, message="skip_invalid_request")

        base_url = ctx.get("request", "base_url")

        try:
            resolved_request, request_count = self._resolve_request_data(
                request_data, base_url
            )
            if request_count:
                ctx.set("resolve_assets", "request_data", resolved_request)
            else:
                ctx.set("resolve_assets", "request_data", request_data)

            merged_messages = ctx.get("conversation", "merged_messages")
            merged_count = 0
            if isinstance(merged_messages, list) and merged_messages:
                resolved_messages, merged_count = self._resolve_messages(
                    merged_messages, base_url
                )
                if merged_count:
                    ctx.set("resolve_assets", "merged_messages", resolved_messages)

        except AssetStorageNotConfigured as exc:
            logger.warning("resolve_assets_not_configured trace_id=%s err=%s", ctx.trace_id, exc)
            return StepResult(status=StepStatus.FAILED, message=str(exc))
        except Exception as exc:
            logger.warning("resolve_assets_failed trace_id=%s err=%s", ctx.trace_id, exc)
            return StepResult(status=StepStatus.FAILED, message=str(exc))

        total = request_count + merged_count
        if total:
            ctx.emit_status(
                stage="remember",
                step=self.name,
                state="success",
                code="assets.resolved",
                meta={"count": total},
            )

        return StepResult(status=StepStatus.SUCCESS, data={"resolved": total})

    def _resolve_request_data(
        self, request_data: dict[str, Any], base_url: str | None
    ) -> tuple[dict[str, Any], int]:
        messages = request_data.get("messages")
        if not isinstance(messages, list) or not messages:
            return request_data, 0

        resolved_messages, resolved_count = self._resolve_messages(messages, base_url)
        if not resolved_count:
            return request_data, 0

        resolved_request = dict(request_data)
        resolved_request["messages"] = resolved_messages
        return resolved_request, resolved_count

    def _resolve_messages(
        self, messages: list[Any], base_url: str | None
    ) -> tuple[list[Any], int]:
        resolved_messages: list[Any] = []
        resolved_count = 0
        for message in messages:
            if not isinstance(message, dict):
                resolved_messages.append(message)
                continue
            content = message.get("content")
            new_content, count = self._resolve_content(content, base_url)
            if count:
                resolved_messages.append({**message, "content": new_content})
                resolved_count += count
            else:
                resolved_messages.append(message)
        return resolved_messages, resolved_count

    def _resolve_content(
        self, content: Any, base_url: str | None
    ) -> tuple[Any, int]:
        if isinstance(content, list):
            return self._resolve_blocks(content, base_url)

        if isinstance(content, str):
            parsed = self._try_parse_blocks(content)
            if parsed is None:
                return content, 0
            resolved_blocks, count = self._resolve_blocks(parsed, base_url)
            if not count:
                return content, 0
            return json.dumps(resolved_blocks), count

        return content, 0

    def _resolve_blocks(
        self, blocks: list[Any], base_url: str | None
    ) -> tuple[list[Any], int]:
        resolved_blocks: list[Any] = []
        resolved_count = 0
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "image_url":
                resolved_blocks.append(block)
                continue
            url = self._extract_image_url(block.get("image_url"))
            object_key = self._extract_asset_key(url)
            if not object_key:
                resolved_blocks.append(block)
                continue

            signed_url = build_signed_asset_url(object_key, base_url=base_url)
            new_block = dict(block)
            image_url = block.get("image_url")
            if isinstance(image_url, dict):
                new_block["image_url"] = {**image_url, "url": signed_url}
            else:
                new_block["image_url"] = {"url": signed_url}
            resolved_blocks.append(new_block)
            resolved_count += 1
        return resolved_blocks, resolved_count

    @staticmethod
    def _extract_image_url(image_url: Any) -> str | None:
        if isinstance(image_url, str):
            return image_url.strip()
        if isinstance(image_url, dict):
            url = image_url.get("url")
            if isinstance(url, str):
                return url.strip()
        return None

    @staticmethod
    def _extract_asset_key(url: str | None) -> str | None:
        if not url or not isinstance(url, str):
            return None
        if not url.startswith(ASSET_URL_PREFIX):
            return None
        return url[len(ASSET_URL_PREFIX) :].lstrip("/")

    @staticmethod
    def _try_parse_blocks(content: str) -> list[Any] | None:
        stripped = content.strip()
        if not (stripped.startswith("[") and stripped.endswith("]")):
            return None
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return parsed
        return None
