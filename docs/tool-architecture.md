# Deeting 工具封装架构（Tool Surface · Capability Registry · Execution Routing）

> 适用范围：Deeting 当前系统里“模型能看到什么工具、这些工具如何被封装、如何被发现、如何执行、如何审批、如何和 skill / MCP / 本地执行拼起来”。
> 不覆盖：完整 agent DAG 恢复与挂起机制（见 [agent-dag-architecture.md](./agent-dag-architecture.md)）、RAG / context 编排（见 [rag-architecture.md](./rag-architecture.md)）、长期记忆（见 [memory-architecture.md](./memory-architecture.md)）、Direct / Worker 双 plane 与工具 allowlist 切换（见 [dual-plane-architecture.md](./dual-plane-architecture.md)）。

这篇文档不是讲“工具调用”这个抽象概念，而是回答一个更实际的问题：Deeting 现在到底把哪些东西当成工具、它们分别封装在哪一层、模型最终又是通过什么边界调用它们的。复盘代码、理解架构、或者准备新增能力——这里比直接 grep `tool_call` 更省时间。

## 1. TL;DR

Deeting 当前的工具面是 **5 层叠加**：

```text
┌─────────────────────────────────────────────────────────┐
│  第 1 层 · 模型可见工具面（tool_catalog.rs）            │
│  - 按 allowlist 过滤后渲染 provider-safe tools[] 数组   │
│  - core / lane aux / dynamic direct 三段拼装            │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  第 2 层 · 静态核心工具（~49 个，Rust 内建）            │
│  - 按 §5 分 9 大类：元工具 / skill 生命周期 /          │
│    context 检索 / 终端 / 沙箱执行 / 委托 /             │
│    文档生成 / 监控 / 浏览器                            │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  第 3 层 · 动态工具面（开放集）                         │
│  - MCP tools / Skill actions / 官方 desktop capability  │
│  - 通过 capability snapshot 注入                        │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  第 4 层 · capability registry / search_sdk             │
│  - 不是 tools[] 数组，是“能力总表”+ 排序候选           │
│  - 含 recipes / orchestration primitives /              │
│    delegation targets / local assistants                │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  第 5 层 · 统一执行层（tool_execution.rs）              │
│  - 把 core / skill / MCP / shell / sandbox 收拢到       │
│    同一套 policy + approval + risk + audit              │
└─────────────────────────────────────────────────────────┘
```

**4 种工具来源 + 2 种非业务工具**：

1. **Core tools** — Rust runtime 直接暴露，~49 个，[`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) 定义合同。
2. **Dynamic direct capability tools** — 从 capability registry 长出来、提升为顶层 function tool 的能力（MCP / Skill action / 官方 desktop capability）。
3. **Skill tools** — 由 `SKILL.md + deeting.json + llm-tool.yaml + main.py` 打包的可安装能力包；一个 skill package 可导出多个 callable tool。
4. **MCP / remote tools** — 通过 stdio / SSE / 远程 MCP server 接入的外部能力。

非业务工具但运行时关键的两类：

- **Orchestration primitives**：`search_sdk` / `get_tool_schema` / `attach_capability` / `detach_capability` / `diting_think` / `query_task_policy` ——能力控制面，不是知识型 capability。
- **Execution backends**：`shell_execute` / `execute_code_plan` / `run_local_code_snippet` —— 高副作用执行宿主。

## 2. 为什么要分这么多层

如果只做简单聊天助手，工具就是一组固定 JSON schema。但 Deeting 同时要满足：

- **provider-safe**：OpenAI 兼容 provider 对工具名严格（必须 `^[a-zA-Z0-9_-]+$` 且不能太长）；`monitor.create` 这样的名字必须被 alias，否则被 provider 拒收。
- **动态可见**：用户已安装 / 启用的 skill 和 MCP server 必须能动态进入工具面，不能静态写死。
- **可发现 vs 可直接调用**：不是每个 registry entry 都要直接暴露成 function tool。重型能力先走 `search_sdk` 发现，再 `attach_capability` 或 `delegate_task`。
- **统一审批边界**：浏览器写操作 / stdio MCP / local skill host / shell —— 最终都要过同一层 Approval Gate。
- **可解释来源**：UI 卡片要能告诉用户“这个工具来自 core / skill / MCP / assistant”。
- **plane 隔离**：Direct plane（一把梭）只能看到 resident allowlist；Worker plane 才能见到完整工具面，且工具集与 prior / bandit 学习目标对齐。

所以现在的工具系统在回答**三个独立问题**：

1. 模型这一轮能调什么 → 第 1+2 层
2. 系统总共知道什么能力 → 第 3+4 层
3. 实际执行时走什么 route、走什么审批 → 第 5 层

## 3. 第一层：模型可见工具面（tool_catalog）

入口：[`deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs)。

