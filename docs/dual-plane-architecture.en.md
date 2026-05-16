# Deeting Dual-Plane Execution Architecture (Direct vs Worker)

> Scope: the "semantic-aware routing" of the desktop local-chat runtime — when a user message comes in, how the system decides whether to **call tools directly and get it done** or **go through orchestration / delegation**, and what pipeline each path runs through afterwards.
> Out of scope: DAG execution and resumable runtime (see [agent-dag-architecture.en.md](./agent-dag-architecture.en.md)); prior half-decay and the six decision points (see [self-evolution-architecture.en.md](./self-evolution-architecture.en.md)); context manifest and `context_*` tools (see [rag-architecture.en.md](./rag-architecture.en.md)); the three bandit strategies and three scenes (see [bandit-architecture.en.md](./bandit-architecture.en.md)).

This document is for people who want to understand "how Deeting flips between *one-shot direct execution* and *orchestrate-first, execute-later* modes." We start from motivation, take apart every input to the route decision (base router / override / prior / bandit), introduce the **eight-step orchestration pipeline shared by both planes**, decompose the Direct and Worker execution cores separately, and finish on the boundaries, persistence, and feedback loops between them.

## 1. TL;DR

Deeting local chat has **exactly two execution planes**, but they share the same eight-step orchestration pipeline:

```
                    User input
                       │
                       ▼
        ┌──────────────────────────────┐
        │ LocalOrchestrationEngine     │  ← 8-step pipeline; both planes run it
        │ (build_desktop_local_chat_   │
        │  engine — topo sort +        │
        │  parallel layers)            │
        └──────────────────────────────┘
                       │  includes RouteSelectionStep
                       ▼
        ┌──────────────────────────────┐
        │ run_local_execution_plane    │  ← fork happens here
        │                              │
        │ ResponseOnly → Direct        │
        │ WorkerReasoning → Worker     │
        └──────────────────────────────┘
                  │           │
                  ▼           ▼
        Direct Handler   Worker Handler
        (one-shot)       (delegate / orchestrate first)
                  │           │
                  ▼           ▼
        chat_tool_runtime    ├── auto-delegate to CustomTaskAgent
        agentic loop         ├── or go through Workflow runtime
                             └── after completion, integrate
                                  delegated_result, then run
                                  chat_tool_runtime once more
```

- **The two planes** have **two names** in the codebase: business side `LocalRouteKind::{Direct, Worker}`; runtime side `LocalExecutionPlane::{ResponseOnly, WorkerReasoning}`. **One-to-one mapping**, but the tool surfaces (allowlists) differ.
- **Direct plane** locks the tool surface to "resident capability control + context retrieval + terminal read-only + skill activation" — the model **literally cannot see** `delegate_task` / `execute_code_plan` / `attach_capability`. Intent: "one-shot, no forks."
- **Worker plane** gets the full tool surface plus `inject_execution_protocol = true` and `allow_worker_delegation = true`. Intent: "complex tasks are allowed to orchestrate, delegate, and run long flows."
- **Routing decision** lives in `RouteSelectionStep` (pipeline step 5), fused from four evidence sources: base router heuristics + explicit task-agent mention + 21-day half-decay prior + bandit sampling. All "dangerous operation / user-explicit lock" reasons are **safety locks** — prior + bandit together cannot override them.
- **Both planes run the same orchestration pipeline**: all 8 steps. Direct is not "skip orchestration"; it is "orchestrate, then pick the ResponseOnly handler."

Key code:

```
deeting/src-tauri/
├── crates/mcp-runtime/src/
│   ├── route.rs                                // LocalRouteKind / TaskProfile / heuristics
│   └── policy.rs                               // LocalExecutionPlane / build_local_execution_policy
└── src/modules/desktop_runtime/
    ├── local_orchestrator.rs                   // execute_local_orchestrated_chat — top entry
    ├── local_orchestrator/
    │   ├── workflow.rs                         // 8-step engine + 7 steps
    │   └── retrieval.rs                        // ContextManifestStep
    └── runtime/
        ├── execution_plane.rs                  // run_local_execution_plane (Direct/Worker fork)
        ├── execution_plane/
        │   ├── direct_handler.rs               // ResponseOnly: agentic loop directly
        │   └── worker_handler.rs               // WorkerReasoning: delegate first, then loop
        ├── task_learning/policy.rs             // apply_route_prior + safety locks
        ├── worker_dispatch.rs                  // select_custom_task_agent_candidate_with_bandit
        ├── control_plane.rs                    // maybe_override_route_with_custom_task_agent_*
        └── chat_tool_runtime/
            ├── mod.rs                          // continue_local_chat_complete_with_tools
            ├── tool_catalog.rs                 // build_local_runtime_tools_with_allowlist
            └── inflight.rs                     // suspend / resume
```

## 2. Why not have a single plane?

The naive design is "everything runs through one agentic loop, one tool surface, and the model decides whether to call `delegate_task`." Several engineering problems make that untenable:

1. **Model decisions are unstable.** The same kind of task may sometimes trigger `delegate_task` and sometimes get handled in place, depending on context. Users feel a "fast/slow at random" rhythm.
2. **Exposed surface area = danger.** If Direct mode also exposed `execute_code_plan` / `delegate_task`, a simple "translate this sentence" could trigger codemode execution. That is unnecessary attack surface.
3. **Prior learning becomes useless.** We want to learn "what plane should this kind of task take" — but if there is only one plane and all tools are exposed, the prior just learns "which tool did the model pick," not "how should the system respond." The semantic dimension is shredded.
4. **Approval semantics are blurred.** Direct one-shot tools should be low-risk, immediately executable; Worker tools heavily involve approval. Mixing them makes it impossible for the UI to clearly express "what gear is this conversation in right now."

