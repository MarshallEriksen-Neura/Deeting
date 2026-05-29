# Deeting 双 Plane 执行架构（已废弃）

> ⚠️ **本文档描述的是旧版架构，已被 Composition-based 执行策略取代。**
>
> 当前执行模型使用 `ExecutionStrategy`（DirectIteration / DelegatedWorkflow / DelegatedAgent / Hybrid）
> 配合 `PhaseStepType`（DirectChat / ToolCall / DelegatedWorker / DelegatedWorkflow / CapabilityAdmit / VerifyFinal）。
>
> 请参考 [architecture-overview.md](./architecture-overview.md) 中的 §4.3 执行策略 章节。

---

# Deeting 双 Plane 执行架构（Direct vs Worker）【历史归档】

> 适用范围：桌面端本地对话（local chat）的"语义感知路由"——一句话进来，到底是**直接调工具开干**还是**走编排 / 委派**，是怎么决定的，决定完之后又跑什么样的流水线。
> 不覆盖：DAG 执行图与可恢复运行时（见 [agent-dag-architecture.md](./agent-dag-architecture.md)）、prior 半衰减与 6 个决策点（见 [self-evolution-architecture.md](./self-evolution-architecture.md)）、上下文 manifest 与 `context_*` 工具（见 [rag-architecture.md](./rag-architecture.md)）、bandit 三策略与三场景（见 [bandit-architecture.md](./bandit-architecture.md)）。

本文档面向想读懂"Deeting 怎么在'简单任务一把梭'和'复杂任务先编排再执行'两种模式之间切换"的人。我们从动机讲起，拆开 route 决策的所有输入（base router / override / prior / bandit），介绍**两个 plane 共用的 8 步编排流水线**，再分别解构 Direct 与 Worker 的执行内核，最后讨论它们之间的边界、持久化、反馈回路。

## 1. TL;DR

Deeting 的本地聊天**只有两个执行 plane**，但它们共享同一条 8 步编排流水线：

```
                    用户输入
                      │
                      ▼
        ┌──────────────────────────────┐
        │ LocalOrchestrationEngine     │  ← 8 步流水线，两个 plane 都跑
        │ (build_desktop_local_chat_   │
        │  engine — 拓扑排序 + 并行层) │
        └──────────────────────────────┘
                      │  含 RouteSelectionStep
                      ▼
        ┌──────────────────────────────┐
        │ run_local_execution_plane    │  ← 在这里分叉
        │                              │
        │ ResponseOnly → Direct        │
        │ WorkerReasoning → Worker     │
        └──────────────────────────────┘
                 │           │
                 ▼           ▼
      Direct Handler    Worker Handler
       (一把梭)          (先委派/编排)
                 │           │
                 ▼           ▼
       chat_tool_runtime     ├── 自动委派 CustomTaskAgent
       agentic loop          ├── 或走 Workflow runtime
                             └── 完成后整合 delegated_result
                                  再跑一次 chat_tool_runtime
```

- **两个 plane** 在代码里有**两套名字**：业务侧叫 `LocalRouteKind::{Direct, Worker}`，runtime 侧叫 `LocalExecutionPlane::{ResponseOnly, WorkerReasoning}`。**1:1 映射**，但工具面（allowlist）不同。
- **Direct plane** 工具面被锁成"常驻能力控制 + 上下文检索 + 终端只读 + skill 激活"——模型**根本看不到** `delegate_task` / `execute_code_plan` / `attach_capability`。意图就是"一把梭、不分叉"。
- **Worker plane** 拿完整工具面 + `inject_execution_protocol = true` + `allow_worker_delegation = true`。意图就是"复杂任务允许编排、委派、长流程"。
- **路由决策**在 `RouteSelectionStep`（pipeline 第 5 步）里，由 4 路证据融合：base router 启发式 + 显式 task agent 提及 + 21 天半衰减 prior + bandit 抽样。所有"危险操作 / 用户显式锁定"的 reason 是**安全锁**——prior + bandit 加起来都不能翻盘。
- **两个 plane 共用同一条编排流水线**：8 步全跑。Direct 不是"跳过编排"，而是"编排完之后选 ResponseOnly handler"。

涉及的核心代码：

```
deeting/src-tauri/
├── crates/mcp-runtime/src/
│   ├── route.rs                                // LocalRouteKind / TaskProfile / 启发式
│   └── policy.rs                               // LocalExecutionPlane / build_local_execution_policy
└── src/modules/desktop_runtime/
    ├── local_orchestrator.rs                   // execute_local_orchestrated_chat 总入口
    ├── local_orchestrator/
    │   ├── workflow.rs                         // 8 步 engine + 7 个 Step
    │   └── retrieval.rs                        // ContextManifestStep
    └── runtime/
        ├── execution_plane.rs                  // run_local_execution_plane(Direct/Worker 分叉)
        ├── execution_plane/
        │   ├── direct_handler.rs               // ResponseOnly: 直接 agentic loop
        │   └── worker_handler.rs               // WorkerReasoning: 先委派再 loop
        ├── task_learning/policy.rs             // apply_route_prior + 安全锁
        ├── worker_dispatch.rs                  // select_custom_task_agent_candidate_with_bandit
        ├── control_plane.rs                    // maybe_override_route_with_custom_task_agent_*
        └── chat_tool_runtime/
            ├── mod.rs                          // continue_local_chat_complete_with_tools
            ├── tool_catalog.rs                 // build_local_runtime_tools_with_allowlist
            └── inflight.rs                     // 挂起/恢复
```

## 2. 为什么不一个 plane 全包？

最朴素的实现是：**所有任务都走 agentic loop，工具面统一，让模型自己决定调不调 `delegate_task`**。这有几个工程问题：

1. **模型决策不稳定**。同一类任务在不同上下文里，模型可能时而调用 `delegate_task`，时而原地处理。用户体验是"忽快忽慢"。
2. **工具面爆炸即危险**。如果 Direct 模式也能 `execute_code_plan` / `delegate_task`，则简短的"翻译这段文字"也可能触发 codemode 执行——这是不必要的攻击面。
3. **prior 学习失效**。我们想学"这类任务该用什么 plane"——但如果只有一个 plane、所有工具都暴露，那 prior 学的就只是"模型选了什么工具"，不是"用户希望系统怎么响应"。语义维度被打散了。
4. **审批语义不清**。Direct 一把梭的工具应该是低风险、立即可执行；Worker 的工具大量需要审批。把两者混在一起，UI 没法清晰呈现"这个对话目前在哪一档"。

