# Desktop Local Runtime Control-Plane / Execution-Plane Migration Plan

**Goal:** Complete the desktop local runtime refactor as a single coherent migration on one branch, so internal discovery, route selection, prompt materialization, tool exposure, and delegated execution stop sharing mixed responsibilities.

**Scope:** `deeting/src-tauri/src/modules/mcp/local_orchestrator.rs` and `deeting/src-tauri/src/modules/mcp/commands/runtime/*`

**Migration Strategy:** Do the remaining work as a **branch-scoped whole migration** with one final cutover, not as prolonged incremental coexistence. Intermediate commits may exist locally, but merge only after the full target architecture and verification matrix are complete.

---

## 1. Problem Statement

Current runtime behavior is already partially improved, but several responsibilities are still too close together:

- internal runtime discovery and prompt assets still share one bundle shape;
- `local_orchestrator.rs` still owns too much prompt/materialization logic;
- execution behavior is policy-driven in code mode, but not yet expressed as a first-class execution adapter boundary;
- route, prompt, and tool semantics can still drift if future changes bypass policy.

The main architectural rule for the migration is:

> **Internal discovery is control-plane state; model-visible tool use is execution-plane behavior.**

---

## 2. Target Architecture

### 2.1 Control Plane

Owns only planning-time and preparation-time concerns:

- runtime discovery
- route evidence extraction
- route selection
- execution policy derivation
- prompt asset selection
- prompt plan materialization
- status metadata for route/policy decisions

### 2.2 Execution Plane

Owns only runtime execution concerns:

- provider chat completion
- tool allowlist enforcement
- tool-call execution round trips
- code mode orchestration loop
- worker delegation execution
- active capability attach/detach lifecycle

### 2.3 Thin Orchestrator

`local_orchestrator.rs` should end as a coordinator with two explicit boundaries:

1. `build_local_control_plane_result(...)`
2. `run_local_execution_plane(...)`

It should stop being the place where route, prompt, and execution details are all assembled inline.

---

## 3. Canonical Runtime Contracts

The migration should converge on these canonical objects.

### 3.1 `RuntimeDiscoveryBundle`

Keeps raw discovery facts only:

- `capabilities`
- `recipes`
- `orchestration_primitives`
- `route_evidence`
- optional raw snapshot for trace/debug only

### 3.2 `PromptAssets`

New object. Extract prompt-oriented material from discovery/runtime state:

- selected skill recipes
- active capability hints
- persona prompt contribution
- semantic memory contribution
- route prompt contribution
- optional prompt variant metadata

### 3.3 `LocalExecutionPolicy`

Already introduced; becomes the only source of truth for:

- selected execution plane
- allowed tool names
- code mode protocol injection
- worker delegation permission
- approval-sensitive execution restrictions

### 3.4 `LocalControlPlaneResult`

New object returned by control plane assembly:

- `route_decision`
- `execution_policy`
- `runtime_discovery`
- `prompt_assets`
- `prompt_plan`
- `status_meta`

### 3.5 `LocalExecutionRequest`

New execution-plane input object:

- provider/model connection
- final orchestrated messages
- execution policy
- conversation/runtime context
- tracing/event handles

---

## 4. Target Module Layout

### 4.1 Control-plane side

- keep: `runtime/control_plane.rs`
- keep: `runtime/route_selector.rs`
- add: `runtime/prompt_assets.rs`
- add: `runtime/prompt_plan.rs`

### 4.2 Execution-plane side

- keep: `runtime/code_mode_orchestration.rs`
- add: `runtime/execution_plane.rs`
- possibly add: `runtime/execution_adapters.rs`

### 4.3 Coordinator side

- shrink: `local_orchestrator.rs`

### 4.4 Post-migration ownership rule

- route selection code cannot inject prompt text directly
- prompt builders cannot decide tools directly
- tool execution cannot infer permissions from route directly
- all three must read `LocalExecutionPolicy`

---

## 5. Migration Invariants

These must remain true throughout the branch and must be true at merge time.

1. **Code Mode protocol is injected only when policy says so.**
2. **Tool exposure is derived only from policy allowlists.**
3. **Worker delegation is allowed only when policy says so.**
4. **Route selection consumes evidence, not prompt-side artifacts.**
5. **Prompt materialization consumes prompt assets, not arbitrary raw search JSON.**
6. **Execution plane never re-derives route from user query.**
7. **No module other than control-plane builders constructs route status metadata.**

---

## 6. Forbidden Middle States