So Deeting lifts the "mode" up to the plane layer and lets the orchestration pipeline decide it explicitly, rather than letting the model self-route. The two planes are **explicitly split** on external naming, tool surface, handler, and prior-learning target:

| Naive single-plane | Deeting dual-plane |
|---|---|
| Full tool surface | Direct: a resident allowlist (~9 tools); Worker: full surface (~49 + dynamic MCP/Skill) |
| Model self-routes | `RouteSelectionStep` scores explicitly — explainable, auditable |
| Prior learns nothing at the plane axis | `task_learning` has a `route` decision point dedicated to plane choice |
| Approval semantics blurred | Direct tools default to no approval; Worker tools have a full Approval Gate flow |
| Not explainable | `route_decision.reasons` lists each triggered reason; the frontend and evaluator both consume it |

## 3. Three-level name mapping

The codebase has **three names for the same thing**, which is confusing on first read:

| Business concept | route (`LocalRouteKind`) | plane (`LocalExecutionPlane`) | handler |
|---|---|---|---|
| Direct / one-shot | `Direct` | `ResponseOnly` (string `"response_only"`) | [`direct_handler::run_direct_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs) |
| Worker / delegate first | `Worker` | `WorkerReasoning` (string `"worker_reasoning"`) | [`worker_handler::run_worker_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs) |

Entry types:

- [`mcp-runtime/src/route.rs`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs) — `LocalRouteKind`, `LocalRouteDecision { route, reasons, profile, evidence }`, `TaskProfile`, `RouteEvidence`
- [`mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) — `LocalExecutionPlane`, `LocalExecutionPolicy { route, plane, allowed_tool_names, inject_execution_protocol, allow_worker_delegation, prefer_workflow_runtime, capability_snapshot }`, `build_local_execution_policy(&decision) -> policy`

Mental shortcut: **route is "where to go," plane is "what the tool surface looks like," handler is "what code actually runs."**

## 4. Full route-decision chain

Entry: [`RouteSelectionStep`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) (pipeline step 5, depends on `generated_artifact_context_injection`).

Execution order:

```text
RouteSelectionStep.execute()
  │
  ├─ ① build_task_fingerprint(query)                      → TaskFingerprint
  ├─ ② resolve_runtime_discovery_bundle(ctx, query)       → RuntimeDiscoveryBundle
  │                                                         (route_evidence / skill_recipes /
  │                                                          capability_snapshot)
  ├─ ③ select_local_route_with_evidence(query, evidence)  → base decision (heuristics)
  ├─ ④ maybe_override_route_with_custom_task_agent_*      → explicit @task-agent /
  │                                                         single-callable upgrade
  ├─ ⑤ Self_::consult(store, DecisionLocus::Route, ...)   → Advisory(TaskPolicyHint) prior
  ├─ ⑥ compute_route_bandit_scores(provider_store)        → Option<RouteBanditScores>
  ├─ ⑦ apply_route_prior(base, hint, bandit)              → final decision + override_applied
  └─ ⑧ apply_desktop_execution_policy_overrides(
         store, build_local_execution_policy(&decision))  → final LocalExecutionPolicy
```

Finally, the workflow context is patched via `ContextPatch::SetTaskFingerprint` / `SetRouteDecision` / `SetExecutionPolicy`, and `runtime.route.selected` status is emitted.

### 4.1 Base router (heuristics)

[`route.rs::select_local_route_with_evidence`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs):

```text
if profile.explicit_route is set
    → use that, reason = "explicit_route"

else if profile.destructive_intent
     || profile.approval_sensitive
     || evidence.any_mutating_capability
     || evidence.any_high_risk_capability
    → force Direct
       reasons += ["destructive_intent" / "approval_sensitive" /
                   "mutating_capability" / "high_risk_capability"]

else if profile.wants_programmatic_logic
     && evidence.has_programmatic_executor
     && (!wants_analysis || has_batch_scope)
    → Worker
       reason = "programmatic_logic"

else if evidence.single_direct_callable
    → Direct, reason = "single_direct_callable"

else heuristic fallback ladder
```

Flags parsed by `TaskProfile::from_query`:
- `wants_programmatic_logic` / `wants_analysis` / `has_batch_scope` / `wants_single_action` — natural-language intent classification
- `destructive_intent` — delete / overwrite / reset keyword detection
- `approval_sensitive` — external side-effect detection
- `explicit_route` — user literally says "use worker / direct"

### 4.2 Custom task agent override

[`control_plane.rs::maybe_override_route_with_custom_task_agent_query_vector`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs):

| Condition | Behaviour | reasons |
|---|---|---|
| User explicitly `@<task-agent-id>` | Force `Worker` | `["explicit_task_agent", invocation_kind]` |
| Base decision is `Direct` with reason `"single_direct_callable"` | Upgrade to `Worker` | `["custom_task_agent_override"]` or `["custom_task_agent_override", "image_agent"]` |

Both reasons are **safety locks** (see §4.4).

### 4.3 Prior + bandit fusion formula

[`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs):

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0; // 21-day half-decay
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
const ROUTE_BANDIT_COEFF: f64       = 0.25;

direct_score = (1.0 if base == Direct else 0.0)
             + direct_prior_weight              // task_policy_priors table, 21-day half-decay
             + 0.25 * bandit_direct_score       // BANDIT_SCENE_TASK_ROUTE sampling
worker_score = (1.0 if base == Worker else 0.0)
             + worker_prior_weight
             + 0.25 * bandit_worker_score
