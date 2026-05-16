# Deeting 后端 Agent DAG 执行架构（Execution Graph & Resumable Runtime）

> 适用范围：桌面端本地对话（local chat）的 agent 执行模型——LLM 多轮、工具调用、审批、委托、可恢复。
> 不覆盖：上下文编排（见 [rag-architecture.md](./rag-architecture.md)）、自进化与策略学习（见 [self-evolution-architecture.md](./self-evolution-architecture.md)）。

本文档面向想真正读懂 Deeting agent runtime 的人。这是仓库里**最硬核**的一块：一个对话不是一次性的 chat completion，而是一个**有向无环图**（DAG），每个节点都有自己的状态机，整张图随时可以持久化、跨进程重启、跨用户审批，恢复后从断点继续跑。

## 1. TL;DR

一次对话在后端是一棵图：

```
llm_round:1 ──┬── tool_call:call-a ── tool_result:success
              ├── tool_call:call-b ── tool_result:requires_approval ── approval_gate:call-b
              └── tool_call:call-c ── tool_result:success
                                                  │
                                                  ▼
                                            finalize:1
```

- **节点（Node）有 4 种**：`LlmRound`、`ToolCall`、`ApprovalGate`、`Finalize`。
- **边（Edge）通过 `dependency_ids` 隐式表达**：每个节点声明它依赖哪些前置节点。
- **每个节点是一个独立的状态机**，11 种状态（Pending / Queued / Running / WaitingApproval / Approving / Approved / Rejected / ApprovalFailed / Success / Error / Cancelled）。
- **图本身也是状态**：整张 `LocalExecutionGraphSnapshot` 序列化后存进 SQLite 4 张表。
- **运行时上下文也是状态**：`PersistedChatToolRuntimeContext` + `PersistedInFlightExecutionContext` 保存了"如果现在重启，下一轮 LLM 调用要怎么发"的所有信息。
- **前端只渲染图**：UI 看到的不是 raw events，是从 `execution_graph` projection 出来的 `tool_call` / `tool_result` / `approval_gate` 块。
- **恢复是确定性回放**：从 SQLite 把 graph 和 context 拉出来，重建 `LocalChatToolRuntimeState`，直接接着 agentic loop 的下一轮跑。

涉及的核心代码：

```
deeting/src-tauri/src/modules/desktop_runtime/runtime/
├── execution_graph/
│   ├── types.rs                // 节点类型、状态、Snapshot 数据结构
│   └── projector.rs            // 把 tool_trace_blocks 折叠成图
├── execution_graph_store.rs    // SQLite 4 张表 + 持久化/读取
├── execution_plane.rs          // Direct vs Worker plane 分发
├── execution_plane/
│   ├── direct_handler.rs       // 主线程直接执行工具
│   └── worker_handler.rs       // 委托给 worker 进程/runtime
└── chat_tool_runtime/
    ├── mod.rs                  // agentic loop（轮次状态机的主循环）
    ├── inflight.rs             // PersistedInFlightExecutionContext + 4 个 stage
    ├── suspended.rs            // SuspendedChatToolExecution（挂起的快照）
    ├── recovery.rs             // 重启后恢复 / delegated workflow 唤醒
    ├── replay.rs               // 工具调用历史的回放消息构造
    ├── approval_commands.rs    // 审批 Tauri 命令
    ├── terminal_context.rs     // 终端上下文捕获
    └── tool_meta.rs            // 工具元数据辅助
```

## 2. 为什么需要图？为什么不是事件流？

最朴素的实现是：一次对话产出一串 `tool_call` / `tool_result` 事件，前端按时间顺序贴出来。这有几个致命缺陷：

1. **审批要等用户**。某些工具会返回 `requires_approval`，必须停下来等用户点同意/拒绝——可能是几秒，也可能是几小时（用户离开了机器）。事件流的"暂停"语义不明显。
2. **进程会死**。Tauri 桌面端可能被关闭、系统可能重启、推理服务可能断流。下次打开时，需要**精确知道**：上一次执行到了哪一步、哪些工具结果已经持久化、下一轮 LLM 调用的输入应该是什么。
3. **委托执行是子树，不是直线**。当本轮决定调 worker / custom task agent / workflow，它本身又会产生自己的工具调用流——这是**子图**，不是平铺事件。
4. **前端不应该重建语义**。如果前端拿到的是事件流，每个客户端都要自己写一套"这个 tool_call 是不是这个 tool_result 的对应"逻辑，bug 会无穷无尽。

DAG 把这些都收归一处：

| 朴素事件流 | 图模型 |
|---|---|
| 时间序列 | 显式依赖（dependency_ids） |
| approval 是"特殊事件" | `ApprovalGate` 是一类节点，自己有状态机 |
| 进程挂了基本回放不了 | 图 + 上下文都在 SQLite，恢复是查询 + 投影 |
| 子任务和父任务混在一条流里 | 子任务在 `delegated_execution_tree` 里挂在父节点下 |
| 前端要 reduce 事件 | 前端拿到的就是 `LocalExecutionGraphSnapshot`，project 一下就能渲染 |

## 3. 数据骨架

### 3.1 节点（`LocalExecutionGraphNode`）

定义在 [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs)：

```rust
pub(crate) struct LocalExecutionGraphNode {
    pub node_id: String,                 // 自然主键，由节点类型工厂生成
    pub node_type: LocalExecutionGraphNodeType,
    pub status: LocalExecutionGraphNodeStatus,
    pub dependency_ids: Vec<String>,     // 入边：依赖哪些上游节点
    pub metadata: Value,                 // 类型相关元数据（tool_name / call_id / backend / ...）
    pub input_payload: Option<Value>,    // 进入此节点时的输入（tool_call block / 入参）
    pub output_payload: Option<Value>,   // 节点产出（tool_result / assistant content）
}
```

