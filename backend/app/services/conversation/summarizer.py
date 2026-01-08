from __future__ import annotations

import textwrap
from typing import Any

from loguru import logger

from app.core.config import settings


class SummarizerService:
    """
    摘要服务占位实现：
    - 若配置了 CONVERSATION_SUMMARIZER_PRESET_ID，可在此处接入真实编排/上游调用
    - 默认回退为轻量摘要：抽取最近若干轮的要点，控制长度
    """

    def __init__(self) -> None:
        self.preset_id = settings.CONVERSATION_SUMMARIZER_PRESET_ID
        self.max_tokens = settings.CONVERSATION_SUMMARY_MAX_TOKENS

    async def summarize(self, messages: list[dict[str, Any]]) -> str:
        if not messages:
            return ""

        # TODO: 接入真实上游模型。当前使用简易提炼避免阻塞。
        summary_lines = []
        recent = messages[-8:]  # 取近几轮，避免过长
        for msg in recent:
            role = msg.get("role", "user")
            content = msg.get("content", "") or ""
            summary_lines.append(f"[{role}] {content}")

        summary = "\n".join(summary_lines)
        summary = textwrap.shorten(summary, width=2000, placeholder=" ...")

        if not self.preset_id:
            logger.warning(
                "CONVERSATION_SUMMARIZER_PRESET_ID 未配置，使用本地轻量摘要，建议尽快接入真实模型。"
            )

        return summary