```

Override fires only if (4 ANDed conditions):

```text
!decision_has_safety_lock(base)
&& has_signal                                   // prior or bandit has data
&& preferred_route != base.route                // really wants to flip
&& |direct_score - worker_score| >= 0.35        // gap is large enough
```

**Why `ROUTE_BANDIT_COEFF = 0.25` and `ROUTE_OVERRIDE_THRESHOLD = 0.35`**: the bandit's maximum contribution alone is 0.25 (one side 1, the other 0), so it can **never cross 0.35** — meaning **the bandit can never override on its own**; it can only ride with the prior. This is the core invariant from [bandit-architecture.en.md §1](./bandit-architecture.en.md#1-tldr).

### 4.4 Safety-lock list

[`task_learning/policy.rs::decision_has_safety_lock`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs): if reasons contain any of the following, the decision is locked — **neither prior nor bandit can flip it**:

| reason | Source | Meaning |
|---|---|---|
| `explicit_route` | User literally specifies | Do not touch |
| `explicit_task_agent` | User `@<task-agent>` | Do not touch |
| `destructive_intent` | NLP detects delete/overwrite keywords | Must go Direct + approval |
| `approval_sensitive` | Sensitive operation detected | Must go Direct |
| `mutating_capability` | Pending capability includes write op | Must go Direct |
| `high_risk_capability` | Hits the HIGH-risk tool list | Must go Direct |

Other non-lock reasons (such as `"programmatic_logic"` / `"single_direct_callable"` / `"fallback_worker"`) are **allowed** to be flipped by the prior.

### 4.5 Desktop-level post-processing

[`desktop_runtime::apply_desktop_execution_policy_overrides`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs): reads the `workflow.route_worker_through_workflow` desktop config and can set `policy.prefer_workflow_runtime` to true — this controls whether the worker handler goes through the Workflow engine or directly previews a CustomTaskAgent (see §7).

## 5. Shared orchestration pipeline (8-step engine)

[`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs).

**Critical**: **Direct and Worker run exactly the same pipeline** — all 8 steps, every time. Route decision is a byproduct of one of them. It is not "Direct skips orchestration."

The engine itself is a generic Kahn-topological executor: `LocalOrchestrationEngine<C: StepResultContext>`, sorted into layers by `depends_on` (`execution_layers: Vec<Vec<String>>`). If a layer has >1 steps and the context supports a snapshot, the layer runs concurrently via `try_join_all`, then `validate_layer_results` rejects conflicting `ContextPatch` writes.

8-step dependency graph:

```text
summary_injection
      │
      ▼
persona_prompt_injection
      │
      ▼
context_manifest                ← Context Orchestrator entry
      │
      ▼
generated_artifact_context_injection
      │
      ▼
route_selection                 ← § 4 — produces route + policy
      │
      ▼
skill_recipe_injection
      │
      ▼
prompt_variant_selection        ← router:prompt bandit scene
      │
      ▼
template_render                 ← merges system messages, renders prelude
```

| # | Step | File | What it does |
|---|---|---|---|
| 1 | `SummaryInjectionStep` | `workflow.rs` | Prepends `[SUMMARY]` from stored conversation summary |
| 2 | `PersonaPromptInjectionStep` | `workflow.rs` | Injects `chat.persona_prompt` desktop config |
| 3 | `ContextManifestStep` | `local_orchestrator/retrieval.rs` | Writes the Context Manifest (memory tier listings / selected-knowledge overview / `context_*` tool advert); resolves query embedding. See [rag-architecture.en.md](./rag-architecture.en.md) |
| 4 | `GeneratedArtifactContextInjectionStep` | `workflow.rs` | When the user has re-selected a generated Office artifact, injects `## Active Generated Artifact` |
| 5 | **`RouteSelectionStep`** | `workflow.rs` | The whole of §4. Writes `task_fingerprint` / `route_decision` / `execution_policy`; emits `runtime.route.selected` |
| 6 | `SkillRecipeInjectionStep` | `workflow.rs` | Parses `$skill-mention` tokens; merges `discovery.skill_recipes`; renders `## Installed Skills` system block with `activate_skill(...)` next-step hints |
| 7 | `PromptVariantSelectionStep` | `workflow.rs` | Picks between `"detailed" / "concise"` via the **`router:prompt` bandit scene**; injects `## Response Style` |
| 8 | `TemplateRenderStep` | `workflow.rs` | Calls `build_local_control_plane_result(...)` to assemble the final `LocalControlPlaneResult` (router prompt + prelude messages + `current_date / timezone / response_language`); prepends `prelude_messages` |

**ContextPatch variants** ([`workflow.rs::ContextPatch`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)):

- `PrependMessages` / `SetRuntimeDiscovery` / `SetRouteDecision` / `SetExecutionPolicy` / `SetControlPlaneResult` / `SetSelectedPromptVariant` / `SetTaskFingerprint` / `SetRequestQueryEmbedding` / `EmitStatus`

After 8 steps, `LocalWorkflowContext` holds:
- The rendered `messages: Vec<LocalChatInputMessage>`
- The final `route_decision: LocalRouteDecision`
- The full `execution_policy: LocalExecutionPolicy`
- `selected_prompt_variant` (for feedback later)
- `request_query_embedding` (used by `context_*` tools inside the agentic loop)

Next step packages them into a `LocalExecutionRequest` and hands it off to `run_local_execution_plane`.

## 6. Direct Plane in detail