所以 Deeting 把"模式"提到 plane 这一层，由**编排流水线显式决定**，而不是让模型自己路由。两个 plane 在外部命名、工具面、handler、prior 学习目标上都是**显式分裂**的：

| 朴素 single-plane | Deeting dual-plane |
|---|---|
| 全工具面 | Direct 走 resident 工具白名单（~9 个），Worker 走 full 工具面（~49 个 + MCP/Skill 动态集） |
| 模型自己决定路由 | `RouteSelectionStep` 显式打分，可解释、可审计 |
| prior 学不到 plane 维度 | task_learning 的 `route` 决策点专门学 plane 选择 |
| 审批语义模糊 | Direct 工具默认不需审批；Worker 工具有完整 Approval Gate 流 |
| 不可解释 | `route_decision.reasons` 数组列出每条触发理由，前端 / 评估器都能消费 |

## 3. 三层命名映射

代码里**同一件事有三套名字**，第一次读会迷惑：

| 业务概念 | route（`LocalRouteKind`） | plane（`LocalExecutionPlane`） | handler |
|---|---|---|---|
| Direct / 一把梭 | `Direct` | `ResponseOnly`（字符串 `"response_only"`） | [`direct_handler::run_direct_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs) |
| Worker / 先委派 | `Worker` | `WorkerReasoning`（字符串 `"worker_reasoning"`） | [`worker_handler::run_worker_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs) |

入口类型：

- [`mcp-runtime/src/route.rs`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs) — `LocalRouteKind`、`LocalRouteDecision { route, reasons, profile, evidence }`、`TaskProfile`、`RouteEvidence`
- [`mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) — `LocalExecutionPlane`、`LocalExecutionPolicy { route, plane, allowed_tool_names, inject_execution_protocol, allow_worker_delegation, prefer_workflow_runtime, capability_snapshot }`、`build_local_execution_policy(&decision) -> policy`

记忆口诀：**route 是"该往哪走"，plane 是"工具面长什么样"，handler 是"实际跑什么代码"**。

## 4. Route 决策完整链路

入口：[`RouteSelectionStep`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)（pipeline 第 5 步，依赖 `generated_artifact_context_injection`）。

执行顺序：

```text
RouteSelectionStep.execute()
  │
  ├─ ① build_task_fingerprint(query)                      → TaskFingerprint
  ├─ ② resolve_runtime_discovery_bundle(ctx, query)       → RuntimeDiscoveryBundle
  │                                                         (含 route_evidence / skill_recipes /
  │                                                          capability_snapshot)
  ├─ ③ select_local_route_with_evidence(query, evidence)  → base 决策（启发式）
  ├─ ④ maybe_override_route_with_custom_task_agent_*      → 显式 @task-agent / 单 callable 升级
  ├─ ⑤ Self_::consult(store, DecisionLocus::Route, ...)   → Advisory(TaskPolicyHint) prior
  ├─ ⑥ compute_route_bandit_scores(provider_store)        → Option<RouteBanditScores>
  ├─ ⑦ apply_route_prior(base, hint, bandit)              → 最终 decision + override_applied
  └─ ⑧ apply_desktop_execution_policy_overrides(
         store, build_local_execution_policy(&decision))  → 最终 LocalExecutionPolicy
```

最后通过 `ContextPatch::SetTaskFingerprint` / `SetRouteDecision` / `SetExecutionPolicy` 写回 workflow context，并 emit `runtime.route.selected` 状态。

### 4.1 Base router（启发式）

[`route.rs::select_local_route_with_evidence`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs):

```text
if profile.explicit_route 显式存在
    → 用显式值，reason = "explicit_route"

else if profile.destructive_intent
     || profile.approval_sensitive
     || evidence.any_mutating_capability
     || evidence.any_high_risk_capability
    → 强制 Direct
       reasons += ["destructive_intent" / "approval_sensitive" /
                   "mutating_capability" / "high_risk_capability"]

else if profile.wants_programmatic_logic
     && evidence.has_programmatic_executor
     && (!wants_analysis || has_batch_scope)
    → Worker
       reason = "programmatic_logic"

else if evidence.single_direct_callable
    → Direct, reason = "single_direct_callable"

else 启发式 fallback ladder
```

`TaskProfile::from_query` 解析的标志位：
- `wants_programmatic_logic` / `wants_analysis` / `has_batch_scope` / `wants_single_action` — 自然语言意图分类
- `destructive_intent` — 删除 / 覆盖 / 重置等关键词
- `approval_sensitive` — 涉及外部副作用
- `explicit_route` — 用户字面说"用 worker / direct"

### 4.2 Custom task agent override

[`control_plane.rs::maybe_override_route_with_custom_task_agent_query_vector`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs):

| 触发条件 | 行为 | reasons |
|---|---|---|
| 用户显式 `@<task-agent-id>` 提及 | 强制 `Worker` | `["explicit_task_agent", invocation_kind]` |
| base 决策是 `Direct` 且 reason 含 `"single_direct_callable"` | 升级为 `Worker` | `["custom_task_agent_override"]` 或 `["custom_task_agent_override", "image_agent"]` |

这两个 reason 都是**安全锁**（见 §4.4）。

### 4.3 Prior + bandit 融合公式

[`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs):

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0; // 21 天半衰减
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
const ROUTE_BANDIT_COEFF: f64       = 0.25;

direct_score = (1.0 if base == Direct else 0.0)
             + direct_prior_weight              // task_policy_priors 表，21 天半衰减
             + 0.25 * bandit_direct_score       // BANDIT_SCENE_TASK_ROUTE 抽样
worker_score = (1.0 if base == Worker else 0.0)
             + worker_prior_weight
             + 0.25 * bandit_worker_score