### 3.1 拼装三段式

```rust
build_local_runtime_tools_with_allowlist(allowed_tool_names, capability_snapshot)
  │
  ├─ build_core_tool_function_entries()
  │   └─ 来源：code_mode/core_tool_contracts.rs::build_core_tool_function_entries
  │      返回 ~45 个静态 contract 条目
  │
  ├─ build_local_execution_lane_aux_tools()
  │   └─ attach_capability / detach_capability 等请求级控制工具
  │
  └─ build_dynamic_direct_capability_tools(capability_snapshot)
      └─ 从 search_sdk 返回的 snapshot 里筛
         invocation_mode == "direct" && status.callable == true 的条目
         → 提升为顶层 function tool
```

之后由 `policy.effective_allowed_tool_names(snapshot)` 过滤，只保留 allowlist 命中的工具。

### 3.2 Allowlist 双档（与 dual plane 联动）

[`crates/mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) 定义两个常量集合：

| 集合 | 用在 | 包含 |
|---|---|---|
| `resident_capability_control_tool_names()` | **Direct plane**（`ResponseOnly`） | `search_sdk`, `activate_skill`, `read_skill_resource`, `terminal_context_peek/read/pack`, `context_search/open/expand/summarize_evidence` |
| `full_execution_tool_names()` | **Worker plane**（`WorkerReasoning`） | resident 集合 + `diting_think`（仅首轮）/ `delegate_task` / `execute_code_plan` / `run_local_code_snippet` / `attach_capability` / `detach_capability` / `query_task_policy` / `sys_submit_onboarding_request` / `refresh_skill_index` / `monitor.*` / 全部 `browser_*` / 全部文档生成工具 |

**关键不变式**：Direct 模式下 `delegate_task` 等"会派生子任务"的工具**根本不在 tools[] 数组里**——靠 policy 物理约束，不靠 prompt 约束。详见 [dual-plane-architecture.md §6.1](./dual-plane-architecture.md#61-工具面最关键的差异)。

### 3.3 Alias 机制（provider-safe 命名）

来源：`tool_catalog.rs::dynamic_capability_alias` + `provider_safe_tool_name_for_callable` + `alias_tool_definition_for_provider` + `resolve_provider_tool_name_for_execution`。

```text
Canonical name          含点/斜杠/不安全字符
   │
   ▼
dynamic_capability_alias(name) = "cap_" + sanitized + "_" + hex_hash(name)[:8]
   │
   ▼
Provider 看到的名字     例：monitor.create → cap_monitorcreate_a1b2c3d4
                            
模型 emit tool_call("cap_monitorcreate_a1b2c3d4")
   │
   ▼
resolve_provider_tool_name_for_execution(emit_name) → 反查回 canonical "monitor.create"
   │
   ▼
按 canonical 在 dispatcher 大 match 里分派
```

**为什么不直接改 canonical**：canonical name 是跨进程 / 跨 Python 实现 / 跨持久化的稳定标识；只在 provider 边界做 alias，不污染其他地方。

## 4. 第二层：静态核心工具完整清单（~49 个）

合同来源：[`code_mode/core_tool_contracts.rs::build_core_tool_function_entries`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs)。分派：[`chat_tool_runtime/mod.rs::process_chat_tool_calls`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) 的大 match。

### 4.1 元工具 · 能力发现与控制（6 个）

| 工具 | 文件 | 作用 | allowlist |
|---|---|---|---|
| `search_sdk` | `core_tool_contracts.rs` | 语义检索本地能力面（直接能力 / skill / recipe / orchestration primitive）；返回 capability snapshot 注入到下一轮 | resident + full |
| `get_tool_schema` | `core_tool_contracts.rs` | 拉取指定工具的完整 schema / 示例 / 风险等级 | full |
| `query_task_policy` | `core_tool_contracts.rs` | 只读查询某决策点的 task_learning 先验（route / discovery / capability_attach / execution / verification）| full |
| `attach_capability` | `tool_catalog.rs::build_local_execution_lane_aux_tools` | 请求级挂载某个专家能力到当前 agent loop | full |
| `detach_capability` | 同上 | 卸载已挂载的专家能力，回到中性上下文 | full |
| `diting_think` | `core_tool_contracts.rs` + `chat_tool_runtime/mod.rs::inject_diting_think_tool` | 结构化深度推理闸；**只在第 1 轮可见**，被消费后从 tools[] 永久移除（见 §10） | full（仅 round 1） |

### 4.2 Skill 生命周期（4 个）

| 工具 | 作用 |
|---|---|
| `activate_skill` | 激活已安装 skill 包；加载完整 `SKILL.md` + 资源索引到 `state.active_skill_context` |
| `read_skill_resource` | 读取已激活 skill 内部的文本资源（references / templates / scripts）|
| `refresh_skill_index` | 重扫本地 skill 目录、重建注册表（外部装新 skill 后让 runtime 看见）|
| `sys_submit_onboarding_request` | 模型可创建本地资产：`asset_type='skill' / 'assistant' / 'custom_task_agent'`；**HIGH 风险，走 Approval Gate** |

### 4.3 本地上下文检索（4 个 · Context Orchestrator）

定义在 [`desktop_runtime/context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs)，schema 由 `core_tool_contracts.rs::context_*_contract` 导出。

