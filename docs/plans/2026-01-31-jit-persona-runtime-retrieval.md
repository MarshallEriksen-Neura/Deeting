# JIT Persona Runtime Retrieval Implementation Plan

> 状态：已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- JIT Persona 的运行时检索、`consult_expert_network` 工具注入/移除，以及 `used_persona_id` 归因落库已经进入现行实现。
- 手动锁定 assistant 的场景不再暴露该检索工具，后续行为以 workflow 和测试为准。

## 当前实现入口
- JIT 工具注入：`backend/app/services/workflow/steps/jit_persona_tool_injection.py`
- Persona 候选检索：`backend/app/services/assistant/assistant_retrieval_service.py`
- assistant 归因字段：`backend/app/models/conversation.py`
- 归因写库：`backend/app/services/workflow/steps/conversation_append.py`
- repository 落库字段：`backend/app/repositories/conversation_message_repository.py`
- 数据迁移：`backend/migrations/versions/20260131_02_add_used_persona_id.py`
- 回归测试：`backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py`
- 回归测试：`backend/tests/services/assistant/test_assistant_retrieval_service.py`
- 回归测试：`backend/tests/unit/orchestrator/test_steps/test_conversation_append_persona_id.py`

## 维护说明
- 本文件不再维护任务拆解和提交步骤。
- 如需继续扩展 JIT Persona，请直接基于现有 workflow、conversation schema 与测试补充新方案。
