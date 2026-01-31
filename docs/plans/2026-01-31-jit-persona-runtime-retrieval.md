# JIT Persona Runtime Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 JIT Persona 的运行时检索/回查：模型通过工具决定是否触发专家检索，返回候选并记录 used_persona_id；手动锁定会话时不暴露该工具；暂不做动态工具挂载（skills/tool mounting）。

**Architecture:** 新增 Expert Network 工具插件（consult_expert_network）+ 检索/回查服务；在 workflow 中按会话状态注入/移除该工具；工具调用时执行 Qdrant Top-K 搜索并回查 Postgres，写入上下文并在消息落库时记录 used_persona_id。错误统一降级为不选择 persona，保留 Router Base Prompt。

**Tech Stack:** FastAPI、Async SQLAlchemy、Qdrant、Plugin 系统、pytest、Alembic。

---

### Task 1: 找到 3+ 相似模式并确认依赖点

**Files:**
- Read: `backend/app/services/memory/qdrant_service.py`
- Read: `backend/app/storage/qdrant_kb_store.py`
- Read: `backend/app/tasks/assistant.py`
- Read: `backend/app/services/workflow/steps/mcp_discovery.py`
- Read: `backend/app/services/workflow/steps/agent_executor.py`
- Read: `backend/app/services/workflow/steps/assistant_prompt_injection.py`
- Read: `backend/app/services/workflow/steps/conversation_append.py`

**Step 1: 记录 Qdrant 搜索与降级逻辑**
- 摘要 search_points / search_plugins 的入参与过滤结构、qdrant 未配置的降级行为

**Step 2: 记录工具注入与执行路径**
- 摘要 McpDiscoveryStep → tool_context_service → AgentExecutor 的工具调用流

**Step 3: 记录消息落库扩展点**
- 摘要 conversation_append 里对 meta_info 的扩展和 bulk_insert 的字段形态

---

### Task 2: 写失败测试 - JIT Tool 注入条件

**Files:**
- Create: `backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py`

**Step 1: 写失败测试（auto 模式暴露工具）**
```python
async def test_injects_tool_when_no_assistant_id(ctx_factory):
    ctx = ctx_factory(assistant_id=None, session_assistant_id=None)
    step = JitPersonaToolInjectionStep()
    await step.execute(ctx)
    tools = ctx.get("mcp_discovery", "tools") or []
    assert any(t.name == "consult_expert_network" for t in tools)
```

**Step 2: 写失败测试（手动锁定或显式 assistant_id 时不暴露工具）**
```python
async def test_skips_tool_when_assistant_locked(ctx_factory):
    ctx = ctx_factory(assistant_id="uuid", session_assistant_id="uuid")
    step = JitPersonaToolInjectionStep()
    await step.execute(ctx)
    tools = ctx.get("mcp_discovery", "tools") or []
    assert all(t.name != "consult_expert_network" for t in tools)
```

**Step 3: 运行测试确保失败**
Run: `pytest backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py -v`
Expected: FAIL（step 未实现）

---

### Task 3: 实现 Expert Network 工具插件（consult_expert_network）

**Files:**
- Create: `backend/app/agent_plugins/builtins/expert_network/plugin.py`
- Modify: `backend/app/core/plugins.yaml`
- Create: `backend/app/services/assistant/assistant_retrieval_service.py`
- Test: `backend/tests/services/assistant/test_assistant_retrieval_service.py`

**Step 1: 写失败测试（Qdrant 未配置返回空）**
```python
async def test_retrieval_skips_when_qdrant_disabled(mocker, async_session):
    service = AssistantRetrievalService(async_session)
    mocker.patch("app.qdrant_client.qdrant_is_configured", return_value=False)
    result = await service.search_candidates("query", limit=3)
    assert result == []
```

**Step 2: 实现检索/回查服务**
- Qdrant 搜索 `expert_network`
- 回查 Postgres 获取最新版本 system_prompt（只返回摘要/ID/名称）
- 降级：异常/空结果返回 []