```

翻盘条件（4 个 AND）：

```text
!decision_has_safety_lock(base)
&& has_signal                                   // prior 或 bandit 至少一个有数据
&& preferred_route != base.route                // 真的要翻
&& |direct_score - worker_score| >= 0.35        // 差距足够大
```

**为什么 `ROUTE_BANDIT_COEFF = 0.25` 而 `ROUTE_OVERRIDE_THRESHOLD = 0.35`**：bandit 单独最大贡献 0.25（一边 1 一边 0），永远跨不过 0.35——也就是说**bandit 永远不能独自翻盘**，它只能配合 prior 翻盘。这是 [bandit-architecture.md §1](./bandit-architecture.md#1-tldr) 的核心不变式。

### 4.4 安全锁清单

[`task_learning/policy.rs::decision_has_safety_lock`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)：reasons 含以下任一即锁定，**prior + bandit 都不能翻**：

| reason | 来源 | 含义 |
|---|---|---|
| `explicit_route` | 用户字面指定 | 不许动 |
| `explicit_task_agent` | 用户 `@<task-agent>` | 不许动 |
| `destructive_intent` | NLP 检测出删除/覆盖关键词 | 必须 Direct 走审批 |
| `approval_sensitive` | 检测出敏感操作 | 必须 Direct |
| `mutating_capability` | 待执行能力包含写操作 | 必须 Direct |
| `high_risk_capability` | 命中 HIGH-risk 工具白名单 | 必须 Direct |

剩下的非锁定 reasons（如 `"programmatic_logic"` / `"single_direct_callable"` / `"fallback_worker"`）才**允许**被 prior 翻盘。

### 4.5 Desktop 层后处理

[`desktop_runtime::apply_desktop_execution_policy_overrides`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs)：读取 `workflow.route_worker_through_workflow` 桌面 config，可把 `policy.prefer_workflow_runtime` 置为 true——影响 worker handler 走 Workflow 引擎还是直接 CustomTaskAgent 预览（见 §7）。

## 5. 共享编排流水线（8 Step Engine）

[`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)。

**关键点**：**Direct 和 Worker 两个模式跑的是完全同一套流水线**——8 步全跑，路由决策只是其中一步的产物。不是"Direct 跳过编排"。

引擎本体是泛型 Kahn 拓扑排序执行器：`LocalOrchestrationEngine<C: StepResultContext>`，按 `depends_on` 排序成层（`execution_layers: Vec<Vec<String>>`），同一层若 context 支持 snapshot 则 `try_join_all` 并发跑，跑完 `validate_layer_results` 拒绝 `ContextPatch` 写冲突。

8 步依赖图：

```text
summary_injection
      │
      ▼
persona_prompt_injection
      │
      ▼
context_manifest                ← Context Orchestrator 入口
      │
      ▼
generated_artifact_context_injection
      │
      ▼
route_selection                 ← § 4 决定 route + policy
      │
      ▼
skill_recipe_injection
      │
      ▼
prompt_variant_selection        ← router:prompt bandit scene
      │
      ▼
template_render                 ← 汇总系统消息 + 渲染 prelude
```

| # | Step | 文件 | 干什么 |
|---|---|---|---|
| 1 | `SummaryInjectionStep` | `workflow.rs` | 历史会话摘要前置 `[SUMMARY]` |
| 2 | `PersonaPromptInjectionStep` | `workflow.rs` | 注入 `chat.persona_prompt` 桌面配置 |
| 3 | `ContextManifestStep` | `local_orchestrator/retrieval.rs` | 写 Context Manifest（memory 列表 / selected knowledge 概览 / `context_*` 工具广告），解析 query embedding。详见 [rag-architecture.md](./rag-architecture.md) |
| 4 | `GeneratedArtifactContextInjectionStep` | `workflow.rs` | 用户重新选中已生成 Office artifact 时注入 `## Active Generated Artifact` |
| 5 | **`RouteSelectionStep`** | `workflow.rs` | **§ 4 全过程**。写 `task_fingerprint` / `route_decision` / `execution_policy`，emit `runtime.route.selected` |
| 6 | `SkillRecipeInjectionStep` | `workflow.rs` | 提取 `$skill-mention` token，合并 `discovery.skill_recipes`，渲染 `## Installed Skills` 系统块并暗示下一步 `activate_skill(...)` |
| 7 | `PromptVariantSelectionStep` | `workflow.rs` | 通过 **`router:prompt` bandit scene** 在 `"detailed" / "concise"` 之间二选一，注入 `## Response Style` |
| 8 | `TemplateRenderStep` | `workflow.rs` | 调 `build_local_control_plane_result(...)` 拼最终 `LocalControlPlaneResult`（router prompt + prelude messages + `current_date / timezone / response_language`），prepend `prelude_messages` |

**ContextPatch 类型**（[`workflow.rs::ContextPatch`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)）：

- `PrependMessages` / `SetRuntimeDiscovery` / `SetRouteDecision` / `SetExecutionPolicy` / `SetControlPlaneResult` / `SetSelectedPromptVariant` / `SetTaskFingerprint` / `SetRequestQueryEmbedding` / `EmitStatus`

8 步跑完，`LocalWorkflowContext` 里已经有了：
- 渲染好的 `messages: Vec<LocalChatInputMessage>`
- 确定的 `route_decision: LocalRouteDecision`
- 完整的 `execution_policy: LocalExecutionPolicy`
- `selected_prompt_variant`（供反馈回填）
- `request_query_embedding`（agentic loop 内 `context_*` 工具会用）

下一步把它们打包成 `LocalExecutionRequest` 交给 `run_local_execution_plane`。

## 6. Direct Plane 详解

[`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) → `LocalExecutionHandlerKind::from_policy(&policy)` → `LocalExecutionPlane::ResponseOnly` → `direct_handler::run_direct_execution_handler` → `run_policy_scoped_chat_completion(request, None /* 无 delegated */, emit_status)` → `run_local_chat_complete_with_tools(...)`。

Direct handler 是个**薄壳**——它做的事就是"以 ResponseOnly policy 跑 agentic loop"。

### 6.1 工具面（最关键的差异）

[`tool_catalog.rs::build_local_runtime_tools_with_allowlist`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) 用 `policy.effective_allowed_tool_names(capability_snapshot)` 过滤。

| Policy | allowlist 来源 | 含 |
|---|---|---|
| `ResponseOnly`（Direct） | `resident_capability_control_tool_names()`（[`mcp-runtime/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs)） | `search_sdk`, `activate_skill`, `read_skill_resource`, `terminal_context_peek/read/pack`, `context_search/open/expand/summarize_evidence` |
| `WorkerReasoning`（Worker） | `full_execution_tool_names()` | 上面那些 + `diting_think`（仅第 1 轮）、`delegate_task`、`execute_code_plan`、`run_local_code_snippet`、`attach_capability` / `detach_capability`、`query_task_policy`、`sys_submit_onboarding_request`、`refresh_skill_index`、`monitor.*`、所有 `browser_*`、所有 `write_*` / `inspect_*` / `patch_*` 文档工具 + 动态 MCP/Skill |

