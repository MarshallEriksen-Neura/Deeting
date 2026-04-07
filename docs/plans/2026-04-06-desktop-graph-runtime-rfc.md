# Desktop Execution Graph Runtime RFC

Date: 2026-04-06

## Summary

This RFC defines the migration from the current round-based desktop local chat runtime to a graph-backed execution runtime.

The goal is not to add another orchestration layer beside the current runtime. The goal is to replace the current suspended-round and round-local tool metadata model with a single graph-native source of truth that can support:

- `direct` and `worker` execution backends under one scheduler
- per-node approval gates instead of single pending-call resume semantics
- deterministic `call_id`-aligned replay
- graph-derived chat, approval, and monitor projections
- later expansion to `handoff`, `subgraph`, and broader DAG scheduling without another runtime rewrite

V1 is intentionally a **round-shaped graph**, not a full free-form DAG. The runtime keeps the current high-level round structure:

`llm_round -> tool/approval nodes -> next llm_round`

but changes the runtime substrate from ad hoc round continuation state into a graph runtime with explicit nodes, edges, events, and scheduler decisions.

This RFC is implementation-ready. It defines the target contracts, migration phases, compatibility boundaries, test matrix, and explicit deletion targets for old runtime state.

`docs/plans/` remains the canonical location for this class of architecture and migration documents. No parallel `docs/plan/` tree will be introduced.

---

## Problem Statement

The current desktop runtime already has real orchestration, approval, replay, and backend split behavior, but the source-of-truth model is still round-local and continuation-driven.

Current constraints and failure modes:

- tool execution is orchestrated out of `code_mode_orchestration.rs`, which already owns too many responsibilities
- approval pause/resume is modeled around suspended chat execution state, not around graph-native node state
- replay depends on `call_id` alignment and ordered tool metadata, but that logic is rebuilt from round-local structures
- `direct` and `worker` already exist as execution-plane variants, but they are not yet modeled as interchangeable backend executors under a single runtime substrate
- any future multi-tool concurrency, multi-approval state, handoff, or monitor transparency work will continue to push more responsibility into the same orchestration file unless the runtime model changes

The design problem is not transport. `fetch + SSE` is only a delivery surface. The real constraint is that the runtime truth is still organized around a suspended round and a single pending continuation path.

This RFC therefore treats the runtime problem as a graph runtime problem, not as a chat-completion transport problem.

---

## Design Principles

### 1. One runtime truth

The graph runtime is the only source of truth for execution state.

The authoritative state must live in graph-native objects:

- `execution`
- `execution_node`
- `execution_event`

Anything else is a projection or adapter output.

### 2. Compatibility is output-only

Existing chat blocks, approval payloads, replay messages, and monitor surfaces may continue to exist temporarily, but they must be derived from graph state. They must not remain independent stores of truth.

### 3. `direct` and `worker` are backends, not runtimes

The system must not evolve into separate direct and worker runtimes. Both remain executor backends selected by scheduler policy on a shared graph substrate.

### 4. Approval is a gate, not a resume trick

Approval must be modeled as an explicit graph gate that blocks dependent nodes. It must not continue to be encoded as "resume the suspended round and splice one tool result back into temporary arrays."

### 5. Preserve replay determinism

The runtime must preserve current replay guarantees:

- assistant tool calls remain aligned to original `call_id`
- replay output is rebuilt in assistant order, not completion order
- missing `call_id` or missing tool output remains a hard error path

### 6. No more primary-file growth

`code_mode_orchestration.rs` is not the long-term integration surface. The graph runtime must be split into smaller modules so the orchestration core stops accreting planner, approval, replay, and projection logic in one file.

---

## Target Runtime Model

### Core entities

#### `execution`

Represents one user-visible desktop local chat execution.

Minimum fields:

- `execution_id`
- `session_id`
- `root_user_message_id`
- `status`
- `created_at`
- `updated_at`
- `active_round`
- optional trace and request correlation metadata

#### `execution_node`

Represents one schedulable or gateable unit inside an execution.

Minimum fields:

- `node_id`
- `execution_id`
- `node_type`
- `status`
- `dependency_ids`
- `input_payload`
- `output_payload`
- `metadata`
- `created_at`
- `updated_at`

#### `execution_event`

Append-only event log for runtime truth projection.

Minimum fields:

- `event_id`
- `execution_id`
- optional `node_id`
- `event_type`
- `payload`
- `created_at`

### Node types

V1 must support these node types:

- `llm_round`
- `tool_call`
- `approval_gate`
- `finalize`

V1 should reserve extension points for later node types:

- `handoff`
- `subgraph`
- `human_input`

### Node statuses

V1 uses these canonical statuses:

- `pending`
- `queued`
- `running`
- `waiting_approval`
- `success`
- `error`
- `cancelled`

No legacy runtime status should remain authoritative once graph runtime becomes active.

### Execution metadata

Every `tool_call` node must carry explicit scheduling metadata:

- `execution_backend: direct | worker`
- `execution_class: parallel_safe | serial_only`
- `state_scope: read_only | mutates_session | mutates_workspace | external_side_effect`

These fields drive scheduling. They must not be inferred ad hoc from presentation-layer state or from route folklore.

---

## Scheduler Model

### V1 shape

V1 scheduler remains round-shaped:

1. create an `llm_round` node
2. run the round and materialize assistant output
3. create zero or more `tool_call` nodes from assistant tool calls
4. insert `approval_gate` nodes in front of approval-sensitive tool nodes
5. schedule all ready nodes according to backend and execution class
6. when all nodes for the round are terminal, create the next `llm_round`
7. finish with `finalize`

This keeps the current desktop local chat mental model while replacing the runtime substrate.

### Scheduling rules

- a node is runnable only when all dependencies are terminal and no approval gate remains unsatisfied
- `parallel_safe` nodes may run concurrently
- `serial_only` nodes run one at a time per conflicting scope
- scope conflicts are enforced by `state_scope`
- `waiting_approval` does not block unrelated ready nodes
- `worker` lifecycle detail such as queueing or lease semantics is expressed at node/backend level, not as a separate runtime

### Approval behavior

Approval becomes per-node:

- approval token binds to an `approval_gate` node
- approve transitions that gate to `success`
- reject transitions that gate to `cancelled`
- downstream tool node behavior is deterministic and explicit

Approval must no longer rely on a single suspended continuation object as runtime truth.

---

## Compatibility Boundary

### Source-of-truth rule

After graph runtime lands, these structures are transitional only and must be deleted on the migration path:

- suspended local chat execution as authoritative runtime truth
- round-local pending tool metadata accumulation as authoritative runtime truth
- single-pending-call resume assumptions in the main runtime path

### Adapter rule

Legacy entrypoints may remain temporarily, but they must translate immediately into graph commands or graph scheduler actions.

Examples:

- legacy approval API -> approve or reject graph gate node
- legacy chat response shaping -> graph-to-chat projection
- legacy replay builder -> graph-to-replay projection

### No new legacy features rule

Once graph runtime work begins, no new runtime feature may be added directly to old round-based orchestration paths. New behavior must land in graph-native modules and be exposed through compatibility adapters if needed.

---

## Projection Model

All user-visible and replay-visible outputs must be projections from graph state.

V1 requires these projectors:

- graph -> chat blocks
- graph -> approval payload
- graph -> replay messages
- graph -> monitor and timeline events

Projection rules:

- projections may read `execution`, `execution_node`, and `execution_event`
- projections must not depend on ad hoc round-local arrays as truth
- projections must preserve current `call_id` replay invariants
- chat and monitor views may differ in presentation, but not in truth source

### Replay contract

Replay remains strict:

- assistant tool calls keep original `call_id`
- tool outputs are reconstructed in assistant-declared order
- completion order never changes replay order
- missing `call_id` or missing tool output remains a hard failure

This is non-negotiable because current replay stability depends on it.

---

## Module Layout

To avoid further primary-file growth, the runtime must be split into smaller modules. The target layout should be treated as a migration requirement, not as optional cleanup.

### Graph runtime core

- execution store and models
- scheduler
- node executor interface
- event appender

### Backend executors

- direct executor adapter
- worker executor adapter

### Projections

- chat block projector
- replay projector
- approval projector

### Migration glue

- legacy facade entrypoints
- old-to-new adapter shims

### Explicit rejection

This RFC explicitly rejects continuing to grow `code_mode_orchestration.rs` as the primary long-term integration surface. The migration must reduce its authority and split its responsibilities instead of turning it into a larger graph-runtime wrapper.

---

## Public and Internal Contracts

### Graph runtime persistence

The implementation must introduce persistent graph-backed execution state. Whether it lands as SQLite tables, structured local store entities, or another durable local representation, it must support:

- execution recovery after process interruption
- approval lookup by gate node or bound token
- timeline reconstruction from event log
- projection rebuilding without relying on transient in-memory continuation arrays

