# Monitor Task Agent Binding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make desktop-local monitor tasks require a bound existing chat task agent, move execution truth to that bound agent profile, and preserve monitor-specific scheduling, snapshot, notification, and adaptive policy responsibilities.

**Architecture:** Replace the current monitor-owned direct-model execution path with `monitor scheduler -> bound task agent -> structured monitor output adapter`, add hard binding fields and validation to monitor create/update flows, expose bound task-agent selection in the dashboard UI, and keep policy learning as a monitor-level internal overlay instead of a second AI identity.

**Tech Stack:** Rust (Tauri desktop runtime), TypeScript/React 19, Next.js App Router, local SQLite via sqlx, next-intl messages, custom task agent runtime/store, monitor runtime/store, Jest UI tests, targeted Rust tests, `cargo check --lib`.

---

### Task 1: Harden the monitor data contract around required task-agent binding

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`

**Step 1: Write the failing test**

- Add targeted Rust tests asserting:
  - `LocalMonitorTaskCreateRequest` requires `assistant_id`
  - monitor rows cannot be created without a bound assistant id
  - `analysis_mode` and internal policy state have explicit storage shape

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL because the current monitor request/store path still treats `assistant_id` as optional and lacks explicit strategy state fields.

**Step 3: Write minimal implementation**

- Add `assistant_id` to create/update request types.
- Decide whether `model_id` remains as observational output only; do not keep it as an independent config truth.
- Add `analysis_mode` and `policy_state_json` storage fields if needed instead of continuing to overload freeform strategy prompts.
- Make create/update store validation reject empty or missing `assistant_id`.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 2: Validate that only enabled chat task agents can be bound

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/store.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/types.rs` only if helper metadata is needed

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - a disabled task agent cannot be bound to a monitor task
  - a deleted task agent cannot be bound to a monitor task
  - a non-`chat` invocation kind cannot be bound to a monitor task

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`

Expected: FAIL because the current monitor create/update path does not validate task-agent existence or invocation kind.

**Step 3: Write minimal implementation**

- Add a monitor-facing resolver that loads a task agent profile by id.
- Enforce: exists, enabled, not deleted, `invocation_kind == chat`.
- Return clear user-facing errors for invalid bindings.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`

Expected: PASS

### Task 3: Replace the direct-model monitor runtime with bound task-agent execution

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Create: `/data/Deeting/deeting/src-tauri/src/modules/monitor/agent_runtime.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/runtime.rs` only if a reusable helper is needed

**Step 1: Write the failing test**

- Add targeted Rust tests asserting:
  - monitor execution loads the bound task agent instead of building the legacy hardcoded monitor prompt
  - the task agent receives a monitor-specific context packet containing objective, prior snapshot, and analysis mode
  - monitor execution no longer depends on the legacy `build_monitor_prompt()` path for the main run

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL because monitor execution still resolves models directly and invokes the provider chat completion path itself.

**Step 3: Write minimal implementation**

- Add a small monitor-specific adapter around task-agent execution.
- Build a monitor context packet that includes:
  - monitor title
  - monitor objective
  - previous snapshot
  - analysis mode
  - policy overlay
- Execute the bound task agent as the only brain for the run.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 4: Add a structured monitor output adapter and remove freeform result dependence

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Create: `/data/Deeting/deeting/src-tauri/src/modules/monitor/output_contract.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - task-agent execution output is normalized into monitor contract fields
  - invalid freeform text is rejected or downgraded through a clear fallback path
  - logs capture `assistant_id`, `strategy_tag`, and normalized output version

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`

Expected: FAIL because the current parser still treats freeform content/JSON scraping as the main result contract.

**Step 3: Write minimal implementation**

- Add a dedicated normalization layer that produces:
  - `is_significant_change`
  - `change_summary`
  - `new_snapshot`
  - optional `strategy_tag`
  - optional `observations`
- Persist enough metadata to debug whether future failures came from the bound agent, the policy overlay, or the adapter.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`

Expected: PASS

### Task 5: Lift strategy prompts into monitor analysis mode plus internal policy state

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-create-modal.tsx`

**Step 1: Write the failing test**

- Add targeted UI/type tests asserting:
  - monitor creation/edit uses one `analysis_mode` field instead of ad hoc strategy prompt arrays
  - edit hydration restores the selected analysis mode
  - payloads no longer drop strategy configuration on submit

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx'`

Expected: FAIL because current UI stores strategy cards locally but does not submit a stable structured strategy field.

**Step 3: Write minimal implementation**

- Replace strategy prompt arrays with a small high-level `analysis_mode` selector.
- Reserve internal `policy_state_json` for runtime-managed optimization data.
- Keep product copy focused on `精简 / 深度 / 预警优先`, not “策略臂”.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx'`

Expected: PASS

### Task 6: Expose mandatory task-agent binding in the monitor dashboard UI

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-create-modal.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-task-card.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-empty-state.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/monitoring.json`
- Modify: `/data/Deeting/deeting/messages/en/monitoring.json`
- Reference: `/data/Deeting/deeting/lib/api/custom-task-agents.ts`

**Step 1: Write the failing test**

- Add UI tests asserting:
  - monitor create modal cannot submit until a task agent is selected
  - the selector only shows valid chat task agents
  - task cards show the currently bound task agent label

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx' '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx'`

Expected: FAIL because the current modal does not expose any task-agent selector or required binding validation.

**Step 3: Write minimal implementation**

- Load task agents from the existing local task-agent API.
- Filter to valid `chat` task agents.
- Make selection required for create/edit.
- Update copy from “auto hatch a dedicated AI” to “bind an existing task agent”.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx' '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx'`

Expected: PASS

### Task 7: Handle migration and runtime failure states for legacy or broken bindings

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitors-client.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-task-card.tsx`

**Step 1: Write the failing test**

- Add tests asserting:
  - legacy tasks without bindings are surfaced as migration-required
  - tasks bound to disabled/deleted agents are rendered as non-runnable with a repair message
  - resume/trigger paths refuse execution until binding is valid

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`

Expected: FAIL because legacy tasks and broken bindings are not currently represented as dedicated runtime states.

**Step 3: Write minimal implementation**

- Introduce a migration-required or binding-invalid status path.
- Refuse `trigger` / `resume` for invalid bindings.
- Surface actionable UI repair states instead of silent runtime failures.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`

Expected: PASS

### Task 8: Verification

**Files:**
- Test: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Test: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Test: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-create-modal.tsx`
- Test: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-task-card.tsx`

**Step 1: Run targeted Rust verification**

Run: `cargo test monitor --lib`

Expected: PASS

**Step 2: Run targeted Rust compile verification**

Run: `cargo check --lib`

Expected: PASS

**Step 3: Run targeted frontend verification**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx' '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx'`

Expected: PASS

**Step 4: Run a focused manual desktop verification**

Run:

```bash
cd /data/Deeting/deeting
bun run desktop:dev
```

Manual checks:

- create monitor requires choosing an existing chat task agent
- created card shows the bound task agent
- trigger now executes through the bound agent and returns normalized monitor output
- disabled/deleted bound agent surfaces a repairable invalid-binding state

Expected: all checks pass without the old direct-model monitor path being exercised.

Plan complete and saved to `docs/plans/2026-03-25-monitor-task-agent-binding-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
