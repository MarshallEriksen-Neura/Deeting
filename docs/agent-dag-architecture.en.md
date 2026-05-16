# Deeting Backend Agent DAG Architecture (Execution Graph & Resumable Runtime)

> Scope: the agent execution model for desktop local chat — multi-round LLM, tool calls, approvals, delegations, resumability.
> Out of scope: context orchestration (see [rag-architecture.en.md](./rag-architecture.en.md)); self-evolution / policy learning (see [self-evolution-architecture.en.md](./self-evolution-architecture.en.md)).

This document is for anyone who wants to truly read Deeting's agent runtime. It is the **hardest-core** piece in the repo: a conversation is not a single chat completion — it is a **directed acyclic graph** (DAG). Every node has its own state machine. The full graph can be persisted at any moment, restarted across processes, paused for human approval across users, and resumed from the exact checkpoint.

## 1. TL;DR

A conversation is a graph in the backend:

```
llm_round:1 ──┬── tool_call:call-a ── tool_result:success
              ├── tool_call:call-b ── tool_result:requires_approval ── approval_gate:call-b
              └── tool_call:call-c ── tool_result:success
                                                  │
                                                  ▼
                                            finalize:1
```

- **Nodes have 4 types**: `LlmRound`, `ToolCall`, `ApprovalGate`, `Finalize`.
- **Edges are implicit via `dependency_ids`**: every node declares which upstream nodes it depends on.
- **Each node is its own state machine** with 11 states (Pending / Queued / Running / WaitingApproval / Approving / Approved / Rejected / ApprovalFailed / Success / Error / Cancelled).
- **The graph itself is state**: a `LocalExecutionGraphSnapshot` serializes to 4 SQLite tables.
- **Runtime context is state too**: `PersistedChatToolRuntimeContext` + `PersistedInFlightExecutionContext` carry "if we restart right now, what does the next LLM call look like."
- **The frontend only renders the graph**: the UI never sees raw events — it sees `tool_call` / `tool_result` / `approval_gate` blocks projected from `execution_graph`.
- **Recovery is deterministic replay**: pull graph and context from SQLite, rebuild `LocalChatToolRuntimeState`, and continue the agentic loop from the next round.

Core code:

```
deeting/src-tauri/src/modules/desktop_runtime/runtime/
├── execution_graph/
│   ├── types.rs                // node types, statuses, snapshot data structures
│   └── projector.rs            // fold tool_trace_blocks into a graph
├── execution_graph_store.rs    // SQLite 4 tables + persist/read
├── execution_plane.rs          // Direct vs Worker plane dispatch
├── execution_plane/
│   ├── direct_handler.rs       // execute tools inline on main thread
│   └── worker_handler.rs       // delegate to worker process/runtime
└── chat_tool_runtime/
    ├── mod.rs                  // agentic loop (main loop of the round state machine)
    ├── inflight.rs             // PersistedInFlightExecutionContext + 4 stages
    ├── suspended.rs            // SuspendedChatToolExecution (suspended snapshot)
    ├── recovery.rs             // post-restart recovery / delegated workflow wake-up
    ├── replay.rs               // construct replay messages for tool call history
    ├── approval_commands.rs    // Tauri approval commands
    ├── terminal_context.rs     // terminal context capture
    └── tool_meta.rs            // tool metadata helpers
```

## 2. Why a graph? Why not an event stream?

The naive implementation is: each conversation emits a stream of `tool_call` / `tool_result` events; the frontend renders them chronologically. This has fatal weaknesses:

1. **Approvals wait for a user.** Some tools return `requires_approval` and must pause until the user clicks approve / reject — possibly seconds, possibly hours (user left the machine). "Pause" semantics are unclear in an event stream.
2. **Processes die.** Tauri desktop may be closed, the system may restart, the inference service may disconnect. When reopened, we need to **know precisely**: which step we stopped at, which tool results have been persisted, what the next LLM call's input should be.
3. **Delegated execution is a subtree, not a line.** When the current round decides to call a worker / custom task agent / workflow, that subordinate execution produces its own tool-call stream — that's a **subgraph**, not flat events.
4. **The frontend should not reconstruct semantics.** If the frontend gets event streams, every client must write its own "is this tool_call the pair of that tool_result" logic. Bugs proliferate.

The DAG unifies all of this:

| Naive event stream | Graph model |
|---|---|
| Time sequence | Explicit dependency (dependency_ids) |
| Approval is "a special event" | `ApprovalGate` is a node type with its own state machine |
| Process death = mostly unreplayable | Graph + context all in SQLite; recovery is query + projection |
| Subtasks and parent task mixed in one stream | Subtasks attach to parent nodes as `delegated_execution_tree` |
| Frontend must reduce events | Frontend gets `LocalExecutionGraphSnapshot`; one projection call → renderable blocks |

## 3. Data skeleton

### 3.1 Node (`LocalExecutionGraphNode`)

Defined in [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs):

```rust
pub(crate) struct LocalExecutionGraphNode {
    pub node_id: String,                 // natural primary key, produced by a type factory
    pub node_type: LocalExecutionGraphNodeType,
    pub status: LocalExecutionGraphNodeStatus,
    pub dependency_ids: Vec<String>,     // incoming edges: which upstream nodes
    pub metadata: Value,                 // type-specific metadata (tool_name / call_id / backend / ...)
    pub input_payload: Option<Value>,    // input on entry (tool_call block / args)
    pub output_payload: Option<Value>,   // node output (tool_result / assistant content)
}
```

**`node_id` rules** (functions in types.rs — engineering discipline: do not hand-concat strings):