[`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) → `LocalExecutionHandlerKind::from_policy(&policy)` → `LocalExecutionPlane::ResponseOnly` → `direct_handler::run_direct_execution_handler` → `run_policy_scoped_chat_completion(request, None /* no delegated */, emit_status)` → `run_local_chat_complete_with_tools(...)`.

The Direct handler is a **thin shell** — all it does is "run the agentic loop with the ResponseOnly policy."

### 6.1 Tool surface (the critical difference)

[`tool_catalog.rs::build_local_runtime_tools_with_allowlist`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) filters via `policy.effective_allowed_tool_names(capability_snapshot)`.

| Policy | allowlist source | Contains |
|---|---|---|
| `ResponseOnly` (Direct) | `resident_capability_control_tool_names()` ([`mcp-runtime/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs)) | `search_sdk`, `activate_skill`, `read_skill_resource`, `terminal_context_peek/read/pack`, `context_search/open/expand/summarize_evidence` |
| `WorkerReasoning` (Worker) | `full_execution_tool_names()` | The above + `diting_think` (round-1 only), `delegate_task`, `execute_code_plan`, `run_local_code_snippet`, `attach_capability` / `detach_capability`, `query_task_policy`, `sys_submit_onboarding_request`, `refresh_skill_index`, `monitor.*`, all `browser_*`, all `write_*` / `inspect_*` / `patch_*` document tools, plus dynamic MCP/Skill |

**In Direct mode, the model physically cannot see `delegate_task`** — it is not in the `tools[]` array sent to the provider. This is engineering discipline, not prompt-side restraint.

There is also `policy.inject_execution_protocol`: `false` for Direct, `true` for Worker — the latter prepends a "Desktop Execution Tools" system note, telling the model multi-step execution is allowed.

### 6.2 Agentic loop

[`chat_tool_runtime/mod.rs::continue_local_chat_complete_with_tools`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs), advancing one round at a time:

```text
loop {
    state.round += 1
    if state.round > max_rounds:
        return build_max_rounds_exceeded_response(state)   // LOCAL_CHAT_MAX_ROUNDS_EXCEEDED

    effective_allowed = policy.effective_allowed_tool_names(last_capability_snapshot)
    tools = build_local_runtime_tools_with_allowlist(effective_allowed, snapshot)
    if round == 1 && !state.diting_think_consumed:
        tools = inject_diting_think_tool(tools)            // round-1 reasoning gate

    response = request_provider_chat_completion(messages, tools, ...)
    runtime_metrics.observe_response(&response)

    if extract_chat_tool_calls(&response).is_empty():
        return enrich_response_with_tool_trace(state, response)   // terminal: model emits final answer

    match process_chat_tool_calls(...) {
        Completed { ... }   => continue,
        Interrupted { approval_tokens, ... } => suspend (see §6.5)
    }
}
```

**Round budget**: `max_rounds` is read from desktop config `MAX_AGENTIC_ROUNDS_CONFIG_KEY`, parsed by [`desktop_config::parse_max_agentic_rounds`](../deeting/src-tauri/src/modules/desktop_config). Exceeding it terminates with `LOCAL_CHAT_MAX_ROUNDS_EXCEEDED`.

### 6.3 The `diting_think` round-1 reasoning gate

**Injected only in round 1; once consumed, permanently removed from `tools[]`**:

- Injection point: when `tools` is rendered, append only if `round == 1 && !diting_think_consumed`.
- Consumption point: `process_chat_tool_calls` hits `tool_name == DITING_THINK_TOOL_NAME`, calls `format_diting_think_reasoning(arguments)` to render structured `[Intent] / [Context] / [Plan] / [Constraints]` reasoning into `state.captured_reasoning`, and sets `state.diting_think_consumed = true`.
- For every subsequent round, `inject_diting_think_tool` no longer appends it.

**Why**: in Worker mode with its wide tool surface, force the model to do a structured "thought sweep" before picking tools — so it does not blindly invoke `delegate_task` or `execute_code_plan` on round 1. In Direct mode the surface is already narrow, so `diting_think` has lower value but the model is still allowed to call it.

### 6.4 Tool dispatch (the big match)

`process_chat_tool_calls` for each tool_call:

1. **Name normalization**: `resolve_provider_tool_name_for_execution` → `canonicalize_tool_name_for_allowed_list`
2. **call_id resolution**: `resolve_local_tool_call_id`
3. **Allowlist check**: if not in `effective_allowed_tool_names` → synthesize `LOCAL_TOOL_POLICY_BLOCKED` error
4. **Persist Running**: `persist_running_tool_execution_runtime(... InFlightExecutionStage::ToolRunning ...)`
5. **Branch on name** (excerpt):

| Tool | Dispatch function |
|---|---|
| `diting_think` | Synchronously synthesize structured reasoning, mark consumed |
| `terminal_context_*` / `terminal_write_input` | `execute_terminal_context_tool(...)` |
| `context_search/open/expand/summarize_evidence` | `execute_context_tool(...)` |
| `execute_code_plan` | Pass through `DecisionLocus::Execution` policy gate, validate `CapabilityExecutionContract::from_search_result`, run `execute_code_mode_request(...)` bridging sandbox streams |
| `run_local_code_snippet` | `app_state.sandbox.manager.run_local_code_snippet_with_prepare_config(...)` |
| `search_sdk` | `build_local_sdk_search_result_bundle_with_feedback_runtime(...)`, writes `last_capability_snapshot` |
| `activate_skill` / `read_skill_resource` | Updates `state.active_skill_context` |
| **`delegate_task`** | `execute_delegate_task_tool(...)`, see §7.3 |
| `query_task_policy` | `Self_::consult_named(store, decision_point, query, limit)` |
| `attach_capability` / `detach_capability` | Mutates `state.active_capability`; emits `LocalCapabilityTransition` |
| `sys_submit_onboarding_request` | Creates assistant / installs skill / creates custom task agent |
| `refresh_skill_index` | Rescans local skill directories |
| Default (MCP / Skill dynamic) | `execute_or_queue_mcp_tool_call_with_tool_ref(...)` — goes through Approval Gate |

