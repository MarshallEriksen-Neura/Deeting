# 内部通道思维链 Blocks 统一输出设计

> 状态：已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 内部通道已经以 `blocks` 作为结构化 UI 输出契约，前后端不再依赖历史草案中的逐项实施说明。
- 实时 `blocks` 事件、消息落库回填和前端消息块渲染均已进入现行实现。

## 当前实现入口
- 实时事件发送：`backend/app/services/orchestrator/context.py`
- Agent 执行期块输出：`backend/app/services/workflow/steps/agent_executor.py`
- 对话落库与 `meta_info.blocks` 回填：`backend/app/services/workflow/steps/conversation_append.py`
- 前端消息块状态同步：`deeting/store/chat-store.ts`
- 回归测试：`backend/tests/unit/services/test_blocks_transformer.py`

## 维护说明
- 后续如需调整 `blocks` 协议，请直接以代码和 API 文档为准。
- 本文件不再维护详细设计过程，仅保留历史背景说明。