**Direct 模式下，模型物理上看不到 `delegate_task`**——它根本不在传给 provider 的 `tools[]` 数组里。这是工程纪律，不靠提示词约束。

另外 `policy.inject_execution_protocol`：Direct 是 `false`，Worker 是 `true`——后者会在系统消息前置一段"Desktop Execution Tools"说明，告诉模型可以多步执行。

### 6.2 Agentic loop

[`chat_tool_runtime/mod.rs::continue_local_chat_complete_with_tools`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)，按轮次推进：

```text
loop {
    state.round += 1
    if state.round > max_rounds:
        return build_max_rounds_exceeded_response(state)   // LOCAL_CHAT_MAX_ROUNDS_EXCEEDED

    effective_allowed = policy.effective_allowed_tool_names(last_capability_snapshot)
    tools = build_local_runtime_tools_with_allowlist(effective_allowed, snapshot)
    if round == 1 && !state.diting_think_consumed:
        tools = inject_diting_think_tool(tools)            // 第 1 轮 reasoning 闸

    response = request_provider_chat_completion(messages, tools, ...)
    runtime_metrics.observe_response(&response)

    if extract_chat_tool_calls(&response).is_empty():
        return enrich_response_with_tool_trace(state, response)   // 终止：模型出 final answer

    match process_chat_tool_calls(...) {
        Completed { ... }   => continue,
        Interrupted { approval_tokens, ... } => 挂起（见 §6.5）
    }
}
```

**轮次预算**：`max_rounds` 从桌面 config `MAX_AGENTIC_ROUNDS_CONFIG_KEY` 读取，由 [`desktop_config::parse_max_agentic_rounds`](../deeting/src-tauri/src/modules/desktop_config) 解析。超过即 `LOCAL_CHAT_MAX_ROUNDS_EXCEEDED` 终止。

### 6.3 `diting_think` round-1 reasoning gate

**只在第 1 轮注入，被消费一次后永久从 `tools[]` 移除**：

- 注入点：`tools` 数组渲染时，`round == 1 && !diting_think_consumed` 才追加。
- 消费点：`process_chat_tool_calls` 命中 `tool_name == DITING_THINK_TOOL_NAME`，调 `format_diting_think_reasoning(arguments)` 渲染 `[意图] / [上下文] / [执行计划] / [约束]` 四段结构化 reasoning，落 `state.captured_reasoning`，并置 `state.diting_think_consumed = true`。
- 之后所有轮次 `inject_diting_think_tool` 不再追加。

**作用**：在工具面广的 Worker 模式里，强制模型先做一次结构化"思考梳理"再选工具——避免一上来就盲调 `delegate_task` 或 `execute_code_plan`。Direct 模式因为工具面已经被锁窄，`diting_think` 价值小但仍可被模型主动调用。

### 6.4 工具分派（big match）

`process_chat_tool_calls` 对每个 tool_call：

1. **名字规范化**：`resolve_provider_tool_name_for_execution` → `canonicalize_tool_name_for_allowed_list`
2. **call_id 解析**：`resolve_local_tool_call_id`
3. **allowlist 校验**：不在 `effective_allowed_tool_names` → 合成 `LOCAL_TOOL_POLICY_BLOCKED` 错误
4. **入库 Running**：`persist_running_tool_execution_runtime(... InFlightExecutionStage::ToolRunning ...)`
5. **按名字分支**（节选）：

| 工具 | 分派函数 |
|---|---|
| `diting_think` | 同步合成结构化 reasoning，标记 consumed |
| `terminal_context_*` / `terminal_write_input` | `execute_terminal_context_tool(...)` |
| `context_search/open/expand/summarize_evidence` | `execute_context_tool(...)` |
| `execute_code_plan` | 走 `DecisionLocus::Execution` 策略门 + `CapabilityExecutionContract::from_search_result` + `execute_code_mode_request(...)` 桥接 sandbox stream |
| `run_local_code_snippet` | `app_state.sandbox.manager.run_local_code_snippet_with_prepare_config(...)` |
| `search_sdk` | `build_local_sdk_search_result_bundle_with_feedback_runtime(...)`，写 `last_capability_snapshot` |
| `activate_skill` / `read_skill_resource` | 更新 `state.active_skill_context` |
| **`delegate_task`** | `execute_delegate_task_tool(...)`，见 §7.3 |
| `query_task_policy` | `Self_::consult_named(store, decision_point, query, limit)` |
| `attach_capability` / `detach_capability` | 改 `state.active_capability`，emit `LocalCapabilityTransition` |
| `sys_submit_onboarding_request` | 创建 assistant / 安装 skill / 创建 custom task agent |
| `refresh_skill_index` | 重扫本地 skill 目录 |
| 默认（MCP / Skill 动态） | `execute_or_queue_mcp_tool_call_with_tool_ref(...)` — 走 Approval Gate |

6. **结果合成 / 清理**：如果 `tool_call_meta` 缺行 → `LOCAL_TOOL_RESULT_MISSING`；如果没产生 approval token → `clear_execution_graph_runtime_context(...)` 把 Running 行清掉。

### 6.5 Approval Gate 挂起与恢复

MCP 工具分支会检查 `tool_result.status == "REQUIRES_APPROVAL"`。一旦命中：

