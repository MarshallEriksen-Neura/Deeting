# Monitor Event Stream Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor desktop-local monitor tasks so execution truth flows through a canonical run-event stream, delivery policy becomes task-driven, and the monitor page shifts from dashboard polling to task-and-records audit mode.

**Architecture:** Keep the existing desktop runtime and monitor task-agent execution path, add a monitor run wrapper that projects canonical `RunEvent` records plus delivery planning inputs, then simplify the frontend to consume the persisted run history without dashboard stats polling.

**Tech Stack:** Rust (Tauri desktop runtime, sqlx SQLite), TypeScript/React 19, Next.js App Router, Jest component tests, targeted Rust tests, `cargo test`, `npm test`, `npm run lint`.

---

### Task 1: Add a canonical monitor run-event contract

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`

**Step 1: Write the failing test**

- Add Rust/unit assertions for a typed monitor event structure and event kind serialization.
- Add TS typing/test coverage for execution log `events` shaped as canonical run events instead of raw status blobs.

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`
Expected: FAIL because monitor events are still untyped raw JSON payloads.

**Step 3: Write minimal implementation**

- Introduce `LocalMonitorRunEvent` and `LocalMonitorRunEventKind`.
- Keep JSON persistence shape stable enough for existing logs while emitting canonical fields.
- Update TS monitor execution-log types to match.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`
Expected: PASS

### Task 2: Project wrapper/runtime signals into canonical run events

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/agent_runtime.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/output_contract.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting a run emits:
  - `run_started`
  - at least one `stage_changed`
  - `run_completed` or `run_failed`
- Add a focused test for tool-trace projection into `tool_called` / `tool_succeeded` / `tool_failed`.

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`
Expected: FAIL because current execution still only appends raw status events and tool-trace length summaries.

**Step 3: Write minimal implementation**

- Replace raw `emit_status()` payload accumulation with typed event appends.
- Add wrapper helpers for:
  - start event
  - stage-change event
  - completion/failure event
  - tool-trace projection
- Preserve existing monitor task-agent execution path; do not replace the desktop runtime.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`
Expected: PASS

### Task 3: Introduce task-level delivery policy helpers and route notifications through them

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/mod.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - default notify policy is hydrated when missing
  - change/failure/heartbeat decisions come from delivery-policy evaluation, not direct result branching
  - delivery failures emit `delivery_failed`

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`
Expected: FAIL because current code still directly branches on `is_significant_change` and `force_notify`.

**Step 3: Write minimal implementation**

- Add a small `delivery policy` normalizer over `notify_config`.
- Replace direct notification branching with:
  - build delivery intent from run result/events
  - evaluate task policy
  - dispatch to channel sender
- On sender error, append `delivery_failed` into the persisted run events before surfacing/logging.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`
Expected: PASS

### Task 4: Persist canonical run events in execution logs

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/store.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/monitor/types.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting successful execution logs persist canonical event kinds and preserve completion/failure events.

**Step 2: Run test to verify it fails**

Run: `cargo test monitor --lib`
Expected: FAIL because execution logs still only store raw status payloads.

**Step 3: Write minimal implementation**

- Serialize `LocalMonitorRunEvent` records into `output_data.events`.
- Ensure `record_execution_success` and `record_execution_failure` preserve event ordering.
- Keep schema in the existing `local_monitor_execution_logs` table for this phase.

**Step 4: Run test to verify it passes**

Run: `cargo test monitor --lib`
Expected: PASS

### Task 5: Remove dashboard stats emphasis and auto-polling from the monitor page

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitors-client.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-stats-row.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-execution-log.tsx`
- Modify: `/data/Deeting/deeting/lib/swr/use-monitors.ts`
- Test: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx`

**Step 1: Write the failing test**

- Add/adjust UI tests to prove:
  - stats row is no longer rendered
  - no auto-polling defaults are configured in monitor SWR hooks
  - trigger/edit actions still force local refreshes

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx'`
Expected: FAIL because the page still renders dashboard stats and polling.

**Step 3: Write minimal implementation**

- Remove stats-row rendering from the monitor page flow.
- Remove `refreshInterval` defaults from monitor SWR hooks.
- Keep explicit refresh after local mutations and manual log opening.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx'`
Expected: PASS

### Task 6: Keep the execution log drawer as an audit surface over canonical events

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/monitor-execution-log.tsx`
- Modify: `/data/Deeting/deeting/lib/api/monitors.ts`

**Step 1: Write the failing test**

- Add a UI/unit check that log timeline entries render canonical event kinds instead of raw internal-only codes when available.

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx'`
Expected: FAIL because the drawer still treats events as raw status payloads.

**Step 3: Write minimal implementation**

- Render a stable human-readable event timeline from canonical run events.
- Keep existing summary/failure/tokens sections unless they conflict with the new event structure.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx'`
Expected: PASS

### Task 7: Verification

**Files:**
- Modify set from Tasks 1-6

**Step 1: Run diagnostics**

Run: `cargo test monitor --lib`
Expected: PASS

**Step 2: Run frontend tests**

Run: `npm test -- --runInBand --runTestsByPath '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-task-card.test.tsx' '/data/Deeting/deeting/app/[locale]/dashboard/monitors/components/__tests__/monitor-create-modal.test.tsx'`
Expected: PASS

**Step 3: Run focused lint/typecheck**

Run: `npm run lint -- app/[locale]/dashboard/monitors/components/monitors-client.tsx app/[locale]/dashboard/monitors/components/monitor-execution-log.tsx lib/swr/use-monitors.ts lib/api/monitors.ts`
Expected: PASS

**Step 4: Sanity-check changed Rust files**

Run: `cargo fmt --check`
Expected: PASS or only unrelated pre-existing formatting noise outside touched files.
