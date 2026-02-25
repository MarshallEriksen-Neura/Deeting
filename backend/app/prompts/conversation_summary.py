# Conversation summary prompt

CONVERSATION_SUMMARY_PROMPT_TEMPLATE = """
请对以下多轮对话内容进行摘要，要求：
1) 保留关键信息和上下文，包括用户意图、重要决策和结论；
2) 去除冗余和重复内容；
3) 摘要长度控制在 500 字以内；
4) 仅输出摘要文本，不要额外解释。

对话内容：
{conversation}
"""