1. `approval_tokens.push(token)`，并把 meta 标 `"status": "requires_approval"`。
2. 内层 `process_chat_tool_calls` 返回 `LocalToolCallProcessingOutcome::Interrupted { approval_tokens, tool_call_meta, results, ... }`。
3. 外层主循环：
   - `canonicalize_tool_call_meta_via_graph(...)` 把 meta 对齐到 DAG。
   - 构建 [`SuspendedChatToolExecution::from_state(...)`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/suspended.rs)——快照 `max_rounds / round / trace_id / execution_policy / model_connection / orchestrated_messages / task_query / active_capability / active_skill_context / runtime_metrics / last_response / last_capability_snapshot / pending_approvals / selected_knowledge_file_ids` + 冻结的 `execution_graph`。
   - `build_pending_approval_records_from_tool_call_meta(...)` → `Vec<PersistedPendingApproval>`（token / tool_id / tool_name / arguments / risk_level / risk_reasons / tool_fingerprint / policy_rule_key / approval_grant_key / graph node ids / created/expires_at_unix_ms）。
   - `persist_suspended_execution_graph_runtime(... InFlightExecutionStage::WaitingApproval, ...)` 落 SQLite。
   - 返回——loop 暂停。

完整的状态机、跨进程恢复、UI projection 参见 [agent-dag-architecture.md](./agent-dag-architecture.md)。

## 7. Worker Plane 详解

[`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) → `LocalExecutionPlane::WorkerReasoning` → `worker_handler::run_worker_execution_handler`。

Worker handler 比 Direct 复杂：它有可能在模型还没说话之前**自动**起一个 CustomTaskAgent / Workflow 子任务，等子任务结果回流，再让父 chat completion 整合。

### 7.1 Handler 入口

[`worker_handler.rs::run_worker_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs)：

```text
delegated_execution = maybe_delegate_worker_to_custom_task_agent(request, emit_status)?

if delegated_execution.is_running():
    // 异步 child，handler 直接返回 trace blocks，等 child 通过 recovery 把父唤醒
    return trace_blocks
else:
    // 同步 child（已完成）或没委派
    return run_policy_scoped_chat_completion(request, delegated_execution, emit_status)
```

### 7.2 自动委派 vs 模型主动委派

Worker plane 有**两条委派路径**，**不要混淆**：

**路径 A：自动委派（handler 入口前）**

`maybe_delegate_worker_to_custom_task_agent` 仅在 `policy.allow_worker_delegation == true`（即 Worker plane）时触发。逻辑：

1. 调 [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) 按 prior + bandit + skill match 排序候选 profile。命中 BANDIT_SCENE_WORKER_SELECTION。
2. 若打分超过阈值 → 直接起子任务，**模型这一轮根本没见过工具面**——它的输出就是 child 跑完后的整合答案。
3. 这条路径专门服务于"用户已经显式 `@<task-agent>` 提到 / 单一 callable 强匹配"等高确定性场景。

**路径 B：模型主动委派（loop 中调 `delegate_task`）**

Worker plane 的 `tools[]` 包含 `delegate_task`。模型经过 `diting_think` 后可以主动选择委派：

- 调用点：`chat_tool_runtime/mod.rs::execute_delegate_task_tool`
- 与路径 A 共用 `select_worker_custom_task_agent` 选择器
- 与路径 A 共用 `WorkerTaskPacket` 结构
- 区别只是**触发时机**：A 在 handler 入口，B 在 agentic loop 中段

### 7.3 CustomTaskAgent 子运行时

[`worker_dispatch.rs::build_worker_task_packet`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) 构建 `WorkerTaskPacket`：

```text
WorkerTaskPacket {
    schema_version: u32,
    task_id: String,
    route: "direct" | "worker",
    goal: String,
    user_query: String,
    task_kind, deliverable_kind,
    context_summary, relevant_inputs,
    required_capabilities, candidate_capabilities,
    constraints, non_goals,
    allowed_actions, forbidden_actions,
    packet_hash: String,                              // 自校验
}
```

子运行时入口：[`custom_task_agents/runtime.rs::preview_custom_task_agent_with_parent_model`](../deeting/src-tauri/src/modules/custom_task_agents/runtime.rs)。

**Preflight 拒绝**：子 profile 是 `Chat` invocation 且 `callable_mcp_tool_ids` + `callable_skill_action_refs` 都空 → 直接返回 `Failed { reason: "missing_executable_surface", suggested_action: reconfigure_agent }`，**子任务都不会启动**。这是为了不让用户配置错误的 agent 浪费一整轮 LLM 调用。