6. **Result synthesis / cleanup**: if `tool_call_meta` is missing rows → `LOCAL_TOOL_RESULT_MISSING`; if no approval token was produced → `clear_execution_graph_runtime_context(...)` clears the Running row.

### 6.5 Approval Gate suspend and resume

The MCP tool branch inspects `tool_result.status == "REQUIRES_APPROVAL"`. Once hit:

1. `approval_tokens.push(token)`, meta tagged `"status": "requires_approval"`.
2. The inner `process_chat_tool_calls` returns `LocalToolCallProcessingOutcome::Interrupted { approval_tokens, tool_call_meta, results, ... }`.
3. The outer main loop:
   - `canonicalize_tool_call_meta_via_graph(...)` aligns meta to the DAG.
   - Builds [`SuspendedChatToolExecution::from_state(...)`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/suspended.rs) — snapshots `max_rounds / round / trace_id / execution_policy / model_connection / orchestrated_messages / task_query / active_capability / active_skill_context / runtime_metrics / last_response / last_capability_snapshot / pending_approvals / selected_knowledge_file_ids` + the frozen `execution_graph`.
   - `build_pending_approval_records_from_tool_call_meta(...)` → `Vec<PersistedPendingApproval>` (token / tool_id / tool_name / arguments / risk_level / risk_reasons / tool_fingerprint / policy_rule_key / approval_grant_key / graph node ids / created/expires_at_unix_ms).
   - `persist_suspended_execution_graph_runtime(... InFlightExecutionStage::WaitingApproval, ...)` writes to SQLite.
   - Returns — the loop is now paused.

The full state machine, cross-process recovery, and UI projection are covered in [agent-dag-architecture.en.md](./agent-dag-architecture.en.md).

## 7. Worker Plane in detail