**`node_id` 规则**（在 types.rs 里是函数，工程纪律就是不允许人手拼字符串）：

| 节点类型 | id 生成函数 | 例子 |
|---|---|---|
| `LlmRound` | `llm_round_node_id(round)` | `llm_round:1` |
| `ToolCall` | `tool_call_node_id(call_id)` | `tool_call:call-abc-123` |
| `ApprovalGate` | `approval_gate_node_id(call_id)` | `approval_gate:call-abc-123` |
| `Finalize` | `finalize_node_id(round)` | `finalize:1` |

### 3.2 节点类型

```rust
pub(crate) enum LocalExecutionGraphNodeType {
    LlmRound,         // 一次 provider chat-completion 调用
    ToolCall,         // 一次工具调用（工具名 + 参数 + 结果）
    ApprovalGate,     // 用户审批闸门
    Finalize,         // 本轮收尾（聚合所有 tool result，决定是不是该回话）
}
```

只有 4 种。**不要加第 5 种**，除非你能解释清楚它和这 4 种为什么不重合。`worker_call` 不是节点类型——它是 `ToolCall` 节点的 metadata 上挂的 `execution_backend: Worker`。

### 3.3 节点状态

```rust
pub(crate) enum LocalExecutionGraphNodeStatus {
    Pending,           // 已建模，未调度
    Queued,            // 已入队（worker plane）
    Running,           // 正在执行
    WaitingApproval,   // 工具要求审批，挂起
    Approving,         // 用户点了，正在执行审批后的实际工具
    Approved,          // 审批通过，工具结果落地
    Rejected,          // 用户拒绝
    ApprovalFailed,    // 审批通过但工具执行失败
    Success,           // 成功完成
    Error,             // 执行失败
    Cancelled,         // 被取消（用户中止 / 上游 abort）
}
```