**子的工具面绑定**（[`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)）：

- `load_callable_skill_actions(app_state, profile.callable_skill_action_refs)` → `HashMap<String, ResolvedSkillAction>`
- `profile.callable_mcp_tool_ids` → `HashMap<String, McpTool>`
- `builtin_callables` 内置：`diting_think`（仅第 0 轮）、`llm_wiki_search_corpus`（**只在 LLM Wiki maintainer agent 内可见**）等
- 输出 `tool_payload: Option<Value>`（OpenAI 兼容 `tools[]` 数组）+ `bindings_by_provider_name`（按 provider 名反查到 MCP/Skill 实例）

**子运行时轮次预算**：`MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS = DEFAULT_MAX_AGENTIC_ROUNDS`——与父 loop 同值，但**独立计数**。

### 7.4 Workflow 引擎路径（可选分支）

如果 `policy.prefer_workflow_runtime == true`（由 `workflow.route_worker_through_workflow` 桌面 config 驱动）且 `profile.invocation_kind == Chat`，handler 走另一条路：

[`workflow_service::prepare_quick_workflow_run`](../deeting/src-tauri/src/modules/workflow/service.rs) → 异步 `start_workflow_run` → 返回 `DelegatedExecutionSession { state: Running, ... }`。

Workflow 引擎是**独立**的：

- 状态机：`WorkflowRunStatus { Draft, Ready, Running, WaitingApproval, AwaitingPlanEdit, Completed, Failed, Cancelled }` + `WorkflowStepStatus { Pending, Ready, Running, WaitingApproval, Succeeded, Failed, Skipped, Obsolete, Invalidated }`
- 节点类型：`WorkflowStepType { WorkerCall, ApprovalGate, Finalize }`
- 服务入口：[`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs) — 提案 / 重生成 / 重跑阶段
- 调度器：[`workflow/scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs)
- worker 适配：[`workflow/worker_adapter.rs::execute_via_worker_profile`](../deeting/src-tauri/src/modules/workflow/worker_adapter.rs) — 把 step 落到对应 custom task agent，消费 `context_packet.worker_task_packet`
- 持久化：[`workflow/store/`](../deeting/src-tauri/src/modules/workflow/store/) — run / step / event / artifact / checkpoint 四张表

**自适应计划审计**：Workflow 不是把初始 proposal 静态跑到底。每个普通 worker phase 成功后，scheduler 会调用 [`workflow/plan_audit.rs`](../deeting/src-tauri/src/modules/workflow/plan_audit.rs) 生成 `PlanAuditDecision`，并写入 `run.plan_audit.completed` 事件。默认 deterministic 层兼容 worker 输出的 `followup_hints`：空 hints 继续原计划；`pause_for_edit` 或 `invalidates_future_phases` 会让 run 进入 `AwaitingPlanEdit`，等待用户处理。

Plan 修订走结构化 `PlanDelta`，不直接覆盖原始 proposal。用户审批的 delta 通过 `apply_plan_delta` / [`workflow/service.rs::apply_plan_delta_to_running_snapshot`](../deeting/src-tauri/src/modules/workflow/service.rs) 应用，只能修改 pending phases，并且必须通过 snapshot version、completed phase、worker ref、phase id、DAG forward dependency 等校验。自动应用更窄：只有低风险、pending-only、无 worker/dependency 变更的 `update_phase` 可以 `auto_apply_delta`；`add_phase` / remove / reorder / worker 变化都会降级到用户审批，避免模型静默重写执行图。

模型审计是可选增强，由桌面 config `workflow.plan_audit.model.enabled` 控制，默认关闭。打开后模型只能产出结构化 JSON decision / delta；任何无效 JSON、缺失 delta、风险不匹配或 validator 失败都会转为 `AwaitingPlanEdit`，不会静默继续。

走 Workflow 路径时，父 handler 持久化一行 `InFlightExecutionStage::DelegatedWorkflowRunning`，把 chat runtime context 一并打包进去。父 loop 暂停。子 workflow 跑完后由 `recovery.rs::wake_delegated_runtime_for_workflow_run` 唤醒父。

### 7.5 `delegated_result` 回流

子任务（CustomTaskAgent 或 Workflow）跑完后，handler 拿到一份规范化的 [`DelegatedExecutionRecord`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs)：

```text
DelegatedExecutionRecord {
    kind: CustomTaskAgent | Workflow,
    status: Succeeded | Failed | Integrated,
    target, selection, packet_receipt,
    children: [
        { phase: "selection", ... },
        { phase: "packet",    ... },
        { phase: "execution", ... },
    ]
}
```

`record.delegated_result()` 输出符合 `DELEGATED_RESULT_SCHEMA_VERSION = 1` 的规范化 JSON envelope。

整合到父对话由 `build_delegated_result_feedback_messages(&record)` 完成：

1. 追加一条 `system` 消息——"下一条 user 消息是规范的 `delegated_result` JSON，权威性 = Succeeded/Integrated"
2. 追加一条合成 `user` 消息，content 是 `delegated_result` 的 JSON 序列化

父 chat completion 在这个扩展过的消息列表上**再跑一轮**——这是模型整合 / 总结 / 决定下一步的窗口。

**例外**：`image_generation` / `text_to_speech` 这类用户显式调用、答案天生就是 deliverable 的 invocation kind，`should_return_delegated_result_directly == true` 时跳过父再跑一轮，直接把 child 的 rendered blocks 当作回答返回。

## 8. 边界与不变式

### 8.1 编排是共享的

```text
两个 plane 共享：
- LocalOrchestrationEngine 8 步流水线
- ContextManifest（context_* 工具配置）
- SkillRecipeInjection
- PromptVariantSelection（router:prompt bandit）
- TemplateRender
- chat_tool_runtime 主 loop 框架
- diting_think round-1 gate（在 Worker 更有意义但 Direct 也可见）

两个 plane 不同：
- 工具 allowlist（resident vs full）
- inject_execution_protocol（false vs true）
- allow_worker_delegation（false vs true）
- handler 实际跑的代码
```

### 8.2 Direct 不能产出 worker children

`delegate_task` **不在** `resident_capability_control_tool_names()` 里。Direct 模式下模型即使想委派也调不到——provider 不会把这个工具放进 `tools[]`。

唯一让一次对话从 Direct 切到 Worker 的途径，是 `apply_route_prior` 在 8 步流水线里**翻盘**——而且必须 prior + bandit 加起来差距 ≥ 0.35，且 base 决策没安全锁。这个翻盘发生在**agentic loop 启动之前**，不是 loop 中段。

### 8.3 Worker 一定要先编排

Worker handler **绝不**绕过 8 步流水线直接跑 agentic loop。即使是路径 A 的自动委派，也是先跑完 8 步、拿到完整 `execution_policy` 之后才进 handler。

### 8.4 `delegated_result` 是唯一回流形式

子任务回流父对话只有一条路径：构造规范化 `delegated_result` envelope → 拼成 `system + user` 两条消息 → 父再跑一轮。**不允许**子任务直接修改父的 `messages` 数组、`captured_reasoning`、`active_capability` 等状态。

## 9. 持久化与跨进程恢复

依赖 [agent-dag-architecture.md](./agent-dag-architecture.md) 的 execution graph 模型，这里只列双 plane 相关的关键点：

`InFlightExecutionStage` 涵盖两 plane 的所有挂起态：

| Stage | 触发场景 |
|---|---|
| `ToolRunning` | 任何工具正在跑 |
| `WaitingApproval` | Direct / Worker 都可能命中——某个 MCP 工具返回 `REQUIRES_APPROVAL` |
| `ResumingAfterApproval` | 用户审批后恢复中 |
| `ResumeFailed` | 恢复失败 |
| `DelegatedWorkflowRunning` | Worker plane 走 Workflow 路径，子 workflow 跑中 |
| `Interrupted` | 其它中断 |

跨进程恢复入口：[`chat_tool_runtime/recovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs)：