[`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) → `LocalExecutionPlane::WorkerReasoning` → `worker_handler::run_worker_execution_handler`.

The Worker handler is more complex than the Direct one: it may **automatically** spin up a CustomTaskAgent / Workflow subtask *before the model has even spoken*, wait for the child to return, and then let the parent chat completion integrate the result.

### 7.1 Handler entry

[`worker_handler.rs::run_worker_execution_handler`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs):

```text
delegated_execution = maybe_delegate_worker_to_custom_task_agent(request, emit_status)?

if delegated_execution.is_running():
    // async child — handler returns trace blocks immediately;
    // recovery wakes the parent later
    return trace_blocks
else:
    // sync child (already finished) or no delegation
    return run_policy_scoped_chat_completion(request, delegated_execution, emit_status)
```

### 7.2 Auto-delegate vs model-initiated delegate

Worker plane has **two delegation paths**. **Do not conflate them**:

**Path A: auto-delegate (before handler entry)**

`maybe_delegate_worker_to_custom_task_agent` only fires when `policy.allow_worker_delegation == true` (i.e. Worker plane). Logic:

1. Calls [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) to rank profile candidates by prior + bandit + skill match. Hits `BANDIT_SCENE_WORKER_SELECTION`.
2. If the score exceeds threshold → start the child directly. **The model never saw a tool surface this turn** — its output is the integrated answer after the child completes.
3. This path serves high-certainty cases: explicit `@<task-agent>` or strong-matching single callable.

**Path B: model-initiated delegate (inside the loop)**

Worker plane's `tools[]` includes `delegate_task`. After `diting_think`, the model may choose to delegate:

- Call site: `chat_tool_runtime/mod.rs::execute_delegate_task_tool`
- Shares `select_worker_custom_task_agent` with path A
- Shares `WorkerTaskPacket` with path A
- The only difference is **timing**: A fires at handler entry; B fires mid-loop

### 7.3 CustomTaskAgent child runtime

[`worker_dispatch.rs::build_worker_task_packet`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) builds the `WorkerTaskPacket`:

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
    packet_hash: String,                              // self-check
}
```

Child runtime entry: [`custom_task_agents/runtime.rs::preview_custom_task_agent_with_parent_model`](../deeting/src-tauri/src/modules/custom_task_agents/runtime.rs).

**Preflight rejection**: if the chosen profile is `Chat` invocation AND both `callable_mcp_tool_ids` and `callable_skill_action_refs` are empty → return `Failed { reason: "missing_executable_surface", suggested_action: reconfigure_agent }` immediately. **The child never starts.** This prevents misconfigured agents from burning an entire LLM round.

**Child tool binding** ([`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)):

- `load_callable_skill_actions(app_state, profile.callable_skill_action_refs)` → `HashMap<String, ResolvedSkillAction>`
- `profile.callable_mcp_tool_ids` → `HashMap<String, McpTool>`
- `builtin_callables`: `diting_think` (round-0 only), `llm_wiki_search_corpus` (**only visible inside LLM Wiki maintainer agents**), etc.
- Output: `tool_payload: Option<Value>` (OpenAI-compatible `tools[]`) + `bindings_by_provider_name` (reverse-lookup from provider name to MCP/Skill instance)

**Child round budget**: `MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS = DEFAULT_MAX_AGENTIC_ROUNDS` — same value as the parent, but **independently counted**.

### 7.4 Workflow engine path (optional branch)

If `policy.prefer_workflow_runtime == true` (driven by `workflow.route_worker_through_workflow` desktop config) AND `profile.invocation_kind == Chat`, the handler takes a different path:

[`workflow_service::prepare_quick_workflow_run`](../deeting/src-tauri/src/modules/workflow/service.rs) → async `start_workflow_run` → returns `DelegatedExecutionSession { state: Running, ... }`.

The Workflow engine is **independent**:

- State machine: `WorkflowRunStatus { Draft, Ready, Running, WaitingApproval, AwaitingPlanEdit, Completed, Failed, Cancelled }` + `WorkflowStepStatus { Pending, Ready, Running, WaitingApproval, Succeeded, Failed, Skipped, Obsolete, Invalidated }`
- Step types: `WorkflowStepType { WorkerCall, ApprovalGate, Finalize }`
- Service entry: [`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs) — proposal / regenerate / re-run-phase
- Scheduler: [`workflow/scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs)
- Worker adapter: [`workflow/worker_adapter.rs::execute_via_worker_profile`](../deeting/src-tauri/src/modules/workflow/worker_adapter.rs) — drops the step onto the matching custom task agent; consumes `context_packet.worker_task_packet`
- Persistence: [`workflow/store/`](../deeting/src-tauri/src/modules/workflow/store/) — run / step / event / artifact / checkpoint, four tables

On this path, the parent handler persists an `InFlightExecutionStage::DelegatedWorkflowRunning` row with the embedded chat runtime context. The parent loop suspends. After the child workflow completes, `recovery.rs::wake_delegated_runtime_for_workflow_run` resumes the parent.

### 7.5 `delegated_result` integration

After the child (CustomTaskAgent or Workflow) finishes, the handler gets a canonical [`DelegatedExecutionRecord`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs):

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

`record.delegated_result()` outputs a JSON envelope conforming to `DELEGATED_RESULT_SCHEMA_VERSION = 1`.

Integration into the parent is done by `build_delegated_result_feedback_messages(&record)`:

1. Appends a `system` message — "the next user message is a canonical `delegated_result` JSON; authoritative when status = Succeeded/Integrated".
2. Appends a synthetic `user` message whose content is the JSON-serialized `delegated_result`.

The parent chat completion **runs one more round** on this extended message list — this is the model's window to integrate / summarize / decide the next step.

**Exception**: when invocation kinds like `image_generation` / `text_to_speech` are user-explicit and the answer is itself the deliverable (`should_return_delegated_result_directly == true`), the handler skips the extra round and returns the child's rendered blocks as the answer.

## 8. Boundaries and invariants

### 8.1 Orchestration is shared

```text
Both planes share:
- LocalOrchestrationEngine 8-step pipeline
- ContextManifest (context_* tool advert)
- SkillRecipeInjection
- PromptVariantSelection (router:prompt bandit)
- TemplateRender
- chat_tool_runtime main loop scaffolding
- diting_think round-1 gate (more useful in Worker, but visible in Direct too)

Both planes differ in:
- Tool allowlist (resident vs full)
- inject_execution_protocol (false vs true)
- allow_worker_delegation (false vs true)
- The handler code that actually runs
```

### 8.2 Direct cannot spawn worker children

`delegate_task` is **not** in `resident_capability_control_tool_names()`. In Direct mode, even if the model wanted to delegate, it could not — the provider will not be given the tool in `tools[]`.

The only way for a conversation to switch from Direct to Worker is for `apply_route_prior` to flip the decision **before the agentic loop starts** in the 8-step pipeline — and even then, prior + bandit must add up to a 0.35+ gap, and the base decision must not carry a safety lock. This flip happens **before** the agentic loop, never mid-loop.

### 8.3 Worker must orchestrate first

The Worker handler **never** bypasses the 8-step pipeline to go straight into an agentic loop. Even path A (auto-delegate) only fires after all 8 steps have completed and a full `execution_policy` has been produced.

### 8.4 `delegated_result` is the only integration channel

Child-to-parent integration has only one allowed path: build the canonical `delegated_result` envelope → stitch into `system + user` two messages → parent runs one more round. Children **may not** directly mutate the parent's `messages`, `captured_reasoning`, `active_capability`, etc.

## 9. Persistence and cross-process recovery

Relies on the execution-graph model in [agent-dag-architecture.en.md](./agent-dag-architecture.en.md); here we only list the dual-plane-relevant points.

`InFlightExecutionStage` covers every suspend state across both planes:

| Stage | Trigger |
|---|---|
| `ToolRunning` | Any tool currently running |
| `WaitingApproval` | Direct or Worker may hit — an MCP tool returned `REQUIRES_APPROVAL` |
| `ResumingAfterApproval` | User approved; resuming |
| `ResumeFailed` | Recovery failed |
| `DelegatedWorkflowRunning` | Worker plane on Workflow path with a child workflow in flight |
| `Interrupted` | Other interruptions |

Cross-process recovery entry: [`chat_tool_runtime/recovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs):

- `recover_inflight_local_execution_state(_app, app_state)` — boot-time scan of every in-flight row
- `wake_delegated_runtime_for_workflow_run(...)` — wakes the parent after a workflow completes
- `resume_delegated_runtime_after_custom_task_agent_run(...)` — wakes the parent after a CustomTaskAgent completes
- `resume_suspended_chat_tool_execution_after_approval(...)` — resumes after approval
- `recover_local_chat_execution_from_action(...)` — unified front-end entry for resume / retry / cancel commands

## 10. Feedback loop (evaluation + learning)

After the 8-step pipeline and the chosen handler complete, [`local_orchestrator.rs::execute_local_orchestrated_chat`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs) runs a postprocess stage.

### 10.1 Evaluator

[`task_learning/evaluator.rs::evaluate_task_learning_with_runtime`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) scores four dimensions per turn (each dimension has a fixed enum so bandits can consume directly):

| Score | Enum |
|---|---|
| `route_judgment` | `good` / `acceptable` / `wasteful` / `wrong` |
| `worker_selection_judgment` | `success` / `partial` / `blocked` / `unstable` / `failed` |
| `discovery_judgment` | `sufficient` / `shallow` / `excessive` / `skipped_when_needed` |
| `execution_judgment` | (specific to the `execution` decision point) |

Heuristic + constrained-LLM judge (strict JSON schema, fixed enums) score in parallel, with confidence-weighted averaging — defends against single-signal hallucination. See [self-evolution-architecture.en.md §7](./self-evolution-architecture.en.md#7-evaluation-pipeline-evaluator).

Special-case detection: e.g. **route = worker but no delegation and no tool call** → `route_judgment = "wasteful"` — next turn with the same fingerprint, the prior pulls back toward Direct.

### 10.2 Persist prior + bandit feedback

`store.record_task_learning_run(...)` writes a `task_learning_runs` row (with outcome / attribution / policy_delta). Then:

1. If `evaluation.policy_delta.is_some()` → `apply_policy_delta(store, fingerprint_key, delta, ...)` writes a signed magnitude (`strengthen / positive` is positive; `weaken / negative` is negative) into the `task_policy_priors` table.
2. `record_task_learning_bandit_feedback(...)` writes 3 bandit scenes:
   - `BANDIT_SCENE_TASK_ROUTE` — arm = `direct/worker`, success ← `route_judgment_to_success(route_judgment)`
   - `BANDIT_SCENE_WORKER_SELECTION` — arm = `delegated.selected_profile_id`, success ← `worker_selection_judgment_to_success(...)` (only if delegation actually happened)
   - `BANDIT_SCENE_MEMORY_RECALL` — only if `memory_explore_arm_id` was set; scored by `discovery_judgment`
3. `router:prompt` bandit ([`local_orchestrator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs)) — arm = `"detailed" / "concise"`, scored by latency / success.

See [bandit-architecture.en.md §5](./bandit-architecture.en.md#5-the-three-usage-scenarios).

### 10.3 Posterior signal (follow-up user feedback)

When the next user message arrives (**before the 8-step pipeline runs**), a posterior detection runs against the previous assistant turn's trace_id:

[`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal):

- `PosteriorSignalKind { Accepted, Corrected, Rejected, Unknown }`
- `rules.rs` — phrase heuristics (negation, correction phrases, follow-up patterns)
- `resolver.rs::should_apply_posterior_signal` — fires only when `kind != Unknown && confidence >= 0.5`

If applicable → `apply_task_learning_revision(store, run_id, signal, "followup_user_message", note)` **retroactively revises the previous turn's prior** — this is the "user corrected after the fact" feedback channel.

See [self-evolution-architecture.en.md §10](./self-evolution-architecture.en.md#10-posterior-signal).

## 11. File map

| I want to… | Look here |
|---|---|
| Change the route heuristics | [`mcp-runtime/route.rs::select_local_route_with_evidence`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs) |
| Change plane / policy construction | [`mcp-runtime/policy.rs::build_local_execution_policy`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) |
| Change prior + bandit override formula | [`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| Change the safety-lock list | Same file, `decision_has_safety_lock` |
| Change the 8-step pipeline | [`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) |
| Change the Direct handler | [`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs) |
| Change the Worker handler / auto-delegate | [`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs) |
| Change the agentic loop | [`chat_tool_runtime/mod.rs::continue_local_chat_complete_with_tools`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| Change the tool allowlist | [`tool_catalog.rs::build_local_runtime_tools_with_allowlist`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) |
| Change `delegate_task` behaviour | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` |
| Change worker selection | [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) |
| Change the worker task packet schema | Same file, `WorkerTaskPacket` |
| Change child agent tool binding | [`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs) |
| Change the Workflow engine | [`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs) + [`scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs) |
| Change the `delegated_result` envelope | [`execution_plane.rs::DelegatedExecutionRecord::delegated_result`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) |
| Change evaluator scoring | [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| Change the posterior signal | [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal) |

## 12. Anti-patterns (reject in PR review)

| Anti-pattern | Why it is rejected |
|---|---|
| Adding `delegate_task` to the Direct allowlist | Blurs the "one-shot vs orchestrate" semantic boundary; the prior-learning target collapses |
| Adding a fast path outside the 8-step pipeline (straight to agentic) | Scatters mode selection out of the explainable RouteSelectionStep; persistence and posterior signals break |
| Raising `ROUTE_BANDIT_COEFF` to let the bandit override on its own | See [bandit-architecture.en.md §9](./bandit-architecture.en.md#9-design-constraints-reject-during-pr-review) |
| Removing / adding a safety-lock reason without updating the evaluator | Safety locks are no-flip conditions; the evaluator uses them to label `wasteful` — both sides must stay in sync |
| Letting a child agent directly mutate the parent `state` | Breaks the `delegated_result` envelope invariant; recovery chain collapses |
| Adding a "bypass chat_completion and return delegated output directly" path in the Worker handler, skipping the `should_return_delegated_result_directly` check | Parent conversation coherence is lost; evaluator can't see the real path |
| Manually injecting Worker tools into Direct mode for "debugging" | Tool surface is policy-bound; debug with Worker plane + `attach_capability` instead |
| Adding a third plane (e.g. `HybridReasoning`) | Do not — before adding new kinds, prove they do not overlap with the existing two; a fuzzy middle state only thins out the prior learning surface |
| Making any of the 8 steps optional / conditional | The parallel + topology structure assumes every step runs; conditional skips create inconsistent ContextPatch views downstream |

## 13. Verification checklist

PRs touching dual-plane / route / handler must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib mcp_runtime::route --no-fail-fast`
- [ ] `cargo test --lib mcp_runtime::policy --no-fail-fast`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib local_orchestrator --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib worker_handler --no-fail-fast`
- [ ] `cargo test --lib execution_plane --no-fail-fast`
- [ ] Key invariants still green:
  - `apply_route_prior_bandit_scores_surface_on_application` (bandit cannot flip on its own)
  - `direct_policy_does_not_contain_delegate_task` (Direct allowlist excludes worker delegation tools)
  - `safety_lock_reasons_block_prior_override` (safety lock is effective)
  - `delegated_result_schema_version` (envelope schema version)
- [ ] Manual desktop tests:
  - Explicit `@<task-agent>` → goes Worker plane + auto-delegate path A immediately
  - Explicit "please delete file X" → triggers `destructive_intent` safety lock, forces Direct + approval
  - Repeatedly running the same clear worker task → prior should slowly pull toward worker
  - Model picking the wrong worker in Worker mode repeatedly → cooldown should kick in
  - Approval suspend, process killed → after restart, should resume from SuspendedChatToolExecution
  - Workflow path long task → parent suspends; after workflow finishes, `wake_delegated_runtime_for_workflow_run` resumes parent

## 14. FAQ

**Q: Why not let the model decide the plane itself?**
A: Model decisions are unstable + not explainable; the prior learning surface gets shredded across tool dimensions rather than at the mode dimension. Lifting plane choice to the orchestration layer puts the "business boundary" back into engineers' hands.

**Q: Isn't `diting_think` "letting the model decide the plane"?**
A: `diting_think` is "letting the model lay out its thinking **after** the plane is decided" — not letting it choose the plane. The 8-step pipeline has already decided Worker; `diting_think` only helps the model decide **which tool / who to delegate to**.

**Q: Can Direct plane call `context_*` tools? Does that count as "orchestration"?**
A: Yes it can. `context_*` are retrieval tools, not orchestration tools — they return evidence envelopes; they do not spawn subtasks. Direct still means one-shot.

**Q: If Worker plane auto-delegates and the child performs badly (`worker_selection_judgment = blocked`), what happens next time?**
A: Bandit scene 2 records a failure feedback for that profile arm; consecutive failures → cooldown (see [bandit-architecture.en.md §6](./bandit-architecture.en.md#6-cooldown-and-failure-protection)); the prior is also gradually down-weighted via `policy_delta`.

**Q: Why can't the 8-step pipeline be skipped on short conversations?**
A: It can't. `ContextManifestStep` decides which context tools the model sees; `RouteSelectionStep` decides which plane; `TemplateRenderStep` decides what the system prompt looks like — skipping any step makes `LocalControlPlaneResult` incomplete, and downstream handlers won't have the required fields. The "short-conversation overhead" is not an issue: 8 steps run in parallel typically in <50ms.

**Q: Can we add "progressive upgrade" between planes — e.g. detect complexity rising mid-Direct-loop and switch to Worker?**
A: **No.** That blurs the plane boundary and breaks prior learning. The correct response is: if the model in a Direct loop finds the task is more complex than expected, it should return a final answer and let the user re-issue the question — next turn the prior will pull this fingerprint toward Worker.

**Q: Doesn't auto-delegate feel like "starting work before the user even spoke"?**
A: Auto-delegate **only fires on high-certainty path-A conditions** (explicit `@<task-agent>` / strong-matching single callable). Everything else goes path B — the model first does `diting_think` and then decides. The UI shows "auto-delegated to X" in the `runtime.route.selected` + `runtime.execution.handler.selected` status events.

**Q: What's the difference between the Workflow engine and the 8-step orchestration? Both are called "workflow".**
A: They are unrelated:
- The 8-step orchestration engine is an **in-process pipeline for a single conversation turn** — it does prompt assembly.
- The Workflow engine is a **multi-step resumable task runtime** — supports human approval, plan editing, per-phase rerun, cross-restart resume. The Worker plane only invokes it when `prefer_workflow_runtime` is on.

**Q: Can we use the provider's native function calling mode for plane selection?**
A: No. Provider function calling implementations vary widely, are not explainable, and are not learnable. Deeting's plane decision must stay in the local runtime — `RouteSelectionStep` is the single source of truth.

## 15. References

- Route decision entry: [`local_orchestrator/workflow.rs::RouteSelectionStep`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)
- Base heuristics: [`mcp-runtime/route.rs`](../deeting/src-tauri/crates/mcp-runtime/src/route.rs)
- Policy construction: [`mcp-runtime/policy.rs::build_local_execution_policy`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs)
- Prior fusion: [`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- Plane fork: [`execution_plane.rs::run_local_execution_plane`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs)
- Direct handler: [`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs)
- Worker handler: [`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs)
- Agentic loop: [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
- Worker selection + packet: [`worker_dispatch.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs)
- Child agent tool binding: [`custom_task_agents/bound_callables.rs`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)
- Workflow engine: [`workflow/service.rs`](../deeting/src-tauri/src/modules/workflow/service.rs), [`scheduler.rs`](../deeting/src-tauri/src/modules/workflow/scheduler.rs), [`worker_adapter.rs`](../deeting/src-tauri/src/modules/workflow/worker_adapter.rs)
- Evaluator: [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)
- Posterior signal: [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal)
- Sibling docs: [`agent-dag-architecture.en.md`](./agent-dag-architecture.en.md), [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md), [`rag-architecture.en.md`](./rag-architecture.en.md), [`bandit-architecture.en.md`](./bandit-architecture.en.md), [`memory-architecture.en.md`](./memory-architecture.en.md), [`security-architecture.en.md`](./security-architecture.en.md), [`tool-architecture.en.md`](./tool-architecture.en.md)