11 个状态值不是装饰——每一个都对应前端能渲染、后端能恢复的明确语义。**所有从外部协议进来的字符串状态必须经过 `map_tool_call_status` / `map_tool_result_status` 归一化**（[`projector.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs)），不允许业务代码直接造状态字符串。

### 3.4 节点元数据维度

`ToolCall` 节点的 metadata 上挂三个语义维度，每个都是预定义枚举：

| 维度 | 取值 | 含义 |
|---|---|---|
| `execution_backend` | `Direct` / `Worker` | 主线程跑 vs 委托给 worker |
| `execution_class` | `ParallelSafe` / `SerialOnly` | 是否允许并行执行 |
| `state_scope` | `ReadOnly` / `MutatesSession` / `MutatesWorkspace` / `ExternalSideEffect` | 副作用边界 |

> 这些维度今天大多默认值（`Direct` / `SerialOnly` / `ReadOnly`），但**类型已经长好了**。当我们要做"读类工具并行批跑"或"基于副作用边界做更细审批"时，不需要破坏 schema。

### 3.5 边（Edge）

Deeting **不显式存边**——边通过节点的 `dependency_ids` 字段隐式表达。`Finalize` 节点的依赖示意：

```text
finalize:1.dependency_ids = [
    "llm_round:1",
    "tool_call:call-a",
    "tool_call:call-b",
    "tool_call:call-c",
    "approval_gate:call-b",   // 如果有 approval gate
]
```

设计取舍：

- **优点**：节点是行级数据，可以独立读写、独立索引；不需要单独的边表。
- **缺点**：拓扑排序需要在内存里跑一遍，做不了大图。但 Deeting 单次对话的节点数通常 < 30，不构成压力。

### 3.6 事件（Event）

`LocalExecutionGraphEvent` 是**审计流**，不是真相来源：

```rust
pub(crate) struct LocalExecutionGraphEvent {
    pub event_id: String,         // event:tool_trace:0 / event:delegated_execution / ...
    pub node_id: Option<String>,  // 关联节点（可能为空，如全局事件）
    pub event_type: String,       // tool_call.seen / tool_result.seen / approval_gate.waiting / projection.ignored_block
    pub payload: Value,
}
```

事件用来 debug、给前端做时间线动画、给后台 telemetry。**节点的 status 才是真相**——前端不要根据事件还原节点状态。

### 3.7 完整快照（`LocalExecutionGraphSnapshot`）

```rust
pub(crate) struct LocalExecutionGraphSnapshot {
    pub schema_version: i64,       // EXECUTION_GRAPH_SCHEMA_VERSION = 1
    pub execution_id: String,      // 这一次执行的稳定 id（见 §3.8）
    pub session_id: String,
    pub route: String,             // direct / worker
    pub plane: String,             // response_only / worker_reasoning / ...
    pub request_id: Option<String>,
    pub root_execution_id: Option<String>,  // 如果是被委托的子任务，指回父
    pub nodes: Vec<LocalExecutionGraphNode>,
    pub events: Vec<LocalExecutionGraphEvent>,
    pub metadata: Value,
}
```

整体序列化是 JSON，**schema_version = 1**。将来要做 incompatible change 必须改版本号 + 提供 migration（参考 `execution_graph_store.rs` 的 `migrate_execution_graph_runtime_bootstrap`）。

### 3.8 `execution_id` 的稳定性

[`projector.rs::resolve_execution_id`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) 按下面顺序选第一个非空值：

```text
1. input.root_execution_id            // 父执行 id（委托场景）
2. delegated_execution_tree.execution_id
3. "local-request:{request_id}"
4. "local-trace:{trace_id}"
5. "local-session:{session_id}:{plane}"  // 兜底
```

这保证：

- 同一次对话产出的多次投影**execution_id 稳定**（不会因为重新计算 trace_id 而改）。
- 委托的子执行能用父 id 索引回去。
- SQLite 主键唯一，无需额外去重逻辑。

## 4. Projector：从 tool_trace_blocks 到图

[`projector.rs::project_execution_graph_snapshot`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) 是核心翻译层。输入：

```rust
struct GraphProjectionInput {
    session_id: String,
    route: String,
    plane: String,
    trace_id: Option<String>,
    request_id: Option<String>,
    root_execution_id: Option<String>,
    response_content: Option<Value>,           // 最终 assistant 内容
    tool_trace_blocks: Vec<Value>,             // chat_tool_runtime 累积的工具事件
    delegated_execution_tree: Option<Value>,   // 委托执行的子树
}
```

折叠算法（伪码）：

```text
nodes = []
events = []
tool_index_by_call_id = {}      // call_id → nodes 数组下标，用于 pair 匹配

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

**这是 idempotent 的**：同一份 `tool_trace_blocks` 折叠出来的图永远相同。这是恢复机制能成立的前提。

### 4.1 反向 projection（图 → 前端块）

[`project_execution_graph_blocks_from_value`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) 做反方向：从持久化的 snapshot 投影回 `tool_call` / `tool_result` 块给前端渲染。

关键映射在 `map_graph_tool_call_block_status` 和 `build_graph_tool_result_block`，把 11 种节点状态压回前端能消费的 `running` / `success` / `error` / `requires_approval`。

> **纪律**：前端的状态分类**永远是节点状态的子集**。如果前端要新分类（如"已被用户取消"），必须先在节点状态里建模，再在映射函数里加分支。

## 5. SQLite 持久化

`execution_graph_store.rs` 维护 4 张表（[`init_execution_graph_tables`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs)）：

```sql
local_execution_graph_run (             -- 一次执行的元数据
  execution_id TEXT PRIMARY KEY,
  session_id TEXT,
  route TEXT,
  plane TEXT,
  status TEXT,
  root_execution_id TEXT,                 -- 委托回溯
  request_id TEXT,
  source_kind TEXT DEFAULT 'desktop_local_chat',
  graph_payload_json TEXT,                -- 整张图的 JSON（冗余但方便单点读取）
  created_at_unix_ms INTEGER,
  updated_at_unix_ms INTEGER
)

local_execution_graph_node (            -- 单节点存档
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

local_execution_graph_event (           -- 审计事件
  execution_id TEXT,
  event_id TEXT,
  node_id TEXT,
  event_type TEXT,
  payload_json TEXT,
  PRIMARY KEY (execution_id, event_id)
)

local_execution_graph_runtime_context ( -- 运行时上下文（用于恢复）
  execution_id TEXT PRIMARY KEY,
  context_json TEXT,                      -- PersistedInFlightExecutionContext
  updated_at_unix_ms INTEGER
)
```

### 5.1 为什么 graph_payload_json 和 node/event 行级存储**并存**？

- **行级存储**支持按 status 索引、按时间索引、批量分析。
- **整图 JSON**支持原子读、跨 schema 容错读取（schema_version 兜底）、debug 时一次 `sqlite3` 看完整。

这是刻意的 redundancy。写入路径在 `persist_*` 函数里保证两边同步——上层调用方不需要关心这种 dual write。

### 5.2 SQLite Busy 重试

[`SQLITE_BUSY_RETRY_DELAYS_MS = [150, 400, 900]`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs)：所有写操作遇到 `database is locked` 自动按这个序列退避重试。桌面端多写者（chat / memory / wiki）共享同一个 DB 文件，这是必须的。

### 5.3 Migration

`migrate_execution_graph_runtime_bootstrap` 是幂等 bootstrap：用 `desktop_config` 表里的 `desktop.runtime.execution_graph.bootstrap_state = done:v2` 作为完成标记。修改 schema 时同时升 `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION` 字符串和 bootstrap key，老用户启动时自动跑迁移。

## 6. Chat Tool Runtime：agentic loop

入口在 [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)。一次本地对话的主循环大致是：

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

**注意**：这不是单一函数，而是分散在 `mod.rs` 的多个 step 函数里。轮次状态机的真正"主语"是 `LocalChatToolRuntimeState`，跨轮持有的数据全在它身上。

### 6.1 `LocalChatToolRuntimeState`（瞬态）vs `PersistedChatToolRuntimeContext`（持久态）

| 字段 | State（运行时） | PersistedContext（落盘） |
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
| **diting_think_consumed** | ✅ | ❌（推理流标记，恢复后重置） |
| **captured_reasoning** | ✅ | ❌（流式聚合缓冲，无需持久） |
| **realtime_emitter** | ✅ | ❌（emitter 不可序列化，恢复时重建） |

`PersistedChatToolRuntimeContext` 是 **State 的可序列化投影**。`from_state` / `into_runtime_state` 是 lossless 等价（除了显式标记 ❌ 的"运行时之物"）。修改 State 时一定同步检查 PersistedContext，否则恢复后会丢字段——`#[serde(default)]` 是 Deeting 对老持久化记录的兼容兜底，但**新字段要主动想清楚老用户该回零成什么值**。

## 7. In-Flight Stage（运行阶段状态机）

[`inflight.rs::InFlightExecutionStage`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs)：

```rust
pub(crate) enum InFlightExecutionStage {
    ToolRunning,                 // 正在执行工具
    WaitingApproval,             // 卡在审批
    ResumingAfterApproval,       // 用户审批后，正在恢复
    ResumeFailed,                // 恢复尝试失败（罕见，通常因状态错位）
    DelegatedWorkflowRunning,    // 委托给 workflow / custom task agent，等子任务
    Interrupted,                 // 被外部中断（系统重启、Tauri 关闭、手动 abort）
}
```

完整的 `PersistedInFlightExecutionContext`：

```rust
pub(crate) struct PersistedInFlightExecutionContext {
    pub schema_version: i64,
    pub session_id: String,
    pub trace_id: String,
    pub request_id: Option<String>,
    pub execution_graph_execution_id: Option<String>,
    pub stage: InFlightExecutionStage,
    pub current_node: Option<String>,            // 卡在哪个节点
    pub current_call_id: Option<String>,         // 卡在哪个工具调用
    pub delegation: Option<PersistedDelegationWait>, // 委托等待详情
    pub started_at_unix_ms: i64,
    pub last_heartbeat_at_unix_ms: i64,          // 心跳，用于探活
    pub recoverable: bool,
    pub pending_approvals: Vec<PersistedPendingApproval>,
    pub chat_runtime: Option<PersistedChatToolRuntimeContext>,
    pub last_error: Option<String>,
    pub recovery_notice_emitted_at_unix_ms: Option<i64>,  // 已通知前端"恢复中"的时间戳
}
```

InFlight 是 chat_runtime context **之外**的薄层——回答的是"如果现在重启，要做什么动作来继续"，而 `chat_runtime` 回答的是"继续时下一轮 LLM 调用的输入是什么"。

### 7.1 Stage 流转

```text
                ┌───────────────────────────┐
                │ chat_tool_runtime 进入新轮  │
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

   Interrupted ← 由外部信号设置（系统/Tauri/手动 abort）
   recovery 调度时检测到 Interrupted → 走 recovery.rs 路径
```

### 7.2 心跳 & recoverable

- `last_heartbeat_at_unix_ms`：runtime 每完成一个动作就刷新。recovery 路径用它判断"上一次确实跑过 / 是不是僵尸残留"。
- `recoverable: bool`：明确标记**这个状态值不值得自动恢复**。一些不可恢复场景（如模型配置已删除）会把 `recoverable = false`，UI 提示用户手动处理。

## 8. SuspendedChatToolExecution（挂起快照）

[`suspended.rs::SuspendedChatToolExecution`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/suspended.rs) 是 PersistedContext + Graph 的**强联合视图**。两个核心动作：

- `SuspendedChatToolExecution::from_state(...)`：在挂起点把 `LocalChatToolRuntimeState` + pending tool meta 折叠成一个挂起快照，同时跑一遍 projector 算出 `execution_graph`。
- `into_runtime_state(self)`：恢复时反向构造回 State，重建 `realtime_emitter`、清零 `diting_think_consumed` / `captured_reasoning`。

它还提供**节点查询助手**：

```rust
suspended.pending_tool_node_id()           // 当前卡住的 tool_call:{call_id}
suspended.pending_gate_node_id()           // 当前卡住的 approval_gate:{call_id}
suspended.tool_node_id_for_call_id(id)
suspended.approval_gate_node_id_for_call_id(id)
suspended.pending_requires_approval_call_ids()
```

**纪律**：所有"我现在卡在哪"的查询都从 `execution_graph` 走，**不从 pending_approvals 数组**——graph 是真相，pending_approvals 是缓存。`sync_remaining_pending_approvals` 在用户审批一个 token 后，会把 pending_approvals 数组按 graph 实情清理对齐。

## 9. Approval Gate 完整生命周期

```text
        ┌──────────────────────────────────────────────┐
        │ tool 执行 → result.status == requires_approval │
        └────────────────┬─────────────────────────────┘
                         │
                         ▼
  projector 建 ApprovalGate 节点    status=WaitingApproval
  inflight.stage                    = WaitingApproval
  pending_approvals                 += PersistedPendingApproval
  emit status                       = "approval.required"
  persist (graph + context + pending)
                         │
                         ▼
              ────  agent loop returns  ────
                         │
                         ▼
        ┌─────────────────────────────────────────┐
        │ 用户在 UI 看到 inline approval card        │
        │ 点击 Approve / Reject                     │
        └────────────────┬────────────────────────┘
                         │
                         ▼
   Tauri 命令 approve_local_chat_execution_gate_command
   或 reject_local_chat_execution_gate_command
   (approval_commands.rs)
                         │
                         ▼
   graph.approval_gate.status = Approving
   inflight.stage             = ResumingAfterApproval
   实际工具被重新执行（如果是 approve）
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
            (清理本 token，保留其他未决审批)
                        │
                        ▼
            如果还有其他未决 approval → 仍然 Suspended
            否则 → 进入下一轮 LLM call
```

### 9.1 `PersistedPendingApproval` 的全字段

```rust
pub(crate) struct PersistedPendingApproval {
    pub approval_token: String,           // 自然 id，用户审批以此为准
    pub tool_id: Option<String>,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub session_id: Option<String>,
    pub description: Option<String>,
    pub risk_level: Option<String>,        // low / medium / high / critical
    pub risk_reasons: Vec<String>,         // 触发审批的具体原因
    pub tool_fingerprint: String,
    pub policy_rule_key: Option<String>,
    pub approval_grant_key: Option<String>,
    // ↓↓↓ 反向定位 graph 节点的引用
    pub execution_graph_execution_id: Option<String>,
    pub execution_graph_gate_node_id: Option<String>,
    pub execution_graph_tool_node_id: Option<String>,
    pub approval_status: Option<String>,   // 临时状态镜像，方便流式 UI
    pub created_at_unix_ms: i128,
    pub expires_at_unix_ms: i128,
}
```

**最后 3 个 graph 引用字段是 schema 关键**——它们让前端的 approval card 能精确点回 graph 上的具体节点，不依赖时间猜测。

## 10. Execution Plane（Direct vs Worker）

[`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) 把工具调用分发到两个执行面：

- **Direct plane**（[`execution_plane/direct_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/direct_handler.rs)）：主线程内联执行工具。适合轻量、读类、低延迟。
- **Worker plane**（[`execution_plane/worker_handler.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs)）：委托给 worker / custom task agent / workflow runtime。适合长任务、重计算、需要独立 reasoning 上下文的子任务。

**路由决策**走 [task_learning 的 route prior + bandit + safety lock](./self-evolution-architecture.md#9-路由融合apply_route_prior)，不在 plane 模块里自己拍。Plane 只负责**执行**，不负责**决定**。

### 10.1 委托（Delegation）

Worker plane 产生**子图**——一个 `DelegatedExecutionRecord` 包含自己的 steps / worker_ref / 子 tool_calls。子图通过 `delegated_execution_tree` 字段挂回父图：

```text
父 LlmRound:1
  └─ ToolCall: execute_code_plan  ← backend=Worker
       └─ delegated_execution_tree (子 snapshot 的引用):
            ├─ Step 1: worker_call (worker_ref: research.worker)
            │     └─ child tool_call: search_sdk → success
            ├─ Step 2: worker_call (worker_ref: ops.worker)
            └─ Step 3: assistant_summary
```

Projector 把 `delegated_execution_tree` 作为 LlmRound 节点的一个 event 挂上去（`event_type: "delegated_execution.integrated"`），前端可以选择展开渲染子树。

### 10.2 `PersistedDelegationWait`

委托执行期间，主 runtime 会进入 `DelegatedWorkflowRunning` stage，并写入 `PersistedDelegationWait`：

```rust
pub(crate) struct PersistedDelegationWait {
    pub kind: String,                     // "workflow" / "custom_task_agent"
    pub delegated_run_id: String,         // 子运行 id
    pub delegated_target_id: Option<String>,
    pub delegated_target_name: Option<String>,
    pub resume_policy: String,            // "on_completed" / "on_step" / ...
    pub consumed_event_ids: Vec<String>,  // 已消费的子事件 id（避免重复处理）
    pub last_status: Option<String>,
    pub result_ref: Option<String>,
    pub started_at_unix_ms: i64,
}
```

子任务完成事件触发 [`recovery.rs::resume_delegated_runtime_after_workflow_event`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs)，把结果回灌、继续主 loop。

## 11. Replay：把工具历史变成 LLM 输入

[`replay.rs::build_structured_tool_replay_messages`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/replay.rs)：每轮 LLM 调用之前，把上一轮的 `assistant tool_calls` + `tool_result` 用 OpenAI 兼容协议格式追加到 `orchestrated_messages`：

```text
[system: ...]
[user: "原始 query"]
[assistant: { tool_calls: [{id: call-1, ...}, {id: call-2, ...}] }]
[tool: { tool_call_id: call-1, content: <result-1 serialized> }]
[tool: { tool_call_id: call-2, content: <result-2 serialized> }]
[assistant: { tool_calls: [{id: call-3, ...}] }]   ← 这一轮新的
[tool: { tool_call_id: call-3, content: <result-3> }]
[assistant: <final text>]                          ← 模型这一轮的输出
```

**纪律**：所有工具结果必须有 `call_id`，否则 replay 会跳过这条消息并打 warn 日志——这是**协议级**约束。如果工具实现忘了 call_id，整个 agentic loop 会在下一轮上下文里看不到那次工具调用的存在，模型可能反复重试。

`serialize_tool_replay_content` 控制每条 result 序列化方式（截断 / 压缩 / 直传），是控制 token 预算的关键。

## 12. Recovery：跨进程恢复的完整路径

```text
应用启动 / Tauri 窗口重建
        │
        ▼
桌面 runtime 初始化
        │
        ├─ migrate_execution_graph_runtime_bootstrap()  ← schema 升级
        │
        ├─ 扫描 local_execution_graph_runtime_context where stage in
        │   (WaitingApproval, DelegatedWorkflowRunning, ToolRunning, Interrupted)
        │
        ▼
对每个 in-flight context:
   ┌──────────────────────────────────────────────────────────┐
   │ 1. load PersistedInFlightExecutionContext                │
   │ 2. load PersistedChatToolRuntimeContext (chat_runtime)   │
   │ 3. load LocalExecutionGraphSnapshot (整图)                │
   │ 4. recoverable == false → 标记终态、通知 UI、不自动续跑     │
   │ 5. stage 分发:                                           │
   │    - WaitingApproval        → emit "approval.required"  │
   │                                等待用户                  │
   │    - DelegatedWorkflowRunning→ 查 delegated_run_id 状态   │
   │                                若已完成 → 直接 resume      │
   │                                否则继续监听              │
   │    - ToolRunning / Interrupted                           │
   │                              → 工具已执行的从 graph 提取   │
   │                                未执行的 → 进 ResumeFailed │
   │                                或重跑（看 tool 是否幂等） │
   │ 6. SuspendedChatToolExecution::into_runtime_state()      │
   │ 7. agent loop 接着 round 跑                              │
   └──────────────────────────────────────────────────────────┘
```

**恢复的确定性来源**：

1. Graph 是 idempotent projection → 同一份 tool_trace_blocks 永远得到同一张图。
2. `node_id` 是确定的（基于 round / call_id），不依赖时间戳或 UUID。
3. `execution_id` 优先用 `request_id` / `trace_id`，重启后**只要外层 session 还在**就稳定可寻址。
4. Replay 完整把工具历史灌回 LLM 输入 → 模型在恢复后看到的对话状态和挂起前**位级一致**。

## 13. 前端如何"可恢复地"渲染

整条链路约定：**前端永远不缓存"协议层真相"**。打开一个会话时：

1. 前端拉历史消息列表（普通 chat history）。
2. 对每条 `desktop_local_chat` / `desktop_local_chat_resume` 类型的 assistant 消息，取 `meta.execution_graph`。
3. 调 `project_execution_graph_blocks_from_value(graph)` → 得到 `tool_call` / `tool_result` 块数组。
4. 渲染逻辑只看这个数组——和实时流来的块用**同一个**渲染器。

实时 + 历史是同一个数据形态：

```text
实时:     runtime push tool_trace_blocks via Tauri event
          → 前端 reducer 累积 → render
历史:     消息 meta.execution_graph
          → project_blocks_from_value → render
恢复中:   recovery 把 graph 一次性发出来
          → 前端把它当作"已有的历史块"渲染 + 继续监听后续实时事件
```

具体读侧解析在 [`hooks/chat/use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts)，approval 状态卡片在 [`components/chat/messages/ai-response-bubble/inline-approval.ts`](../deeting/components/chat/messages/ai-response-bubble/inline-approval.ts)，bridge 类型契约在 [`lib/chat/tool-approval.ts`](../deeting/lib/chat/tool-approval.ts)。

### 13.1 approval card 的反向定位

前端 approval card 需要在用户点 Approve 时调用 Tauri 命令，并精确告诉后端"批的是哪个 gate"。这就是 `PersistedPendingApproval` 上那三个 graph 引用字段的用处：

```ts
type BridgeToolPendingApproval = {
  approval_token: string;
  // ...
  execution_graph_execution_id?: string;
  execution_graph_gate_node_id?: string;
  execution_graph_tool_node_id?: string;
};
```

调用 `approve_local_chat_execution_gate_command` 时把这三者一起传回去，后端**不需要扫描** pending_approvals 列表去定位——直接索引到 graph 上。

## 14. 状态机汇总图

把前面三层状态机拼一起：

```text
┌─────────────────────────────────────────────────────────────────┐
│ LocalChatToolRuntimeState (轮次循环)                            │
│                                                                 │
│  round: 1 → 2 → ... → max_rounds                                │
│  每轮跑一次 LLM + 一组 tools                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ InFlightExecutionStage (跨轮挂起/恢复)                          │
│                                                                 │
│  ToolRunning ⇄ WaitingApproval ⇄ ResumingAfterApproval          │
│  ToolRunning ⇄ DelegatedWorkflowRunning                         │
│  任意 ⇒ Interrupted ⇒ recovery 接管                              │
│  ResumeFailed (不可自动恢复)                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ LocalExecutionGraphNodeStatus (节点级)                          │
│                                                                 │
│  ToolCall:     Pending → Queued → Running → Success/Error/      │
│                Cancelled/WaitingApproval                        │
│  ApprovalGate: WaitingApproval → Approving →                    │
│                Approved/Rejected/ApprovalFailed                 │
│  LlmRound:     Success (本轮成功) / Error                       │
│  Finalize:     Pending (有待批 gate) / Success                  │
└─────────────────────────────────────────────────────────────────┘
```

三层各管各的：

- **轮次循环**回答"现在第几轮，下一步是 LLM 还是 tools"
- **InFlightStage**回答"如果重启了，恢复时该走哪条路径"
- **NodeStatus**回答"图上每个具体动作的当前状态是什么"

## 15. 文件地图（按"我想改什么"反向定位）

| 我想… | 看这里 |
|---|---|
| 加一种新节点类型（如 `Branch`） | [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs) + [`projector.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) + 4 张 SQLite 表里的 `node_type` 都要兼容 + 前端 projection 兼容 |
| 改 tool_call → node 的映射规则 | [`projector.rs::project_execution_graph_snapshot`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) |
| 改 graph → 前端块的反向映射 | [`projector.rs::project_execution_graph_blocks_from_value`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/projector.rs) |
| 改 SQLite schema | [`execution_graph_store.rs::init_execution_graph_tables`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs) + 升 `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION` + bootstrap key |
| 改 agentic loop 的每轮逻辑 | [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| 改持久化字段 | [`chat_tool_runtime/inflight.rs::PersistedChatToolRuntimeContext`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) + 同步 `LocalChatToolRuntimeState` + suspended.rs `from_state`/`into_runtime_state` |
| 改恢复/重连逻辑 | [`chat_tool_runtime/recovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/recovery.rs) |
| 改委托执行的等待策略 | [`inflight.rs::PersistedDelegationWait`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) + `recovery.rs::resume_delegated_runtime_*` |
| 改 replay 时的 tool result 序列化 | [`chat_tool_runtime/replay.rs::serialize_tool_replay_content`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/replay.rs) |
| 加新的审批命令 | [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs) + `lib/chat/tool-approval.ts` |
| 改 Direct/Worker 路由 | 不在 plane 层，去 [task_learning 的 route prior](./self-evolution-architecture.md#9-路由融合apply_route_prior) |
| 加新的执行 plane | [`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) + `LocalExecutionGraphBackend` 加变体 |

## 16. 怎么扩展

### 16.1 加一种节点类型（例：`SafetyCheck`）

> 场景：每个委托执行前，让 runtime 自动跑一次安全检查节点。

1. 在 [`execution_graph/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/types.rs):
   ```rust
   pub(crate) enum LocalExecutionGraphNodeType {
       // ...existing
       SafetyCheck,
   }
   pub(crate) fn safety_check_node_id(round: usize, target: &str) -> String {
       format!("safety_check:{round}:{target}")
   }
   ```
2. 在 projector.rs 决定**什么时候建这个节点**——比如检测到 `execution_backend == Worker` 时，在 ToolCall 节点之前插一个 SafetyCheck 节点，并让 ToolCall 的 `dependency_ids` 包含它。
3. **升 `EXECUTION_GRAPH_SCHEMA_VERSION` 到 2**，在 `execution_graph_store.rs` 加 migration（老 snapshot 里没有 SafetyCheck 节点是正常的，不要 panic）。
4. 在 `map_graph_tool_call_block_status` 之外加 `map_safety_check_status`，决定它的状态如何对外映射。
5. 前端：如果想专门渲染，加新块类型 + 新 hook 解析；如果只是审计层面可见，把它折叠成 status 文本就行。
6. 写一个端到端测试：构造一次委托执行，断言 graph 里有 SafetyCheck 节点且 dependency 正确。

### 16.2 加新的 InFlightStage（例：`AwaitingExternalCallback`）

> 场景：某个工具会注册一个外部回调 URL（如 OAuth），需要等待 webhook 触发才能继续。

1. [`inflight.rs::InFlightExecutionStage`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) 加变体。
2. 在 recovery.rs 加分发分支：检测到这个 stage 时**不要自动恢复**，等回调到达再 trigger（参考 `DelegatedWorkflowRunning` 的处理）。
3. 在 `PersistedInFlightExecutionContext` 加 `callback_token` / `callback_url` 之类字段（必须 `#[serde(default)]`）。
4. 给回调暴露一个 Tauri 命令或本地 HTTP 端点，命令体内做的事：load context → 把 callback payload 当作 tool result 注入 → 转到 ResumingAfterApproval 类似的 stage → loop 继续。
5. 别忘了**审计**：每个 stage 流转都应该在 `local_execution_graph_event` 里留一笔。

### 16.3 引入并行工具执行

今天 `execution_class` 默认 `SerialOnly`，但 schema 已经准备好。落地需要：

1. 在调度 ToolCall 时按 metadata 分组：`ParallelSafe` 进并行池，`SerialOnly` 严格串行。
2. 节点的 `dependency_ids` 仍然指向 `llm_round:N`，不互相依赖——并行的语义已经表达完。
3. Projector **不变**——并行结束后，tool_trace_blocks 顺序入图就行（图层不关心执行时序）。
4. 测试：3 个 ParallelSafe ReadOnly 工具同时跑，期望总耗时 ≈ max(单工具耗时)，而不是 sum。

**红线**：`state_scope ≠ ReadOnly` 的工具**永远不能并行**。这是默认 `SerialOnly` 的真正目的——保护副作用边界。

## 17. 反模式（PR review 时拒绝）

- 在前端用事件流自己 reduce 节点状态（而不是从 `execution_graph` projection）
- 业务代码直接拼 `node_id` 字符串而不调 `tool_call_node_id` / `approval_gate_node_id` 等工厂
- 把 `LocalExecutionGraphNodeStatus` 的某个变体**别名映射**到另一个（如 把 `Cancelled` 当 `Error` 渲染）—— 应该在 `map_graph_*` 函数里做明确映射
- 给 `LocalChatToolRuntimeState` 加字段但忘了同步 `PersistedChatToolRuntimeContext` + `SuspendedChatToolExecution::from_state` + `into_runtime_state`
- 改 schema 但不升 `DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION`
- 在 chat_tool_runtime 的 agentic loop 里**绕过** projector 直接写 `local_execution_graph_node` 行——图必须从 trace_blocks 投影出来，不能手写
- 让 approval token 出现在 graph node_id 里（token 是敏感值，gate 用 call_id 索引）
- 让 worker plane 直接调 Direct plane 的工具入口（plane 间通信只能通过 delegated_execution_tree）
- 用 `request_id` 当主键（请求可能重发，会破坏 idempotency）—— 用 `execution_id`
- 在 replay 时让某个 tool result 静默丢弃 call_id（必须 warn 出来，否则下游模型行为不可解释）
- 把 `recoverable: false` 改成 `true` "让它再试一次"—— recoverable 是诊断结果，不是开关

## 18. 已知决策与权衡

| 决策 | 为什么 |
|---|---|
| Graph + Event 双层存储 | Graph 是真相，Event 是审计；前端只信 Graph |
| `dependency_ids` 隐式边，不建边表 | 单次对话节点数 < 30，行级边表是 over-engineering |
| Projector idempotent | 恢复一定能复现；同时也让"断流后重连"的图变化 = 增量 |
| `execution_id` 多源 fallback | 调用方不必关心传哪个 id；底层保证稳定 |
| 三层独立状态机（轮次 / Stage / Node） | 每层职责单一，可以独立测试；混在一起会产生组合爆炸 |
| 11 种节点状态全枚举 | 比"状态 + 子状态"两段式更适合 SQLite 索引和前端 switch |
| SQLite Busy 重试三档 (150/400/900ms) | 桌面端多写者实测够用；过激进的退避会让 UI 卡顿 |
| 委托子任务挂在 `delegated_execution_tree` 而不是直接展开成节点 | 委托子图可能很深；展开会让父 graph 失控膨胀 |
| Approval gate 用 call_id 作为索引而不是 approval_token | token 是敏感值不能进 node_id；call_id 已经是稳定主键 |
| 前端实时 + 历史用同一渲染路径 | 一套代码两种来源，避免"实时来的和历史回来的渲染不一致" |

## 19. 验证清单

改动 DAG / 恢复链路的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib execution_graph --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib execution_plane --no-fail-fast`
- [ ] 关键不变式测试：
  - `project_execution_graph_snapshot_keeps_tool_call_order_and_finalize_dependency`
  - `project_execution_graph_snapshot_creates_waiting_approval_gate`
  - `project_execution_graph_blocks_from_value_emits_tool_blocks`
- [ ] schema 变更：bootstrap key 已升 + migration 已写 + 老 snapshot 反序列化测试通过（`#[serde(default)]` 兜底）
- [ ] 持久化字段变更：`PersistedChatToolRuntimeContext` + `SuspendedChatToolExecution` 的 from/into 双向对称
- [ ] 桌面端手测路径：
  - 工具调用过程中关闭 Tauri，重启后看到"恢复中"提示且能继续
  - 触发 `requires_approval`，关闭再打开，approval card 仍然能点
  - 委托一个长时 workflow，关闭再打开，子任务完成后自动续跑
  - 多个 pending approval 同时存在，逐个 approve，剩余的不消失

> Windows 主机已知 caveat：`cargo test` 偶尔 DLL 启动失败（STATUS_ENTRYPOINT_NOT_FOUND）——区分编译/运行失败，运行失败到 CI/Linux 复跑。

## 20. FAQ

**Q：为什么不直接用 LangGraph / 现成的 agent framework？**
A：(1) 我们要做**强持久化 + 跨进程恢复**，不是单次内存执行；(2) 桌面端 SQLite 是唯一可靠 IPC，不能依赖外部 broker；(3) 现成 framework 通常把"中断/恢复"做成 first-class，但牺牲了**确定性回放**——Deeting 不允许"恢复时模型看到的历史和挂起前不同"。

**Q：节点状态有 11 种是不是太多？能不能合并 Approved / ApprovalFailed？**
A：不能。`Approved + tool 执行又失败`是 `ApprovalFailed`——这是用户做了授权但环境出错，UI 应该提示"用户没错，是工具失败"。如果合并成 Error，用户会以为是自己点错了。这种语义颗粒度是产品体验决定的，不是技术取舍。

**Q：如果两个用户同时审批同一个 gate 会怎样？**
A：桌面端只有单用户，但同一用户多个窗口可能。`approve_local_chat_execution_gate_command` 用 `execution_graph_gate_node_id` 索引到唯一的 gate 节点，原子更新它的 status；二次提交会因为 status 不再是 `WaitingApproval` 而被拒绝。

**Q：Replay 给 LLM 的工具历史不会越来越长吗？**
A：会。控制点是 `serialize_tool_replay_content`：长输出做截断 / 仅保留 `source_refs`（参考 [context_summarize_evidence 的设计](./rag-architecture.md#8-context-tools)）。终极方案是把老轮次的 tool_result 压缩成结构化摘要——但目前还没做，留作未来工作。

**Q：能不能用 graph 上的节点状态来 trigger 前端动画？**
A：可以——Tauri 实时 push tool_trace_blocks 时，前端 reducer 把节点状态转移作为动画 trigger。但**不要**直接订阅 `local_execution_graph_event` 表的变更——event 是审计层，不是协议层。

**Q：未来如果加 streaming tool output（边跑边显示 tool 进度），节点设计要变吗？**
A：不变。`Running` 状态本身就允许多次 emit `tool_call.progress` 事件；前端按事件流渲染进度，节点 status 在结束时才落地为 Success/Error。Schema 已经准备好。

**Q：能不能让节点之间有"OR 依赖"或"任一完成即可"？**
A：今天没有。DAG 是严格 AND 依赖（dependency_ids 全部 Success 才往下）。如果业务要"任一完成"，应该在调用方语义层做（如启动两个委托，先到的赢，另一个 Cancelled）——不在图模型里加 OR 边。OR 边会让恢复路径的语义大爆炸。

## 21. 参考

- 数据结构 & projector：[`execution_graph/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph/)
- 持久化：[`execution_graph_store.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_graph_store.rs)
- Agentic loop：[`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
- 挂起/恢复：[`chat_tool_runtime/{inflight,suspended,recovery,replay}.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/)
- 审批命令：[`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs)
- 执行面：[`execution_plane.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs) + [`execution_plane/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/)
- 路由决策（不在本文档范围）：[`self-evolution-architecture.md`](./self-evolution-architecture.md)
- 上下文编排（不在本文档范围）：[`rag-architecture.md`](./rag-architecture.md)
- 前端桥接：[`hooks/chat/use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts) + [`lib/chat/tool-approval.ts`](../deeting/lib/chat/tool-approval.ts) + [`components/chat/messages/ai-response-bubble/inline-approval.ts`](../deeting/components/chat/messages/ai-response-bubble/inline-approval.ts)