- `recover_inflight_local_execution_state(_app, app_state)` — 启动时扫描所有 inflight 行
- `wake_delegated_runtime_for_workflow_run(...)` — workflow 完成后唤醒父
- `resume_delegated_runtime_after_custom_task_agent_run(...)` — CustomTaskAgent 完成后唤醒父
- `resume_suspended_chat_tool_execution_after_approval(...)` — 审批后恢复
- `recover_local_chat_execution_from_action(...)` — 统一前端 resume/retry/cancel 命令入口

## 10. 反馈回路（评估 + 学习）

8 步流水线和两个 handler 跑完后，[`local_orchestrator.rs::execute_local_orchestrated_chat`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs) 还有一段后处理。

### 10.1 评估器

[`task_learning/evaluator.rs::evaluate_task_learning_with_runtime`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)：

对每一轮对话打四个评分（每个评分维度有固定枚举，便于 bandit 直接消费）：

| 评分 | 枚举值 |
|---|---|
| `route_judgment` | `good` / `acceptable` / `wasteful` / `wrong` |
| `worker_selection_judgment` | `success` / `partial` / `blocked` / `unstable` / `failed` |
| `discovery_judgment` | `sufficient` / `shallow` / `excessive` / `skipped_when_needed` |
| `execution_judgment` | （execution 决策点专用）|