| Node type | id generator | Example |
|---|---|---|
| `LlmRound` | `llm_round_node_id(round)` | `llm_round:1` |
| `ToolCall` | `tool_call_node_id(call_id)` | `tool_call:call-abc-123` |
| `ApprovalGate` | `approval_gate_node_id(call_id)` | `approval_gate:call-abc-123` |
| `Finalize` | `finalize_node_id(round)` | `finalize:1` |

### 3.2 Node types

```rust
pub(crate) enum LocalExecutionGraphNodeType {
    LlmRound,         // one provider chat-completion call
    ToolCall,         // one tool call (name + args + result)
    ApprovalGate,     // user approval gate
    Finalize,         // round closure (aggregate tool results, decide whether to respond)
}
```

Only 4. **Do not add a 5th** unless you can articulate why it doesn't overlap any of these. `worker_call` is not a node type — it's a `ToolCall` node with `execution_backend: Worker` metadata.

### 3.3 Node statuses

```rust
pub(crate) enum LocalExecutionGraphNodeStatus {
    Pending,           // modeled, not yet scheduled
    Queued,            // queued (worker plane)
    Running,           // executing
    WaitingApproval,   // tool requested approval; suspended
    Approving,         // user clicked; executing the actual tool now
    Approved,          // approval passed; tool result persisted
    Rejected,          // user rejected
    ApprovalFailed,    // approval passed but tool execution failed
    Success,           // completed successfully
    Error,             // execution failed
    Cancelled,         // cancelled (user abort / upstream abort)
}
```

11 values aren't decorative — each maps to a clear semantic the frontend can render and the backend can recover. **All external-protocol status strings must pass through `map_tool_call_status` / `map_tool_result_status` normalization** ([`projector.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs)); business code may not manufacture status strings.

### 3.4 Node metadata dimensions

A `ToolCall` node's metadata carries three semantic dimensions, each a predefined enum:

| Dimension | Values | Meaning |
|---|---|---|
| `execution_backend` | `Direct` / `Worker` | Run on main thread vs delegate to worker |
| `execution_class` | `ParallelSafe` / `SerialOnly` | Whether parallel execution is allowed |
| `state_scope` | `ReadOnly` / `MutatesSession` / `MutatesWorkspace` / `ExternalSideEffect` | Side-effect boundary |

> Today most default to (`Direct` / `SerialOnly` / `ReadOnly`), but **the types are already there**. When we want "parallel read-only batches" or "finer-grained approval by side-effect boundary," we won't need a schema change.

### 3.5 Edges

Deeting **does not store edges explicitly** — edges are implicit in each node's `dependency_ids`. `Finalize`'s dependencies are illustrative:

```text
finalize:1.dependency_ids = [
    "llm_round:1",
    "tool_call:call-a",
    "tool_call:call-b",
    "tool_call:call-c",
    "approval_gate:call-b",   // if any approval gate
]
```

Tradeoffs:

- **Pro**: nodes are row-level data — independently readable, indexable; no separate edge table.
- **Con**: topological sort runs in memory each time; can't handle huge graphs. But a single conversation has <30 nodes typically, so it's not a problem.

### 3.6 Events

`LocalExecutionGraphEvent` is an **audit stream**, not the source of truth:

```rust
pub(crate) struct LocalExecutionGraphEvent {
    pub event_id: String,         // event:tool_trace:0 / event:delegated_execution / ...
    pub node_id: Option<String>,  // associated node (None for global events)
    pub event_type: String,       // tool_call.seen / tool_result.seen / approval_gate.waiting / projection.ignored_block
    pub payload: Value,
}
```

Events are for debugging, frontend timeline animations, backend telemetry. **Node `status` is the truth** — do not reconstruct node state from events on the frontend.

### 3.7 Full snapshot (`LocalExecutionGraphSnapshot`)

```rust
pub(crate) struct LocalExecutionGraphSnapshot {
    pub schema_version: i64,       // EXECUTION_GRAPH_SCHEMA_VERSION = 1
    pub execution_id: String,      // stable id for this execution (see §3.8)
    pub session_id: String,
    pub route: String,             // direct / worker
    pub plane: String,             // response_only / worker_reasoning / ...
    pub request_id: Option<String>,
    pub root_execution_id: Option<String>,  // points back to parent if subtask
    pub nodes: Vec<LocalExecutionGraphNode>,
    pub events: Vec<LocalExecutionGraphEvent>,
    pub metadata: Value,
}
```

Serialized as JSON, **schema_version = 1**. Incompatible changes must bump version + provide migration (cf. `execution_graph_store.rs::migrate_execution_graph_runtime_bootstrap`).

### 3.8 Stability of `execution_id`

[`projector.rs::resolve_execution_id`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) picks the first non-empty value:

```text
1. input.root_execution_id            // parent execution id (delegation case)
2. delegated_execution_tree.execution_id
3. "local-request:{request_id}"
4. "local-trace:{trace_id}"
5. "local-session:{session_id}:{plane}"  // fallback
```

This guarantees:

- Multiple projections of the same conversation produce **stable execution_id** (won't change just because trace_id was regenerated).
- Delegated subtasks index back to parent via parent id.
- SQLite primary key is unique without extra dedup logic.

## 4. Projector: from tool_trace_blocks to graph

[`projector.rs::project_execution_graph_snapshot`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) is the core translation layer. Input:

```rust
struct GraphProjectionInput {
    session_id: String,
    route: String,
    plane: String,
    trace_id: Option<String>,
    request_id: Option<String>,
    root_execution_id: Option<String>,
    response_content: Option<Value>,           // final assistant content
    tool_trace_blocks: Vec<Value>,             // tool events accumulated by chat_tool_runtime
    delegated_execution_tree: Option<Value>,   // delegated execution subtree
}
```

Folding algorithm (pseudocode):

```text
nodes = []
events = []
tool_index_by_call_id = {}      // call_id → index into nodes, for pair matching

create llm_round_node_id(1) at status=Success, dependency=[], output=response_content

for block in tool_trace_blocks:
    if block.type == "tool_call":
        node = ToolCall {
            node_id: tool_call:{block.callId},
            status: map_tool_call_status(block.status),
            dependency: [llm_round:1],
            metadata: { call_id, tool_name, backend=Direct, class=SerialOnly, scope=ReadOnly },
            input_payload: block,
        }
        tool_index_by_call_id[call_id] = index of node
        emit event tool_call.seen

    if block.type == "tool_result":
        if call_id already has a tool_call node:
            update its status to map_tool_result_status(block.status)
            attach output_payload = block
        else:
            create a new tool_call node with output_payload already set

        if block.status == "requires_approval":
            create approval_gate node {
                node_id: approval_gate:{call_id},
                status: WaitingApproval,
                dependency: [tool_call:{call_id}],
                metadata: { call_id, tool_name, approval_token },
            }
            emit event approval_gate.waiting
        else:
            emit event tool_result.seen

    else:
        emit event projection.ignored_block

create finalize:{round} {
    dependency: [llm_round:{round}] + all tool_call ids + all approval_gate ids,
    status: Success if no waiting approval_gate else Pending,
    output_payload: response_content,
}
```

**This is idempotent**: the same `tool_trace_blocks` always fold into the same graph. This is the prerequisite for recovery to work.

### 4.1 Reverse projection (graph → frontend blocks)

[`project_execution_graph_blocks_from_value`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) goes the other way: from a persisted snapshot back to `tool_call` / `tool_result` blocks for frontend rendering.

The key mappings are in `map_graph_tool_call_block_status` and `build_graph_tool_result_block`, compressing 11 node statuses into the four frontend-consumable values: `running` / `success` / `error` / `requires_approval`.

> **Discipline**: the frontend's status classification is **always a subset of node status**. If the frontend wants a new category (e.g. "cancelled by user"), it must first be modeled at the node level, then add a branch in the mapping function.

## 5. SQLite persistence

`execution_graph_store.rs` maintains 4 tables ([`init_execution_graph_tables`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs)):

```sql
local_execution_graph_run (             -- metadata of one execution
  execution_id TEXT PRIMARY KEY,
  session_id TEXT,
  route TEXT,
  plane TEXT,
  status TEXT,
  root_execution_id TEXT,                 -- delegation traceback
  request_id TEXT,
  source_kind TEXT DEFAULT 'desktop_local_chat',
  graph_payload_json TEXT,                -- entire graph as JSON (redundant but handy)
  created_at_unix_ms INTEGER,
  updated_at_unix_ms INTEGER
)

local_execution_graph_node (            -- per-node archive
  execution_id TEXT,
  node_id TEXT,
  node_type TEXT,
  status TEXT,
  dependency_ids_json TEXT,
  metadata_json TEXT,
  input_payload_json TEXT,
  output_payload_json TEXT,
  PRIMARY KEY (execution_id, node_id)
)

local_execution_graph_event (           -- audit events
  execution_id TEXT,
  event_id TEXT,
  node_id TEXT,
  event_type TEXT,
  payload_json TEXT,
  PRIMARY KEY (execution_id, event_id)
)

local_execution_graph_runtime_context ( -- runtime context (for recovery)
  execution_id TEXT PRIMARY KEY,
  context_json TEXT,                      -- PersistedInFlightExecutionContext
  updated_at_unix_ms INTEGER
)
```

### 5.1 Why do `graph_payload_json` and row-level node/event storage **coexist**?

- **Row-level storage** supports indexing by status, by time; batch analytics.
- **Whole-graph JSON** supports atomic reads, cross-schema-version tolerant reads (with schema_version fallback), one-shot debug via `sqlite3`.

This is deliberate redundancy. Write paths in `persist_*` functions keep both sides in sync — callers above don't worry about dual write.

### 5.2 SQLite Busy retries

[`SQLITE_BUSY_RETRY_DELAYS_MS = [150, 400, 900]`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs): all writes that hit `database is locked` auto-retry with this backoff sequence. The desktop has multiple writers (chat / memory / wiki) sharing one DB file, so this is essential.

### 5.3 Migration

`migrate_execution_graph_runtime_bootstrap` is idempotent bootstrap: the `desktop_config` table key `desktop.runtime.execution_graph.bootstrap_state = done:v2` is the completion marker. Schema changes bump both the `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION` string and the bootstrap key; legacy users auto-migrate on next launch.

## 6. Chat Tool Runtime: agentic loop

Entry point [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs). One local conversation's main loop:

```text
state = LocalChatToolRuntimeState::initial(request)

loop round in 1..=max_rounds:
    state.round = round

    ① ── call provider chat-completion
         input:  state.orchestrated_messages
         output: response with optional tool_calls

    ② ── if no tool_calls:
            persist final assistant message
            return (Success, round)

    ③ ── for each tool_call in response:
            classify tool: is_context_tool / is_terminal_tool / mcp_capability / ...
            dispatch to execution_plane (Direct or Worker)
            collect tool_result block
            check status:
              - success/error  → append result to messages
              - requires_approval → write pending_approval, suspend
              - cancelled      → break

    ④ ── if any pending_approval:
            persist SuspendedChatToolExecution
            emit "approval.required" status to UI
            return (Suspended, round)

    ⑤ ── if any cancelled or fatal error:
            persist final state
            return (Failed, round)

    ⑥ ── replay: rebuild orchestrated_messages including tool results
         (so next round LLM sees the full history)

    ⑦ ── update execution_graph snapshot (project + persist)
         continue
```

**Note**: this isn't one function — it's spread across step functions in `mod.rs`. The true "subject" of the round state machine is `LocalChatToolRuntimeState`; all cross-round data lives on it.

### 6.1 `LocalChatToolRuntimeState` (transient) vs `PersistedChatToolRuntimeContext` (durable)

| Field | State (runtime) | PersistedContext (disk) |
|---|---|---|
| max_rounds / round / trace_id / request_id | ✅ | ✅ |
| execution_policy / model_connection | ✅ | ✅ |
| orchestrated_messages / task_query | ✅ | ✅ |
| temperature / max_tokens / reasoning_* | ✅ | ✅ |
| active_capability / active_skill_context | ✅ | ✅ |
| runtime_metrics | ✅ | ✅ |
| last_capability_snapshot / terminal_context | ✅ | ✅ |
| last_response | ✅ | ✅ |
| selected_knowledge_file_ids | ✅ | ✅ |
| **diting_think_consumed** | ✅ | ❌ (reasoning-stream flag, resets on recovery) |
| **captured_reasoning** | ✅ | ❌ (streaming aggregation buffer, no need to persist) |
| **realtime_emitter** | ✅ | ❌ (emitter not serializable; rebuilt on recovery) |

`PersistedChatToolRuntimeContext` is a **serializable projection of State**. `from_state` / `into_runtime_state` are lossless equivalents (except the explicitly-marked ❌ "runtime-only" fields). When modifying State, always check PersistedContext too — otherwise recovery loses fields. `#[serde(default)]` is Deeting's safety net for older persisted records, but **new fields require deliberate thought about what the default value should be for legacy users.**

## 7. In-Flight Stage (run-stage state machine)

[`inflight.rs::InFlightExecutionStage`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs):

```rust
pub(crate) enum InFlightExecutionStage {
    ToolRunning,                 // tool is executing
    WaitingApproval,             // stuck on approval
    ResumingAfterApproval,       // user approved, resuming
    ResumeFailed,                // recovery attempt failed (rare; usually state-misalignment)
    DelegatedWorkflowRunning,    // delegated to workflow / custom task agent, waiting for child
    Interrupted,                 // externally interrupted (system restart / Tauri close / manual abort)
}
```

Full `PersistedInFlightExecutionContext`:

```rust
pub(crate) struct PersistedInFlightExecutionContext {
    pub schema_version: i64,
    pub session_id: String,
    pub trace_id: String,
    pub request_id: Option<String>,
    pub execution_graph_execution_id: Option<String>,
    pub stage: InFlightExecutionStage,
    pub current_node: Option<String>,            // stuck at which node
    pub current_call_id: Option<String>,         // stuck at which tool call
    pub delegation: Option<PersistedDelegationWait>, // delegation-wait details
    pub started_at_unix_ms: i64,
    pub last_heartbeat_at_unix_ms: i64,          // heartbeat for liveness
    pub recoverable: bool,
    pub pending_approvals: Vec<PersistedPendingApproval>,
    pub chat_runtime: Option<PersistedChatToolRuntimeContext>,
    pub last_error: Option<String>,
    pub recovery_notice_emitted_at_unix_ms: Option<i64>,  // timestamp of "recovering" UI notification
}
```

InFlight is a thin layer **beside** chat_runtime context — it answers "if we restart now, what action should we take to continue," while `chat_runtime` answers "when we continue, what input does the next LLM call get."

### 7.1 Stage transitions

```text
                ┌───────────────────────────┐
                │ chat_tool_runtime enters    │
                │ a new round                 │
                └─────────────┬─────────────┘
                              │
                              ▼
                         ToolRunning ◀────────────────┐
                              │                       │
              ┌──── tool returns ──┬──────────────┐   │
              │                    │              │   │
              ▼                    ▼              ▼   │
        WaitingApproval      DelegatedWork    success │
              │              flowRunning      → next  │
              │ (user)              │           round │
              ▼                     │                 │
        ResumingAfterApproval ◀── delegated_resume    │
              │                                       │
              ▼                                       │
        ResumeFailed / ToolRunning ───────────────────┘

   Interrupted ← set by external signal (system/Tauri/manual abort)
   recovery scheduler detects Interrupted → goes through recovery.rs
```

### 7.2 Heartbeat & recoverable

- `last_heartbeat_at_unix_ms`: refreshed by runtime after each action. The recovery path uses it to distinguish "actually ran last time" from "zombie residue."
- `recoverable: bool`: explicitly marks "this state is not worth auto-recovering." Some non-recoverable cases (e.g. model config deleted) set `recoverable = false` and the UI prompts the user to handle manually.

## 8. SuspendedChatToolExecution (suspended snapshot)

[`suspended.rs::SuspendedChatToolExecution`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/suspended.rs) is a **strongly-coupled view** of PersistedContext + Graph. Two core operations:

- `SuspendedChatToolExecution::from_state(...)`: at suspend point, fold `LocalChatToolRuntimeState` + pending tool meta into a suspended snapshot and run projector once to derive `execution_graph`.
- `into_runtime_state(self)`: on recovery, build State back, rebuild `realtime_emitter`, reset `diting_think_consumed` / `captured_reasoning`.

It also exposes **node lookup helpers**:

```rust
suspended.pending_tool_node_id()           // currently stuck tool_call:{call_id}
suspended.pending_gate_node_id()           // currently stuck approval_gate:{call_id}
suspended.tool_node_id_for_call_id(id)
suspended.approval_gate_node_id_for_call_id(id)
suspended.pending_requires_approval_call_ids()
```

**Discipline**: all "where am I stuck" queries go through `execution_graph` — **never through the pending_approvals array**. The graph is truth; pending_approvals is a cache. `sync_remaining_pending_approvals` cleans pending_approvals to match graph reality after a user approves one token.

## 9. Full Approval Gate lifecycle

```text
        ┌──────────────────────────────────────────────┐
        │ tool executes → result.status == requires_approval │
        └────────────────┬─────────────────────────────┘
                         │
                         ▼
  projector creates ApprovalGate node      status=WaitingApproval
  inflight.stage                           = WaitingApproval
  pending_approvals                        += PersistedPendingApproval
  emit status                              = "approval.required"
  persist (graph + context + pending)
                         │
                         ▼
              ────  agent loop returns  ────
                         │
                         ▼
        ┌─────────────────────────────────────────┐
        │ user sees inline approval card in UI     │
        │ clicks Approve / Reject                  │
        └────────────────┬────────────────────────┘
                         │
                         ▼
   Tauri command approve_local_chat_execution_gate_command
   or reject_local_chat_execution_gate_command
   (approval_commands.rs)
                         │
                         ▼
   graph.approval_gate.status = Approving
   inflight.stage             = ResumingAfterApproval
   actual tool re-executed (if approved)
                         │
              ┌──────────┴───────────┐
              │                      │
              ▼                      ▼
        tool success            tool error
        graph.gate=Approved     graph.gate=ApprovalFailed
        graph.tool=Success      graph.tool=Error
              │                      │
              └─────────┬────────────┘
                        │
                        ▼
            sync_remaining_pending_approvals(token)
            (clear this token, keep other pending approvals)
                        │
                        ▼
            if other pending approvals remain → still Suspended
            otherwise → proceed to next LLM round
```

### 9.1 Full fields of `PersistedPendingApproval`

```rust
pub(crate) struct PersistedPendingApproval {
    pub approval_token: String,           // natural id; user approvals key on this
    pub tool_id: Option<String>,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub session_id: Option<String>,
    pub description: Option<String>,
    pub risk_level: Option<String>,        // low / medium / high / critical
    pub risk_reasons: Vec<String>,         // specific reasons that triggered approval
    pub tool_fingerprint: String,
    pub policy_rule_key: Option<String>,
    pub approval_grant_key: Option<String>,
    // ↓↓↓ back-references into the graph
    pub execution_graph_execution_id: Option<String>,
    pub execution_graph_gate_node_id: Option<String>,
    pub execution_graph_tool_node_id: Option<String>,
    pub approval_status: Option<String>,   // transient mirror for streaming UI
    pub created_at_unix_ms: i128,
    pub expires_at_unix_ms: i128,
}
```

**The last 3 graph-reference fields are schema-critical** — they let the frontend approval card precisely click back into a specific graph node, with no time-based guesswork.

## 10. Execution Plane (Direct vs Worker)

[`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) dispatches tool calls to two execution planes:

- **Direct plane** ([`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs)): execute inline on the main thread. Good for lightweight, read-only, low-latency.
- **Worker plane** ([`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs)): delegate to a worker / custom task agent / workflow runtime. Good for long tasks, heavy compute, subtasks that need an independent reasoning context.

**Routing decision** uses the [task_learning route prior + bandit + safety lock](./self-evolution-architecture.en.md#9-route-fusion-apply_route_prior) — not made up in the plane module. Plane only **executes**; it does not **decide**.

### 10.1 Delegation

Worker plane produces **subgraphs** — a `DelegatedExecutionRecord` contains its own steps / worker_ref / child tool_calls. The child graph hangs off the parent via the `delegated_execution_tree` field:

```text
Parent LlmRound:1
  └─ ToolCall: execute_code_plan  ← backend=Worker
       └─ delegated_execution_tree (reference to child snapshot):
            ├─ Step 1: worker_call (worker_ref: research.worker)
            │     └─ child tool_call: search_sdk → success
            ├─ Step 2: worker_call (worker_ref: ops.worker)
            └─ Step 3: assistant_summary
```

The projector attaches `delegated_execution_tree` to the LlmRound node as an event (`event_type: "delegated_execution.integrated"`). The frontend can optionally expand and render the subtree.

### 10.2 `PersistedDelegationWait`

During delegation, the main runtime enters `DelegatedWorkflowRunning` stage and writes a `PersistedDelegationWait`:

```rust
pub(crate) struct PersistedDelegationWait {
    pub kind: String,                     // "workflow" / "custom_task_agent"
    pub delegated_run_id: String,         // child run id
    pub delegated_target_id: Option<String>,
    pub delegated_target_name: Option<String>,
    pub resume_policy: String,            // "on_completed" / "on_step" / ...
    pub consumed_event_ids: Vec<String>,  // consumed child event ids (avoid duplicate processing)
    pub last_status: Option<String>,
    pub result_ref: Option<String>,
    pub started_at_unix_ms: i64,
}
```

Child-completion events trigger [`recovery.rs::resume_delegated_runtime_after_workflow_event`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs) — backfill the result, continue the main loop.

## 11. Replay: turning tool history into LLM input

[`replay.rs::build_structured_tool_replay_messages`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/replay.rs): before each LLM call, append the previous round's `assistant tool_calls` + `tool_result` to `orchestrated_messages` in OpenAI-compatible protocol format:

```text
[system: ...]
[user: "original query"]
[assistant: { tool_calls: [{id: call-1, ...}, {id: call-2, ...}] }]
[tool: { tool_call_id: call-1, content: <result-1 serialized> }]
[tool: { tool_call_id: call-2, content: <result-2 serialized> }]
[assistant: { tool_calls: [{id: call-3, ...}] }]   ← new this round
[tool: { tool_call_id: call-3, content: <result-3> }]
[assistant: <final text>]                          ← this round's model output
```

**Discipline**: every tool result must have a `call_id`. Otherwise replay skips the message with a warning log — this is a **protocol-level** constraint. If a tool implementation forgets call_id, the next round's context won't contain that tool invocation, and the model may keep retrying.

`serialize_tool_replay_content` controls how each result is serialized (truncate / compress / pass-through) — key to token budgeting.

## 12. Recovery: full cross-process recovery path

```text
App launch / Tauri window rebuild
        │
        ▼
desktop runtime init
        │
        ├─ migrate_execution_graph_runtime_bootstrap()  ← schema upgrade
        │
        ├─ scan local_execution_graph_runtime_context where stage in
        │   (WaitingApproval, DelegatedWorkflowRunning, ToolRunning, Interrupted)
        │
        ▼
for each in-flight context:
   ┌──────────────────────────────────────────────────────────┐
   │ 1. load PersistedInFlightExecutionContext                │
   │ 2. load PersistedChatToolRuntimeContext (chat_runtime)   │
   │ 3. load LocalExecutionGraphSnapshot (full graph)         │
   │ 4. recoverable == false → mark terminal, notify UI, no   │
   │    auto-resume                                           │
   │ 5. stage dispatch:                                       │
   │    - WaitingApproval        → emit "approval.required"   │
   │                                wait for user             │
   │    - DelegatedWorkflowRunning→ query delegated_run_id    │
   │                                status; if done → resume; │
   │                                else continue listening   │
   │    - ToolRunning / Interrupted                           │
   │                              → tools already executed    │
   │                                read from graph           │
   │                                not yet executed → goto   │
   │                                ResumeFailed or rerun if  │
   │                                idempotent                │
   │ 6. SuspendedChatToolExecution::into_runtime_state()      │
   │ 7. agent loop continues at round                         │
   └──────────────────────────────────────────────────────────┘
```

**Where determinism comes from**:

1. The graph is an idempotent projection → the same `tool_trace_blocks` always yield the same graph.
2. `node_id` is deterministic (based on round / call_id) — no timestamps or UUIDs.
3. `execution_id` prefers `request_id` / `trace_id` — stable across restart **as long as the outer session is alive**.
4. Replay rehydrates the full tool history into LLM input → after recovery, the model sees a **bit-identical** conversation state.

## 13. How the frontend renders "resumably"

The whole chain agrees on: **the frontend never caches "protocol-layer truth."** Opening a session:

1. Frontend fetches history messages (normal chat history).
2. For each `desktop_local_chat` / `desktop_local_chat_resume` assistant message, take `meta.execution_graph`.
3. Call `project_execution_graph_blocks_from_value(graph)` → get an array of `tool_call` / `tool_result` blocks.
4. The render logic only sees this array — **same renderer** as live-streamed blocks.

Live + history use the same data shape:

```text
live:     runtime pushes tool_trace_blocks via Tauri event
          → frontend reducer accumulates → render
history:  message meta.execution_graph
          → project_blocks_from_value → render
recovery: recovery emits graph as a single batch
          → frontend treats it as "existing history blocks" + keeps listening
```

Read-side parser at [`hooks/chat/use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts); approval card at [`components/chat/messages/ai-response-bubble/inline-approval.ts`](../deeting/components/chat/messages/ai-response-bubble/inline-approval.ts); bridge contract at [`lib/chat/tool-approval.ts`](../deeting/lib/chat/tool-approval.ts).

### 13.1 Approval card reverse lookup

When the user clicks Approve, the frontend invokes a Tauri command and must tell the backend exactly which gate. That's what those three graph-reference fields on `PersistedPendingApproval` are for:

```ts
type BridgeToolPendingApproval = {
  approval_token: string;
  // ...
  execution_graph_execution_id?: string;
  execution_graph_gate_node_id?: string;
  execution_graph_tool_node_id?: string;
};
```

`approve_local_chat_execution_gate_command` gets these three fields back — the backend **doesn't scan** pending_approvals; it indexes straight into the graph.

## 14. State machine summary

The three layers, stacked:

```text
┌─────────────────────────────────────────────────────────────────┐
│ LocalChatToolRuntimeState (round loop)                          │
│                                                                 │
│  round: 1 → 2 → ... → max_rounds                                │
│  one LLM + one batch of tools per round                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ InFlightExecutionStage (cross-round suspend/resume)             │
│                                                                 │
│  ToolRunning ⇄ WaitingApproval ⇄ ResumingAfterApproval          │
│  ToolRunning ⇄ DelegatedWorkflowRunning                         │
│  any ⇒ Interrupted ⇒ recovery takes over                        │
│  ResumeFailed (cannot auto-recover)                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ LocalExecutionGraphNodeStatus (per-node)                        │
│                                                                 │
│  ToolCall:     Pending → Queued → Running → Success/Error/      │
│                Cancelled/WaitingApproval                        │
│  ApprovalGate: WaitingApproval → Approving →                    │
│                Approved/Rejected/ApprovalFailed                 │
│  LlmRound:     Success (round ok) / Error                       │
│  Finalize:     Pending (gates outstanding) / Success            │
└─────────────────────────────────────────────────────────────────┘
```

Each layer owns its own job:

- **Round loop** answers "which round, next step is LLM or tools"
- **InFlightStage** answers "if we restart, which recovery branch do we take"
- **NodeStatus** answers "for each specific action on the graph, what's the current state"

## 15. File map (by "what do I want to change")

| I want to… | Look here |
|---|---|
| Add a new node type (e.g. `Branch`) | [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs) + [`projector.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) + ensure 4 SQLite tables tolerate the new `node_type` + frontend projection tolerates |
| Change tool_call → node mapping rules | [`projector.rs::project_execution_graph_snapshot`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) |
| Change graph → frontend block reverse mapping | [`projector.rs::project_execution_graph_blocks_from_value`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) |
| Change SQLite schema | [`execution_graph_store.rs::init_execution_graph_tables`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs) + bump `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION` + bootstrap key |
| Change per-round logic in the agentic loop | [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| Change persisted fields | [`chat_tool_runtime/inflight.rs::PersistedChatToolRuntimeContext`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) + sync `LocalChatToolRuntimeState` + suspended.rs `from_state`/`into_runtime_state` |
| Change recovery/reconnection logic | [`chat_tool_runtime/recovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs) |
| Change delegation wait strategy | [`inflight.rs::PersistedDelegationWait`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) + `recovery.rs::resume_delegated_runtime_*` |
| Change tool result serialization for replay | [`chat_tool_runtime/replay.rs::serialize_tool_replay_content`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/replay.rs) |
| Add a new approval command | [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs) + `lib/chat/tool-approval.ts` |
| Change Direct/Worker routing | Not in the plane layer — go to [task_learning route prior](./self-evolution-architecture.en.md#9-route-fusion-apply_route_prior) |
| Add a new execution plane | [`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) + add a variant to `LocalExecutionGraphBackend` |

## 16. How to extend

### 16.1 Add a node type (example: `SafetyCheck`)

> Scenario: before every delegated execution, automatically run a safety check node.

1. In [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs):
   ```rust
   pub(crate) enum LocalExecutionGraphNodeType {
       // ...existing
       SafetyCheck,
   }
   pub(crate) fn safety_check_node_id(round: usize, target: &str) -> String {
       format!("safety_check:{round}:{target}")
   }
   ```
2. In projector.rs, decide **when to create the node** — e.g. when `execution_backend == Worker` is detected, insert a SafetyCheck before the ToolCall, and put it in the ToolCall's `dependency_ids`.
3. **Bump `EXECUTION_GRAPH_SCHEMA_VERSION` to 2**, add migration in `execution_graph_store.rs` (old snapshots without SafetyCheck nodes are normal — don't panic).
4. Add `map_safety_check_status` alongside `map_graph_tool_call_block_status`; decide how it maps for external consumers.
5. Frontend: if you want to render it, add a new block type + parsing hook; if it's just audit-visible, fold it into a status text.
6. Write an end-to-end test: construct a delegated execution, assert a SafetyCheck node exists in the graph with correct dependencies.

### 16.2 Add a new InFlightStage (example: `AwaitingExternalCallback`)

> Scenario: a tool registers an external callback URL (e.g. OAuth) and must wait for a webhook to continue.

1. Add a variant in [`inflight.rs::InFlightExecutionStage`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs).
2. Add a branch in recovery.rs: when this stage is detected, **do not auto-resume** — wait for the callback (mirror `DelegatedWorkflowRunning`).
3. Add `callback_token` / `callback_url` fields to `PersistedInFlightExecutionContext` (must be `#[serde(default)]`).
4. Expose a Tauri command or local HTTP endpoint for the callback; the command body: load context → inject callback payload as tool result → transition to a stage similar to ResumingAfterApproval → loop continues.
5. Don't forget **audit**: every stage transition should leave a row in `local_execution_graph_event`.

### 16.3 Introduce parallel tool execution

Today `execution_class` defaults to `SerialOnly`, but the schema is ready. To land:

1. When scheduling ToolCalls, group by metadata: `ParallelSafe` enters the parallel pool; `SerialOnly` stays strictly serial.
2. The node's `dependency_ids` still points only to `llm_round:N`, not to each other — the parallel semantics are already expressed.
3. The projector **does not change** — after parallel execution, tool_trace_blocks land in the graph (the graph layer doesn't care about execution order).
4. Test: 3 ParallelSafe ReadOnly tools running together; expect total time ≈ max(single tool time), not sum.

**Red line**: tools where `state_scope ≠ ReadOnly` **must never run in parallel**. That's the true purpose of the SerialOnly default — protecting side-effect boundaries.

## 17. Anti-patterns (reject in PR review)

- Frontend reducing node state from raw events (instead of projecting from `execution_graph`)
- Business code hand-concatenating `node_id` strings instead of calling factories like `tool_call_node_id` / `approval_gate_node_id`
- **Aliasing** one `LocalExecutionGraphNodeStatus` value to another in renders (e.g. drawing `Cancelled` as `Error`) — do the mapping explicitly in `map_graph_*` functions
- Adding a field to `LocalChatToolRuntimeState` without syncing `PersistedChatToolRuntimeContext` + `SuspendedChatToolExecution::from_state` + `into_runtime_state`
- Changing schema without bumping `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION`
- Writing directly to `local_execution_graph_node` rows from the agentic loop, **bypassing** the projector — the graph must be projected from trace_blocks, not hand-written
- Letting approval tokens appear in graph node_ids (tokens are sensitive; gates index by call_id)
- Worker plane directly calling Direct plane tool entry points (planes communicate only via delegated_execution_tree)
- Using `request_id` as the primary key (requests may be retried — breaks idempotency); use `execution_id`
- Silently dropping `call_id` from a tool result during replay (must warn; otherwise downstream model behavior is inexplicable)
- Flipping `recoverable: false` to `true` "to retry it" — recoverable is a diagnosis, not a switch

## 18. Recorded decisions and tradeoffs

| Decision | Why |
|---|---|
| Two-layer storage: Graph + Event | Graph is truth; Event is audit; frontend only trusts Graph |
| Implicit edges via `dependency_ids`, no edge table | Single conversation has <30 nodes; row-level edge table is over-engineering |
| Idempotent projector | Recovery always reproduces; "reconnect after disconnect" becomes incremental change |
| `execution_id` multi-source fallback | Callers don't worry which id; bottom layer guarantees stability |
| Three independent state machines (round / Stage / Node) | Single responsibility per layer, independently testable; mixing creates combinatorial explosion |
| 11 full node statuses (no sub-states) | Better for SQLite indexing and frontend switch than two-tier state+substate |
| SQLite Busy retry 3-step (150/400/900ms) | Empirically enough for desktop multi-writer; more aggressive backoff stalls UI |
| Delegated subtask hangs on `delegated_execution_tree` rather than expanding inline | Delegation subgraphs can be deep; inlining bloats parent graph uncontrollably |
| Approval gate indexed by call_id, not approval_token | Tokens are sensitive — can't live in node_ids; call_id is already a stable primary key |
| Frontend live + history use one render path | One codebase for two sources; avoids "live and resumed graphs render differently" |

## 19. Verification checklist

PRs that touch DAG / recovery must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib execution_graph --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib execution_plane --no-fail-fast`
- [ ] Key invariant tests:
  - `project_execution_graph_snapshot_keeps_tool_call_order_and_finalize_dependency`
  - `project_execution_graph_snapshot_creates_waiting_approval_gate`
  - `project_execution_graph_blocks_from_value_emits_tool_blocks`
- [ ] Schema changes: bootstrap key bumped + migration written + legacy snapshot deserialization passes (`#[serde(default)]` cushioning)
- [ ] Persistence-field changes: `PersistedChatToolRuntimeContext` + `SuspendedChatToolExecution` from/into pair stays symmetric
- [ ] Desktop manual test path:
  - Close Tauri mid-tool, restart, see "recovering" notice, continues
  - Trigger `requires_approval`, close + reopen, approval card still clickable
  - Delegate a long workflow, close + reopen, auto-resume after child completes
  - Multiple pending approvals, approve one by one, others don't disappear

> Known Windows caveat: occasional DLL launch failure (STATUS_ENTRYPOINT_NOT_FOUND) in `cargo test` — distinguish compile failure from run failure; rerun on CI/Linux for the latter.

## 20. FAQ

**Q: Why not use LangGraph or some existing agent framework?**
A: (1) We need **strong persistence + cross-process recovery**, not one-shot in-memory execution; (2) on desktop SQLite is the only reliable IPC — we can't depend on an external broker; (3) existing frameworks usually make "interrupt/resume" first-class but at the cost of **deterministic replay** — Deeting cannot tolerate "after recovery, the model sees a different history than it saw before suspend."

**Q: 11 node statuses — too many? Can we merge Approved / ApprovalFailed?**
A: No. `Approved + tool execution failed afterward` becomes `ApprovalFailed` — meaning the user authorized correctly but the environment errored; the UI should say "you did fine, the tool failed." Merging into `Error` would make the user think they made a mistake. This semantic granularity is a UX decision, not a tech tradeoff.

**Q: What if two users approve the same gate at the same time?**
A: The desktop is single-user, but the same user might have multiple windows. `approve_local_chat_execution_gate_command` indexes to a unique gate node by `execution_graph_gate_node_id` and atomically updates its status; a second submission fails because status is no longer `WaitingApproval`.

**Q: Won't replay's tool history keep growing with every round?**
A: Yes. The control point is `serialize_tool_replay_content`: truncate long outputs / keep only `source_refs` (cf. [context_summarize_evidence design](./rag-architecture.en.md#8-context-tools)). The ultimate solution is to compress old rounds' tool results into structured summaries — not implemented yet, future work.

**Q: Can we use graph node-status changes to trigger frontend animations?**
A: Yes — when Tauri pushes tool_trace_blocks live, the frontend reducer can use node-status transitions as animation triggers. But **do not** subscribe to `local_execution_graph_event` table changes directly — events are an audit layer, not a protocol layer.

**Q: If we add streaming tool output (incremental progress as the tool runs), do nodes need redesigning?**
A: No. `Running` already allows multiple `tool_call.progress` events to be emitted; the frontend renders progress from the event stream, and node status only settles to Success/Error on completion. Schema is ready.

**Q: Can nodes have "OR dependencies" or "any-of"?**
A: Not today. DAG dependencies are strict AND (all dependency_ids must be Success). If you need "either is fine," do it in the caller semantic layer (e.g. start two delegations, the first one to arrive wins, the other is Cancelled) — not in the graph model. OR edges would explode the recovery-path semantics.

## 21. References

- Data structures & projector: [`execution_graph/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/)
- Persistence: [`execution_graph_store.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs)
- Agentic loop: [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
- Suspend/resume: [`chat_tool_runtime/{inflight,suspended,recovery,replay}.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/)
- Approval commands: [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs)
- Execution planes: [`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) + [`execution_plane/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/)
- Routing decisions (out of scope here): [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md)
- Context orchestration (out of scope here): [`rag-architecture.en.md`](./rag-architecture.en.md)
- Frontend bridge: [`hooks/chat/use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts) + [`lib/chat/tool-approval.ts`](../deeting/lib/chat/tool-approval.ts) + [`components/chat/messages/ai-response-bubble/inline-approval.ts`](../deeting/components/chat/messages/ai-response-bubble/inline-approval.ts)