**Step 3: 实现插件工具定义与 handler**
```python
# get_tools 返回 consult_expert_network schema
# handler 接收 intent_query, k, 并返回候选列表（含 assistant_id/name/summary/score）
# handler 支持 __context__ 时可写入 ctx.set("assistant", ...)
```

**Step 4: 运行测试确保通过**
Run: `pytest backend/tests/services/assistant/test_assistant_retrieval_service.py -v`
Expected: PASS

---

### Task 4: 实现 JIT Tool 注入 Step（仅 auto）

**Files:**
- Create: `backend/app/services/workflow/steps/jit_persona_tool_injection.py`
- Modify: `backend/app/services/orchestrator/config.py`
- Test: `backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py`

**Step 1: 实现 Step**
```python
# 读取 validation.request.assistant_id + conversation.session.assistant_id
# 只有两者都为空时才注入 consult_expert_network ToolDefinition
```

**Step 2: 注入到 workflow**
- 放在 `mcp_discovery` 后、`template_render` 前（保证 tools 可被 LLM 看到）

**Step 3: 运行测试确保通过**
Run: `pytest backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py -v`
Expected: PASS

---

### Task 5: used_persona_id 归因落库

**Files:**
- Modify: `backend/app/models/conversation.py`
- Modify: `backend/app/repositories/conversation_message_repository.py`
- Modify: `backend/app/services/workflow/steps/conversation_append.py`
- Create: `backend/migrations/versions/20260131_02_add_used_persona_id.py`
- Test: `backend/tests/unit/orchestrator/test_steps/test_conversation_append_persona_id.py`

**Step 1: 写失败测试（assistant 选择后写入 used_persona_id）**
```python
async def test_conversation_append_writes_used_persona_id(ctx_factory, async_session):
    ctx = ctx_factory(selected_assistant_id="uuid")
    step = ConversationAppendStep()
    await step.execute(ctx)
    # 断言插入消息携带 used_persona_id 字段
```

**Step 2: 实现字段与迁移**
- conversation_message 增加 `used_persona_id`（nullable, FK optional）

**Step 3: 在 conversation_append 填充字段**
- 从 ctx.get("assistant", "id") 或工具回写结果读取

**Step 4: 运行测试确保通过**
Run: `pytest backend/tests/unit/orchestrator/test_steps/test_conversation_append_persona_id.py -v`
Expected: PASS

---

### Task 6: 文档同步

**Files:**
- Modify: `backend/docs/design-jit-persona-routing.md`

**Step 1: 补充实现说明**
- 写明：manual 锁定时禁用 consult_expert_network 工具；used_persona_id 归因字段位置

---

### Task 7: 回归测试与提交

**Step 1: 运行核心测试**
Run: `pytest backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py backend/tests/services/assistant/test_assistant_retrieval_service.py backend/tests/unit/orchestrator/test_steps/test_conversation_append_persona_id.py -v`
Expected: PASS

**Step 2: 提交**
```bash
git add backend/app/agent_plugins/builtins/expert_network/plugin.py \
        backend/app/services/assistant/assistant_retrieval_service.py \
        backend/app/services/workflow/steps/jit_persona_tool_injection.py \
        backend/app/services/workflow/steps/conversation_append.py \
        backend/app/repositories/conversation_message_repository.py \
        backend/app/models/conversation.py \
        backend/migrations/versions/20260131_02_add_used_persona_id.py \
        backend/tests/unit/orchestrator/test_steps/test_jit_persona_tool_injection.py \
        backend/tests/services/assistant/test_assistant_retrieval_service.py \
        backend/tests/unit/orchestrator/test_steps/test_conversation_append_persona_id.py \
        backend/docs/design-jit-persona-routing.md \
        backend/app/core/plugins.yaml
git commit -m "feat: add jit persona runtime retrieval"
```