评估**只用启发式**——不在评估阶段二次调用模型给自己打分，避免"模型给模型打分"的隐藏回路。详见 [self-evolution-architecture.md §7](./self-evolution-architecture.md#7-评估管线evaluator)。

特殊情形捕捉：例如**route = worker 但实际没委派、也没调任何工具** → `route_judgment = "wasteful"`——下次同 fingerprint 会被 prior 拉回 Direct。

### 10.2 落 prior + bandit feedback

`store.record_task_learning_run(...)` 写一行 task_learning_runs（含 outcome / attribution / policy_delta），然后：

1. 如果 `evaluation.policy_delta.is_some()` → `apply_policy_delta(store, fingerprint_key, delta, ...)` 写 signed magnitude（`strengthen / positive` 为正、`weaken / negative` 为负）到 `task_policy_priors` 表。
2. `record_task_learning_bandit_feedback(...)` 写 3 个 bandit scene：
   - `BANDIT_SCENE_TASK_ROUTE` — arm = `direct/worker`，success ← `route_judgment_to_success(route_judgment)`
   - `BANDIT_SCENE_WORKER_SELECTION` — arm = `delegated.selected_profile_id`，success ← `worker_selection_judgment_to_success(...)`（仅当真的发生了委派）
   - `BANDIT_SCENE_MEMORY_RECALL` — 仅当 `memory_explore_arm_id` 存在，按 `discovery_judgment` 评分
3. `router:prompt` bandit（[`local_orchestrator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs)）— arm = `"detailed" / "concise"`，按延迟 / 成功率反馈

详见 [bandit-architecture.md §5](./bandit-architecture.md#5-三个使用场景)。

### 10.3 后验信号（posterior signal）

下一条 user 消息进来时（**还没跑 8 步流水线之前**），先针对上一轮 trace_id 做一次 posterior 检测：

[`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal):

- `PosteriorSignalKind { Accepted, Corrected, Rejected, Unknown }`
- `rules.rs` — 短语启发式（否定词、纠正短语、追问模式）
- `resolver.rs::should_apply_posterior_signal` — `kind != Unknown && confidence >= 0.5` 才生效

若生效 → `apply_task_learning_revision(store, run_id, signal, "followup_user_message", note)` **追溯修订上一轮的 prior**——这是"用户事后纠正"的反馈通道。

详见 [self-evolution-architecture.md §10](./self-evolution-architecture.md#10-后验信号posterior-signal)。

## 11. 文件地图

| 我想… | 看这里 |
|---|---|
| 改 route 的启发式 | [`mcp-runtime/route.rs::select_local_route_with_evidence`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs) |
| 改 plane / policy 构建 | [`mcp-runtime/policy.rs::build_local_execution_policy`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) |
| 改 prior + bandit 翻盘公式 | [`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| 改安全锁清单 | 同上文件 `decision_has_safety_lock` |
| 改 8 步流水线 | [`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) |
| 改 Direct handler | [`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs) |
| 改 Worker handler / 自动委派 | [`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs) |
| 改 agentic loop | [`chat_tool_runtime/mod.rs::continue_local_chat_complete_with_tools`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| 改工具 allowlist | [`tool_catalog.rs::build_local_runtime_tools_with_allowlist`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) |
| 改 `delegate_task` 行为 | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` |
| 改 worker 选择 | [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) |
| 改 worker task packet schema | 同上文件 `WorkerTaskPacket` |
| 改子 agent 工具绑定 | [`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs) |
| 改 Workflow 引擎 | [`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs) + [`scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs) |
| 改 `delegated_result` envelope | [`execution_plane.rs::DelegatedExecutionRecord::delegated_result`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) |
| 改评估打分 | [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| 改后验信号 | [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal) |

## 12. 反模式（PR review 拒绝）

| 反模式 | 为什么不行 |
|---|---|
| 让 Direct 模式工具面包含 `delegate_task` | 模糊了"一把梭"和"编排"的语义边界；prior 学习目标失效 |
| 在 8 步流水线之外另搞一条 fast path（跳过编排直接 agentic） | 把"模式选择"从可解释的 RouteSelectionStep 散到各处；persistence / posterior 都断裂 |
| 抬高 `ROUTE_BANDIT_COEFF` 让 bandit 独自翻盘 | 见 [bandit-architecture §9](./bandit-architecture.md#9-设计约束pr-review-时拒绝) |
| 删 / 加安全锁 reason 而不更新评估器 | 安全锁是不可翻盘条件，evaluator 也基于此打 `wasteful` 标签——两边必须同步 |
| 让子 agent 直接修改父 `state` | 破坏 `delegated_result` envelope 不变式，恢复链路会失效 |
| 给 Worker handler 加"绕过 chat_completion 直出 delegated 结果"路径而不走 `should_return_delegated_result_directly` 检查 | 父对话连贯性丢失，evaluator 也看不到真实路径 |
| 在 Direct 模式手动注入 Worker 工具来"调试" | 工具面被 policy 强制约束，调试用 Worker plane + `attach_capability` 才是正确路径 |
| 给 plane 增加第 3 种（如 `HybridReasoning`） | 不要——增加种类前先想清楚它和现有两种**不重合**在哪里；模糊的中间态只会让 prior 学习面变稀疏 |
| 让 8 步里某一步成为可选 / 条件跳过 | 8 步的并行 / 拓扑结构假设所有 Step 都跑过；条件跳过会让下游 ContextPatch 视图不一致 |

## 13. 验证清单

改 dual plane / route / handler 的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib mcp_runtime::route --no-fail-fast`
- [ ] `cargo test --lib mcp_runtime::policy --no-fail-fast`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib local_orchestrator --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib worker_handler --no-fail-fast`
- [ ] `cargo test --lib execution_plane --no-fail-fast`
- [ ] 关键不变式测试仍然绿：
  - `apply_route_prior_bandit_scores_surface_on_application`（bandit 单独不能翻盘）
  - `direct_policy_does_not_contain_delegate_task`（Direct allowlist 不含 worker 委派工具）
  - `safety_lock_reasons_block_prior_override`（安全锁有效）
  - `delegated_result_schema_version`（envelope schema 版本）
- [ ] 桌面端手测：
  - 显式 `@<task-agent>` → 立即走 Worker plane + 自动委派路径 A
  - 显式"直接帮我删 X 文件" → 触发 `destructive_intent` 安全锁，强制 Direct + 审批
  - 反复跑同一类清晰的 worker 任务 → prior 应缓慢拉向 worker
  - 模型在 Worker 模式下选错 worker 多次 → cooldown 应生效
  - Approval 挂起后关进程 → 重启后能从 SuspendedChatToolExecution 恢复
  - Workflow 路径长任务 → 父对话挂起，workflow 跑完父能被 `wake_delegated_runtime_for_workflow_run` 唤醒

## 14. FAQ

**Q：为什么不让模型自己决定 plane？**
A：模型决策不稳定 + 不可解释 + prior 学习面会被打散到工具维度而不是模式维度。把 plane 提到编排层显式决定，是把"业务边界"从概率算法手里收回工程师手里。

**Q：那 `diting_think` 不就是"让模型自己想 plane"吗？**
A：`diting_think` 是**在 plane 决定之后**让模型梳理思路，不是让它选 plane。8 步流水线已经决定了 Worker plane，`diting_think` 只是帮助模型更好地决定**调哪个工具 / 委派给谁**。

**Q：Direct plane 能调 `context_*` 这类工具吗？算"编排"吗？**
A：能调。`context_*` 是检索工具，不是编排工具——它返回的是 evidence envelope，不会派生子任务。Direct 仍然是"一把梭"语义。

**Q：如果 Worker plane 自动委派后子任务跑得很差（`worker_selection_judgment = blocked`），下次会怎么样？**
A：bandit scene 2 给这个 profile arm 一个失败反馈；若连续失败 → 进入 cooldown（参见 [bandit-architecture §6](./bandit-architecture.md#6-cooldown-与失败保护)）；prior 也会受 `policy_delta` 影响逐步降权。

**Q：8 步流水线为什么不能跳？比如对话很短，能不能直接 chat completion？**
A：不能。`ContextManifestStep` 决定模型看到哪些上下文工具、`RouteSelectionStep` 决定走哪个 plane、`TemplateRenderStep` 决定系统 prompt 长什么样——任何一步跳过都会让 `LocalControlPlaneResult` 不完整，下游 handler 拿不到必需字段。"短对话开销"不是问题：8 步并行总耗时通常 < 50ms。

**Q：能不能加 plane 之间的"渐进升级"——比如 Direct loop 中检测到复杂度突然升级，自动切到 Worker？**
A：**不要**。这会让 plane 边界模糊，且 prior 学习目标失效。如果模型在 Direct loop 里发现复杂度超出预期，正确做法是返回 final answer 让用户重新发起对话——下一轮 prior 会把这个 fingerprint 拉向 Worker。

**Q：Worker 自动委派会不会让用户感觉"我还没说话怎么就开始干活了"？**
A：自动委派**仅在路径 A 高确定性条件下触发**（显式 `@<task-agent>` / 单一 callable 强匹配）。其他情况都走路径 B——让模型先做 `diting_think` 再决定。UI 在 `runtime.route.selected` + `runtime.execution.handler.selected` 状态事件里会显示"自动委派给 X"。

**Q：Workflow 引擎和 8 步编排有什么区别？两者都叫"工作流"。**
A：完全不是一回事：
- 8 步编排引擎是**单次对话**的 in-process 流水线，跑 prompt 组装。
- Workflow 引擎是**多步可恢复任务**的独立运行时，支持人审批、计划编辑、分阶段重跑、跨重启。Worker plane 在 `prefer_workflow_runtime` 时才会调用它。

**Q：能不能给 LLM provider 加新的"native function calling 模式"做 plane 选择？**
A：不要。provider 各家 function calling 实现差异大、不可解释、不可学习。Deeting 的 plane 决策必须留在本地 runtime——`RouteSelectionStep` 是单一权威点。

## 15. 参考

- Route 决策入口：[`local_orchestrator/workflow.rs::RouteSelectionStep`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)
- Base 启发式：[`mcp-runtime/route.rs`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs)
- Policy 构建：[`mcp-runtime/policy.rs::build_local_execution_policy`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs)
- Prior 融合：[`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- Plane 分叉：[`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs)
- Direct handler：[`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs)
- Worker handler：[`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs)
- Agentic loop：[`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
- Worker 选择 + packet：[`worker_dispatch.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs)
- 子 agent 工具绑定：[`custom_task_agents/bound_callables.rs`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)
- Workflow 引擎：[`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs)、[`scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs)、[`worker_adapter.rs`](../deeting/src-tauri/src/modules/workflow/worker_adapter.rs)
- 评估器：[`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)
- 后验信号：[`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal)
- 兄弟文档：[`agent-dag-architecture.md`](./agent-dag-architecture.md)、[`self-evolution-architecture.md`](./self-evolution-architecture.md)、[`rag-architecture.md`](./rag-architecture.md)、[`bandit-architecture.md`](./bandit-architecture.md)、[`memory-architecture.md`](./memory-architecture.md)、[`security-architecture.md`](./security-architecture.md)
