# Design: Deeting OS - Automated Expert Network (JIT Persona Routing)

> 状态：核心链路已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- JIT Persona Routing 的运行时检索、工具注入、assistant 锁定与 `used_persona_id` 归因已经进入现行实现。
- 文档中关于“动态工具挂载”的远期设想并未完整按原稿落地，当前以 `consult_expert_network` + workflow 控制为主。

## 当前实现入口
- JIT 工具注入：`backend/app/services/workflow/steps/jit_persona_tool_injection.py`
- Persona 检索服务：`backend/app/services/assistant/assistant_retrieval_service.py`
- Agent 执行期 assistant 锁定逻辑：`backend/app/services/workflow/steps/agent_executor.py`
- 消息归因写库：`backend/app/services/workflow/steps/conversation_append.py`
- 归因字段模型：`backend/app/models/conversation.py`
- Expert Network 官方技能：`packages/official-skills/expert_network/deeting.json`
- 回归测试：`backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py`
- 回归测试：`backend/tests/services/assistant/test_assistant_retrieval_service.py`

## 维护说明
- 如需继续推进更强的 persona+tools 热切换能力，请围绕当前 workflow 与 expert-network skill 重新开新方案。
- 本文件仅保留历史归档说明。