### Approval API

The existing approval API surface may remain temporarily, but its internal implementation must translate to:

- locate approval gate node
- validate token and context
- mutate graph node status
- emit graph event
- let scheduler continue ready downstream nodes

### Execution-plane integration

`direct` and `worker` paths remain exposed through the execution plane, but the execution plane becomes a backend-dispatch layer over graph nodes, not a runtime fork.

---

## Migration Plan

### Phase 1: Add graph models and persistence

- introduce `execution`, `execution_node`, and `execution_event`
- add graph-backed runtime state without deleting the current round runtime yet
- ensure new storage can represent tool nodes, gate nodes, and event history

### Phase 2: Introduce graph scheduler for round-shaped execution

- move tool scheduling decisions out of direct `for tool_calls` orchestration
- keep existing chat entrypoints, but route them into graph-backed scheduling
- materialize tool calls as graph nodes instead of implicit temporary control flow

### Phase 3: Move approval to gate nodes

- replace suspended continuation truth with graph gate state
- keep current approval API surface temporarily
- translate approval actions internally into graph node transitions and scheduler wake-up

### Phase 4: Move replay and chat rendering to projections

- build graph-derived `tool_call`, `tool_result`, and continuation rendering
- lock replay behavior with explicit `call_id` tests
- make graph projections the only source for chat and monitor views

### Phase 5: Collapse `direct` and `worker` into backend adapters

- keep both paths, but make them node backends under one scheduler
- express worker queueing, running, and completion as node/backend lifecycle detail only
- do not create a second worker runtime model

### Phase 6: Delete old runtime truth

- remove suspended local chat execution as authoritative runtime truth
- remove round-local pending tool meta accumulation as authoritative runtime truth
- remove single-pending-call resume assumptions from the main execution path

### Phase 7: Reserve extension hooks for later DAG growth

- add extension points for `handoff`, `subgraph`, `human_input`, and freer dependency edges
- do not implement those semantics in V1 unless needed to avoid a concrete migration dead end

---

## Acceptance Criteria

- single-tool rounds preserve current visible behavior
- multi-tool rounds are represented as multiple graph nodes and replay in assistant order
- `parallel_safe` direct tools can run concurrently without breaking chat rendering
- approval gates block only dependent nodes, not unrelated ready nodes
- multiple approval gates can coexist in one execution
- worker-backed nodes can move through queued or running to success while projecting correctly into chat and monitor surfaces
- missing `call_id` or missing tool output remains a deterministic error path
- approval and replay regression tests are ported or mirrored against graph-backed projections
- no runtime state outside graph persistence remains authoritative after cutover
- `code_mode_orchestration.rs` shrinks in authority as modules move out; it does not become the final graph runtime container

---

## Test Plan

### Runtime behavior

- single-tool round
- multi-tool round
- concurrent `parallel_safe` direct tool execution
- serial-only scope conflict handling
- worker-backed node lifecycle

### Approval behavior

- one gate, approve
- one gate, reject
- multiple gates in one execution
- approval of one gate does not unblock unrelated blocked paths incorrectly

### Replay behavior

- original assistant `call_id` ordering preserved
- completion order does not change replay order
- missing `call_id` is a hard failure
- missing tool output is a hard failure

### Projection behavior

- graph -> chat blocks
- graph -> approval payload
- graph -> replay messages
- graph -> monitor timeline

### Persistence behavior

- execution recovery after interruption
- approval token can be resolved back to the correct gate node
- event log can rebuild node and timeline projections without round-local state

---

## Rollout and Deletion Policy

### Rollout shape

The migration should be incremental in code, but not indefinite in architecture. Transitional adapters are allowed only when they help the cutover. They must not become long-term parallel truth paths.

### Required deletions

The implementation branch must include explicit follow-up tasks for deleting:

- suspended execution truth objects
- round-local pending tool meta truth objects
- old single-pending-call resume assumptions
- any new helper that recreates graph state outside graph persistence

### Extension policy

Future features such as handoff or subgraph execution must land as graph-native nodes and scheduler behavior. They must not reopen the old round runtime model.

---

## Final Decision

Desktop local chat should migrate to a graph-backed execution runtime with:

- one runtime truth
- one scheduler substrate
- `direct` and `worker` as executor backends, not separate runtimes
- approval as per-node gate state
- replay and UI as graph projections
- round-shaped graph v1 as the migration target

This is the smallest architecture that can absorb concurrency, approval, monitor transparency, and later DAG growth without another runtime rewrite.