**Memory / LLM Wiki / Knowledge 只通过这 4 个工具进入模型**，没有独立的 `memory_*` / `wiki_*` / `knowledge_*` 工具。

| 工具 | 作用 |
|---|---|
| `context_search` | 跨源检索（auto / memory / llm_wiki / knowledge），返回 evidence envelope |
| `context_open` | 按 id 打开单条命中（knowledge id 形如 `file_id:chunk_index`）|
| `context_expand` | 知识 chunk 邻域扩展 |
| `context_summarize_evidence` | 保留 source_refs 的确定性压缩 |

详见 [rag-architecture.md](./rag-architecture.md)。

### 4.4 终端上下文（4 个）

定义在 [`chat_tool_runtime/terminal_context.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/terminal_context.rs)。**只读 + 受限输入**——不能直接执行命令。

| 工具 | 作用 |
|---|---|
| `terminal_context_peek` | 终端会话 / 命令 / cwd / 选区的轻量索引 |
| `terminal_context_read` | 按 byte 预算读取命令输出 / 选区 / 指定 target |
| `terminal_context_pack` | goal-driven 打包最相关的命令输出 |
| `terminal_write_input` | 写入嵌入式终端 stdin —— **物理拒绝换行符**（无法真正执行命令）|

### 4.5 沙箱与代码执行（3 个 · Execution Backends）

| 工具 | 文件 | 作用 | 审批 |
|---|---|---|---|
| `execute_code_plan` | `core_tool_contracts.rs` + `chat_tool_runtime/mod.rs::execute_code_plan` | 沙箱里跑受限 Python codemode 脚本；runtime 暴露 `deeting.log/section/call_tool` 与 SDK stubs；过 `DecisionLocus::Execution` policy gate | full + 风险评估 |
| `run_local_code_snippet` | `core_tool_contracts.rs` + `app_state.sandbox.manager.run_local_code_snippet_with_prepare_config` | BoxLite 沙箱跑单段代码（python / go / rust / java）| full + 风险评估 |
| `shell_execute` | [`execution/core_tool.rs::ShellExecuteCoreTool`](../deeting/src-tauri/src/modules/execution/core_tool.rs) | 后台 host runtime 跑命令（process / shell / script 三种模式）；自动解析终端编码 | **HIGH 风险 / 硬性 Approval** |

### 4.6 委托（1 个）

| 工具 | 文件 | 作用 |
|---|---|---|
| `delegate_task` | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` | 把子任务委派给 Custom Task Agent；子 agent 跑自己的 agentic loop，结果以规范化 `delegated_result` envelope 回流 |

详见 [dual-plane-architecture.md §7](./dual-plane-architecture.md#7-worker-plane-详解)。

### 4.7 文档生成（4 个）

定义在 [`generated_files/`](../deeting/src-tauri/src/modules/generated_files/)。

| 工具 | 作用 |
|---|---|
| `write_docx` | 生成 / 重写 DOCX，section / paragraph / bullet / table |
| `write_pptx` | 生成 / 重写 PPTX，cover / two-column / 等模板 |
| `inspect_generated_artifact` | 读 artifact 元数据 + 可编辑 outline |
| `patch_generated_artifact` | 结构化打补丁（`replace_section` / `append_slide` / `replace_slide_title` …）|

### 4.8 监控任务（2 个）

| 工具 | 作用 |
|---|---|
| `monitor.create` | 创建 cron-driven 监控任务（**HIGH 风险**，含 `.` 字符必经 alias 为 `cap_*`）|
| `monitor.list` | 列出现有监控任务，支持分页 / 状态过滤 |

### 4.9 浏览器执行面（29 个 `browser_*`）

通过本地 Chrome 扩展（[`packages/deeting_chrome/`](../packages/deeting_chrome/)）经 localhost WebSocket bridge 执行；具体动作 handler 在 [`content/execute.ts`](../packages/deeting_chrome/src/content/execute.ts) 与 `background/router.ts`。

**桥与发现（5）**：`browser_agent_status`, `browser_open_tab`, `browser_get_page_snapshot`, `browser_get_active_page`, `browser_tabs`

**导航 / 等待 / 滚动 / 截图 / 查找（11）**：`browser_navigate_tab`, `browser_wait`, `browser_wait_for_element`, `browser_wait_for_navigation`, `browser_scroll`, `browser_scroll_into_view`, `browser_region_screenshot`, `browser_full_page_screenshot`, `browser_find_element`, `browser_extract`, `browser_highlight`

**交互（8）**：`browser_click`, `browser_type`, `browser_fill`★, `browser_key`★, `browser_select`★, `browser_upload_file`★, `browser_dialog`★, `browser_retry_with_relocate`

**检查 / DevTools（7）**：`browser_console_log`, `browser_network_log`, `browser_storage_read`, `browser_storage_write`★★, `browser_eval`★★, `browser_downloads`, `browser_accessibility_audit`

> ★ = 触发硬性 Approval；★★ = 任意 JS 或写持久化，必经审批。

## 5. 第三层：动态工具面（开放集）

非编译期固定。每次调用 `search_sdk` 后，runtime 会把返回的 `capability_snapshot` 缓存到 `state.last_capability_snapshot`，下一轮通过 `build_dynamic_direct_capability_tools` 注入。

### 5.1 MCP server tools

用户连接的每个 MCP server（stdio / SSE / 远程）的 callable tool，按 `invocation_mode == "direct" && status.callable == true` 过滤后提升为顶层 function tool。命名 / 资源 / 持久化由 [`mcp/store/tool_registry.rs`](../deeting/src-tauri/src/modules/mcp/store/tool_registry.rs) 管理；调用解析 [`mcp/commands/runtime/tool_resolution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_resolution.rs)。

含 `./:` 等不安全字符的名字一律走 `dynamic_capability_alias()` → `cap_*`。

### 5.2 Skill actions

已安装 skill 包里的 callable action，按 action 的 `callable_name` 暴露。绑定解析 `resolve_skill_binding_by_ref(...)`。

### 5.3 官方 desktop capability（白名单）

[`desktop_runtime/desktop_capabilities.rs::OFFICIAL_SKILL_CAPABILITIES`](../deeting/src-tauri/src/modules/desktop_runtime/desktop_capabilities.rs)——**仅官方 skill 激活时**对模型可见的桌面能力（12 个）：

```
skill_registry.refresh    skill_registry.diagnostics
monitor.create            monitor.list
provider_preset.list      provider_preset.upsert
provider.verify           provider.template.verify
web.fetch                 assistant.onboarding.submit
cloud.provider_preset.list   ← admin-only
cloud.provider_preset.upsert ← admin-only
```

`cloud.*` 受 `ensure_desktop_admin_role` 二次校验。

### 5.4 Custom Task Agent 内部专属

只在被 `delegate_task` 派生的子 agent 内可见（不在主 assistant 工具面）：

- `llm_wiki_search_corpus`（[`custom_task_agents/runtime.rs`](../deeting/src-tauri/src/modules/custom_task_agents/runtime.rs)）——仅 LLM Wiki maintainer agent
- `diting_think`——子 agent 第 0 轮 reasoning 闸
- 子 profile 自己绑定的 `callable_mcp_tool_ids` + `callable_skill_action_refs`

绑定构造：[`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)。

## 6. 第四层：Capability Registry · search_sdk 控制平面

如果说 `tool_catalog.rs` 决定“这一轮模型能看什么”，那么 capability 总表的中心是 [`capability_discovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs)。

### 6.1 它返回的不是 tools[]

`search_sdk` 返回的 `CapabilitySearchResult` 是**能力控制平面 snapshot**：

```text
CapabilitySearchResult {
    callable_capabilities: [...]      // MCP / skill action，含 status, risk, last_used
    recipes: [...]                    // 多步推荐组合（攻略式）
    orchestration_primitives: [...]   // attach / detach / search / delegate 等元能力
    delegation_targets: [...]         // custom task agent profiles
    local_assistants: [...]           // 安装的 assistant 包
    score_explanations: { ... }       // 各候选的相关性 + 反馈得分
}
```

关键函数：
- `build_capability_search_result(...)`
- `build_local_sdk_search_result_bundle_with_feedback_runtime(...)`

### 6.2 排序而不是清单

`capability_discovery.rs` 内部融合多路检索：

- **Lexical**：关键词匹配
- **Structured**：tag / capability-class / risk-tag 过滤
- **Semantic**：query embedding × capability embedding
- **Reciprocal Rank Fusion (RRF)**：把三路 ranking 融合
- **Feedback affinity**：过去用户接受率 / 拒绝率加权
- **Query profile inference**：根据 query 形态推断意图

所以同一个 capability 在不同 query 下排序不同——这是“能力推荐”，不是“能力清单”。

### 6.3 为什么不是所有 capability 都直接暴露

如果把所有 capability 都直接做成 function tool：

- provider tools[] 会爆炸（很多模型限 128 个工具）
- 模型在工具面太广时选择质量下降（实验级 fact）
- 高副作用工具会被冲动调用

所以**重型 / 长尾能力先进 registry，模型主动 `search_sdk` 才能见到**——这是工程纪律。直接暴露门槛是 `invocation_mode == "direct"`。

## 7. 第五层：Skill 封装规范（docs-first + callable contract）

### 7.1 一个标准 skill package 的文件结构

参考 [`packages/README.md`](../packages/README.md) 与 [`packages/official-skills/crawler/`](../packages/official-skills/crawler/)：

```text
my-skill/
├── SKILL.md             # 人/模型可读的能力说明文档（不是 callable schema）
├── deeting.json         # 运行时与打包元信息：id、version、entry、依赖、ui
├── llm-tool.yaml        # host 可注册的工具合同（callable schema）—— 真正的工具定义
├── main.py              # 真执行体（Python host）
├── ui/                  # 可选：自定义前端面板
└── references/          # 可选：补充资料、prompt 模板、脚本
```

**4 个文件各自的角色**：

| 文件 | 干什么 | 不干什么 |
|---|---|---|
| `SKILL.md` | 文档 / 上下文注入 / activate_skill 时给模型 | 不是 callable schema |
| `deeting.json` | 包元信息、runtime 配置 | 不定义工具 |
| `llm-tool.yaml` | callable tool schema（host 注册的合同）| 不是执行体 |
| `main.py` | 真执行体 | 不暴露 schema |

### 7.2 一个 skill 可以导出多个 tool

`llm-tool.yaml` 是 list 结构。例如 [`packages/official-skills/crawler/llm-tool.yaml`](../packages/official-skills/crawler/llm-tool.yaml) 导出 `fetch_web_content` + `crawl_website` 两个工具。**skill package ≠ tool name**。

### 7.3 skill registry 干的事

[`skills/registry_impl.rs`](../deeting/src-tauri/src/modules/skills/registry_impl.rs) 负责把磁盘 bundle 变成运行时能力：

- 规范化 skill id（处理大小写、命名冲突）
- 识别已安装的本地 skill
- 解析 manifest 与 runtime 配置
- 处理冲突迁移（旧版本 → 新版本）
- 把安装状态写进本地 store + capability registry

## 8. 第六层：统一执行层（tool_execution.rs）

[`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs) 把所有可执行的工具源头**拉到同一条 dispatch + policy + approval 流水线**。

### 8.1 统一 dispatch 入口

无论是 stdio MCP / SSE MCP / local skill / shell：

| 来源 | 分派函数 |
|---|---|
| stdio MCP server | `call_local_stdio_tool(...)` |
| remote SSE MCP server | `call_remote_sse_tool(...)` |
| local skill runtime | `execute_local_mcp_tool(...)` / `execute_skill_binding(...)` |
| `shell_execute` | `ShellExecuteCoreTool::execute(...)` |
| 通用包装入口 | `execute_or_queue_mcp_tool_call_with_tool_ref(...)` |

### 8.2 绑定解析

- `resolve_skill_binding_by_ref(...)`：从工具 ref 反查到 skill / MCP 实例
- `resolve_local_tool_env(...)`：解析工具运行所需环境变量、二进制路径、host

### 8.3 Policy + Approval + Risk（统一边界）

无论来源，统一过：

| 函数 | 干什么 |
|---|---|
| `assess_policy_risk(...)` | 给一次调用打 `risk_level` + `risk_reasons` |
| `resolve_approval_decision(...)` | 输出 `ApprovalDecision::{Allow, Deny, RequireApproval}` |
| `ApprovalPolicyLevel` | rule-set + per-binding override + per-session grant 综合 |
| `persist_pending_approval(...)` | `RequireApproval` 时落 SQLite，挂起 chat_tool_runtime |
| `SessionApprovalGrant` | 用户"本次会话内一律允许" → 短期绕过审批 |

`tool_result.status == "REQUIRES_APPROVAL"` 是统一信号 —— chat_tool_runtime 收到后挂起主循环，详见 [agent-dag-architecture.md](./agent-dag-architecture.md) 与 [security-architecture.md](./security-architecture.md)。

### 8.4 风险分级（节选）

| 风险 | 例子 |
|---|---|
| **LOW**（默认 Allow） | `terminal_context_*`, `context_*`, `search_sdk`, `browser_*` 读类 |
| **MEDIUM**（rule 决定） | 大多数 MCP read tools, `browser_extract`, `browser_click`, `write_docx` |
| **HIGH**（默认 RequireApproval） | `shell_execute`, `browser_storage_write`, `browser_eval`(写), `browser_dialog`, `delegate_task`, `monitor.create`, `sys_submit_onboarding_request`, 所有 mutating MCP tools |

## 9. 第七层：前端 capability 视角

前端**不绑定**裸 `tools[]` JSON，而是绑定 capability / server / source / binding / settings 实体：

```text
deeting/components/mcp/*             ← MCP 管理面板
deeting/lib/api/mcp*.ts              ← MCP API 客户端
deeting/lib/api/skills.ts            ← skill 安装 / 列表 / 更新
deeting/lib/ai/capability-settings.ts ← per-capability 配置（开关 / 风险覆盖 / 默认参数）
deeting/store/capability-settings-store.ts ← 客户端状态
```

UI 卡片上看到的“工具名 / 来源标签 / 风险等级 / 上次使用时间”都是从这些实体投影出来的，不是从 `tools[]` 实时反推。

## 10. `diting_think` round-1 reasoning gate

**唯一的"动态消失"工具**，单独说一下：

- **注入点**：[`chat_tool_runtime/mod.rs::inject_diting_think_tool`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
  - 仅 `round == 1 && !state.diting_think_consumed` 时追加到 `tools[]`
- **消费点**：dispatcher 命中 `tool_name == DITING_THINK_TOOL_NAME` 时：
  - 调 `format_diting_think_reasoning(arguments)` 渲染 `[意图] / [上下文] / [执行计划] / [约束]` 四段
  - 存到 `state.captured_reasoning`
  - 置 `state.diting_think_consumed = true`
- **作用**：在工具面广（Worker plane）时强制模型先做结构化梳理，避免一上来盲调 `delegate_task` / `execute_code_plan`

## 11. 一条真实调用链（端到端）

```text
① user request
    ↓
② 8-step orchestration pipeline 跑完（含 RouteSelectionStep）
    → execution_policy 决定 Direct / Worker plane
    → 决定 allowlist（resident vs full）
    ↓
③ tool_catalog.build_local_runtime_tools_with_allowlist
    = core[allowed]  +  lane_aux[allowed]  +  dynamic[allowed]
    → 走 dynamic_capability_alias 处理含特殊字符的名字
    → 渲染成 provider-safe tools[] 数组
    ↓
④ agentic loop round 1
    可能加上 diting_think（仅首轮）
    ↓
⑤ provider 返回 tool_calls
    ↓
⑥ resolve_provider_tool_name_for_execution
    把 cap_* 别名反查回 canonical
    ↓
⑦ dispatcher 大 match 分派：
    - core tool？→ 内建函数
    - context_*？→ context_orchestrator/tools.rs
    - terminal_context_*？→ chat_tool_runtime/terminal_context.rs
    - delegate_task？→ execute_delegate_task_tool
    - shell_execute / 沙箱？→ ShellExecuteCoreTool / sandbox manager
    - 其它 → execute_or_queue_mcp_tool_call_with_tool_ref
    ↓
⑧ tool_execution.rs：
    - assess_policy_risk → 打风险
    - resolve_approval_decision → Allow / Deny / RequireApproval
    - 若 RequireApproval → persist_pending_approval + 挂起 loop
    - 若 Allow → 走具体后端：stdio MCP / SSE MCP / skill host / shell / sandbox / browser bridge
    ↓
⑨ 结果回流：
    - tool_result envelope（含 status / source_refs / risk meta）
    - 写入 execution_graph runtime context
    - 进入下一轮 chat completion 的 messages
    ↓
⑩ evaluator + bandit feedback（见 self-evolution / bandit 架构文档）
```

**最容易搞混的 3 点**：

1. `search_sdk` 是工具，但它的返回**不等于立刻执行**——只是把 capability snapshot 注入 state，下一轮才决定 attach / delegate / 直接调用。
2. skill package 和 tool name **不是 1:1**，一个 skill 可导出多个 callable tool。
3. 模型看到的 provider-safe 名字（`cap_*`）**不一定是**执行层的 canonical name（`monitor.create`），别在持久化层用 alias。

## 12. 新增一种工具时，应该落在哪一层

| 想加什么 | 该落哪一层 | 关键约束 |
|---|---|---|
| 系统内建、稳定、需要强宿主控制 | **Core tool**（`core_tool_contracts.rs` + dispatcher 加 match）| 同步加 schema、风险等级；通过 dual-plane allowlist 决定是 resident 还是 full |
| 可安装 / 可发布 / 可复用的功能包 | **Skill package**（`SKILL.md + deeting.json + llm-tool.yaml + main.py`）| 一个包可多个工具；llm-tool.yaml 是合同源 |
| 外部系统或独立服务宿主 | **MCP tool**（stdio / SSE / 远程）| 走 MCP server；动态注入到 tools[] |
| 先发现再调用的重型 / 长尾能力 | **Capability registry** | 不直接进 tools[]；通过 `search_sdk` 暴露 |
| 请求级 / 一次性的元能力 | **Lane aux tool**（`build_local_execution_lane_aux_tools`）| 不持久化、只挂当前 loop |
| 桌面 host 平台能力 | **官方 desktop capability**（`OFFICIAL_SKILL_CAPABILITIES` 白名单）| 仅官方 skill 可见；admin-only 二次校验 |

**决策树**：

```text
新能力？
├── 高副作用 + 平台核心 → Core tool
├── 用户能装 / 卸 / 升级 → Skill package
├── 外部服务 / 跨进程 → MCP tool
├── 重型 / 长尾 / 不该立刻可见 → Capability registry only
└── 只对当前对话有效 → Lane aux tool
```

## 13. 反模式（PR review 拒绝）

| 反模式 | 为什么不行 |
|---|---|
| 给 Direct plane allowlist 加 `delegate_task` / `execute_code_plan` | 破坏双 plane 工具面隔离；prior 学习目标失效（见 [dual-plane-architecture §12](./dual-plane-architecture.md#12-反模式pr-review-拒绝)）|
| 让 `diting_think` 在 round > 1 仍可见 | 它是 round-1 reasoning gate，反复出现会让模型陷入元推理循环 |
| 用 `dynamic_capability_alias` 后的 `cap_*` 名字做持久化 | alias 是 provider 边界临时映射；hash 会随 sanitize 规则变化 |
| 把 capability 直接绑定到 `tools[]` 而不进 registry | 工具面爆炸；丢失 search_sdk 排序信号 |
| 让 `tool_result` 跳过 `assess_policy_risk` 直返 | 统一审批边界被破坏；UI 渲染不出 risk 标签 |
| skill 在 `main.py` 里反向调用 host 内部 API（绕过 llm-tool.yaml）| 失去合同约束；审批 / 风险 / 路由都拿不到正确元信息 |
| 给 MCP server 注册名字含 `.`/`/` 不走 alias | provider 会拒收；只在调用前 alias 也行，但不能跳过 |
| 在 Direct plane 临时把 `allowed_tool_names` 用 union 扩展 | policy 是受 prior 学习的，临时扩展会污染下一次学习 |
| 把 `shell_execute` 改成默认 Allow 风险 | 任何 shell 都必须经过 Approval Gate；这是 security charter 红线 |

## 14. 验证清单

改动工具系统的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib tool_catalog --no-fail-fast`
- [ ] `cargo test --lib core_tool_contracts --no-fail-fast`
- [ ] `cargo test --lib tool_execution --no-fail-fast`
- [ ] `cargo test --lib capability_discovery --no-fail-fast`
- [ ] `cargo test --lib mcp_runtime::policy --no-fail-fast`
- [ ] 关键不变式仍然绿：
  - Direct plane allowlist **不**含 `delegate_task` / `execute_code_plan` / `attach_capability` / `monitor.*`
  - `diting_think` 在 round > 1 不出现
  - 所有含 `./:` 的 canonical name 通过 alias 渲染为 `cap_*`
  - `shell_execute` / `browser_eval`(写) / `browser_storage_write` 默认 `RequireApproval`
- [ ] 桌面端手测：
  - 装一个新 skill → `refresh_skill_index` → 模型 `search_sdk` 能看见
  - Direct 模式下让模型尝试调 `delegate_task` → provider 应直接拒绝（不在 tools[]）
  - 高风险工具 → UI 弹审批卡 → 用户拒绝 → tool_result.status = `denied`
  - alias 工具被调用 → `resolve_provider_tool_name_for_execution` 正确反查

## 15. 最值得读的文件

| 主题 | 文件 |
|---|---|
| 模型可见工具拼装 | [`chat_tool_runtime/tool_catalog.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) |
| 静态工具合同（~49 个） | [`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) |
| Allowlist 双档定义 | [`crates/mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) |
| Dispatcher 大 match | [`chat_tool_runtime/mod.rs::process_chat_tool_calls`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| 上下文工具 | [`context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) |
| 终端工具 | [`chat_tool_runtime/terminal_context.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/terminal_context.rs) |
| Shell 执行后端 | [`execution/core_tool.rs`](../deeting/src-tauri/src/modules/execution/core_tool.rs) |
| 委托执行 | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` + [`custom_task_agents/bound_callables.rs`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs) |
| Capability registry | [`capability_discovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs) |
| Skill 注册表 | [`skills/registry_impl.rs`](../deeting/src-tauri/src/modules/skills/registry_impl.rs) |
| Skill 包格式 | [`packages/README.md`](../packages/README.md) + [`packages/official-skills/crawler/llm-tool.yaml`](../packages/official-skills/crawler/llm-tool.yaml) |
| 桌面平台能力白名单 | [`desktop_runtime/desktop_capabilities.rs`](../deeting/src-tauri/src/modules/desktop_runtime/desktop_capabilities.rs) |
| 统一执行 + Policy + Approval | [`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs) |
| MCP server 注册 | [`mcp/store/tool_registry.rs`](../deeting/src-tauri/src/modules/mcp/store/tool_registry.rs) |
| 浏览器执行面 | [`packages/deeting_chrome/src/content/execute.ts`](../packages/deeting_chrome/src/content/execute.ts) |
| 兄弟文档 | [`dual-plane-architecture.md`](./dual-plane-architecture.md)、[`agent-dag-architecture.md`](./agent-dag-architecture.md)、[`rag-architecture.md`](./rag-architecture.md)、[`memory-architecture.md`](./memory-architecture.md)、[`bandit-architecture.md`](./bandit-architecture.md)、[`security-architecture.md`](./security-architecture.md)、[`self-evolution-architecture.md`](./self-evolution-architecture.md) |

## 16. 一句话结论

Deeting 的“工具系统”不是一份静态 tool list，而是分层结构：**`tool_catalog` 决定模型这轮能调什么（按 plane allowlist 过滤）、`core_tool_contracts` 给出 ~49 个静态合同、`capability_discovery` 让重型 / 长尾能力先被发现再被调用、动态层让 MCP 和 Skill 即装即用、`tool_execution` 把所有来源拉到同一套 policy + approval + risk 边界**。Skill / MCP / shell / 浏览器只是不同来源和执行宿主——它们共享同一条审批 + 同一份 tool trace + 同一套持久化。