The following states are specifically disallowed because they recreate the same confusion we are trying to remove:

- route checks and policy checks both deciding the same behavior in parallel;
- prompt injection reading directly from raw `search_result` blobs;
- execution modules calling tools because a route "usually implies" them;
- worker and code mode sharing one mixed orchestration path without an execution-plane boundary;
- new helper functions that re-introduce `search_sdk` as both infra discovery and model behavior in the same abstraction.

If any migration step requires one of these states, that step should be redesigned.

---

## 7. Whole-Migration Execution Plan

### Phase A: Freeze contracts before further edits

- finalize names and ownership of the canonical objects above;
- stop adding new route-based helpers outside the control plane;
- treat `LocalExecutionPolicy` as mandatory for all new behavior.

### Phase B: Split prompt data from discovery data

- introduce `PromptAssets`;
- move recipe selection, capability hint selection, persona contribution, and route prompt contribution into control-plane builders;
- leave `RuntimeDiscoveryBundle` focused on facts/evidence only.

### Phase C: Move prompt materialization out of `local_orchestrator.rs`

- introduce `prompt_plan.rs`;
- migrate `PromptPlan`, `build_local_prompt_plan(...)`, and prelude assembly into control-plane-owned code;
- make `local_orchestrator.rs` consume a ready-made `prompt_plan` instead of assembling it.

### Phase D: Introduce explicit execution-plane entry

- add `run_local_execution_plane(...)`;
- dispatch by `LocalExecutionPlane` to direct / worker / code-mode adapters;
- make code mode orchestration one adapter, not the implicit default execution path.

### Phase E: Normalize worker/code-mode boundaries

- isolate worker delegation preparation and result stitching into execution-plane code;
- keep direct route as plain completion without hidden code-mode affordances;
- ensure code mode, worker, and direct each have explicit adapter semantics.

### Phase F: Cut over orchestrator to thin-coordinator mode

- `local_orchestrator.rs` should only:
  - collect context
  - call control plane
  - emit control-plane statuses
  - call execution plane
  - merge final response
- remove transitional helpers left from the mixed architecture.

### Phase G: Cleanup and delete obsolete paths

- remove route-only behavior helpers replaced by policy;
- remove prompt assembly logic left in coordinator code;
- remove legacy mixed comments/naming referring to old shared `search_sdk` semantics.

---

## 8. Concrete File Touch Plan

### Required edits

- Modify: `deeting/src-tauri/src/modules/mcp/local_orchestrator.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/control_plane.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/route_selector.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime.rs`
- Add: `deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_assets.rs`
- Add: `deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs`
- Add: `deeting/src-tauri/src/modules/mcp/commands/runtime/execution_plane.rs`

### Likely follow-on edits

- Modify: `activation.rs`
- Modify: `consult.rs`
- Modify: `tool_execution.rs`
- Modify: `tool_resolution.rs`
- Modify: `commands_parts/tests.rs`

---

## 9. Verification Matrix

### Unit / focused Rust tests

- route selection with evidence
- execution policy derivation
- prompt plan includes/excludes code mode protocol by policy
- prompt assets do not require raw search blob access
- tool allowlist filtering
- policy-based tool blocking
- worker delegation gate
- orchestrator ordering: discovery -> route -> prompt plan -> execution

### Targeted commands

Run at minimum from `deeting/src-tauri`:

- `cargo test build_local_execution_policy_ -- --nocapture`
- `cargo test build_local_prompt_plan_ -- --nocapture`
- `cargo test build_route_selection_status_meta_embeds_execution_policy -- --nocapture`
- `cargo test build_local_code_mode_entry_tools_with_allowlist_filters_tools -- --nocapture`
- `cargo test desktop_local_chat_engine_includes_route_selection_before_recipe_and_template -- --nocapture`

Add new focused tests for:

- `prompt_assets`
- `run_local_execution_plane`
- worker/direct/code-mode adapter dispatch

### Merge gate

Do not consider the migration complete until:

- focused tests pass;
- touched runtime files have no diagnostics;
- no remaining route-based behavior bypasses policy;
- `local_orchestrator.rs` is materially smaller in responsibility than before.

---

## 10. Execution Decision

From this point forward, the runtime refactor should be treated as a **planned whole migration**, not as opportunistic incremental cleanup.

That means:

- plan first,
- complete the remaining control-plane and execution-plane boundaries,
- then cut over the orchestrator,
- then run the verification matrix,
- only then consider the architecture split done.