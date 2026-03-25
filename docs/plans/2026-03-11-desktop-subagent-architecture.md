# Desktop Subagent Architecture

Date: 2026-03-11

## Summary
桌面端的 `subagent` 不应被实现为新的“人格对象”或新的“技能类型”，而应被实现为编排层中的 delegated worker。它与 `direct capability path`、`code mode path` 一起构成桌面端统一的三路执行模型：`direct | worker | codemode`。

本设计收敛以下已有方向：
- `spec-agent` 中的 Foreman/Worker 与 DAG 调度思想
- capability / recipe / orchestration primitive / executor 的语义拆分
- 桌面 runtime 去 assistant 化后的 persona / capability / docs / execution 四层模型

## Why now
- 当前桌面端已经明确需要在 `direct` 与 `codemode` 之间做显式路由。
- 一部分请求并不适合 direct tool call，也不需要程序化执行，而是更适合“受控的分析/规划 worker”。
- 如果不单独定义 `worker/subagent`，后续会再次把 assistant、skill、tool、code mode 混成一个对象。

## Position

### 1. Subagent is an orchestration-layer object
`subagent` 的语义定位不是 capability，不是 recipe 本体，不是 assistant，也不是 executor。

它是编排层里的一个 delegated worker invocation，负责处理：
- 分析
- 规划
- 比较
- 调研
- 总结
- 结构化建议生成

### 2. MVP keeps a single desktop runtime
MVP 不新增一个独立桌面 runtime，也不为每个请求默认多开一个 router AI。

桌面端仍只有一个主 runtime：
- route selection 由 runtime 规则优先决定
- 只有命中 `worker` 路径时，才发生 delegated worker invocation
- worker 是主 runtime 下的 request-scoped orchestration unit，而不是长期常驻 actor

### 3. Worker is not CodeMode
`worker` 与 `codemode` 必须分离：
- `worker`：认知型、多步但不要求程序逻辑
- `codemode`：程序化、多步且需要循环/条件/聚合/胶水代码

原则：
- 多步分析 ≠ codemode
- 只有需要程序逻辑时才进入 codemode

## Goals
- 定义桌面端 `direct | worker | codemode` 三路模型。
- 明确 `subagent/worker` 的运行边界与对象语义。
- 给出 route decision、worker input/output、trace、approval 的统一 contract。
- 让 `local_orchestrator` 只保留薄接线，不散落路由或 subagent 逻辑。

## Non-Goals
- 本轮不设计云端 internal chat 的 subagent 架构。
- 本轮不要求实现多 worker DAG 并行执行。
- 本轮不要求引入独立 router model。
- 本轮不把 recipe/skill 直接重写成 subagent runtime。

## Unified desktop invocation model

### A. Direct path
适用于：
- 单个 capability 可完成
- 高风险/审批敏感动作
- 低延迟调用
- 用户显式要求直接调用

行为：
- 主 runtime 直接调用 capability
- 不进入 worker
- 不进入 code executor

### B. Worker path
适用于：
- 分析、规划、调研、对比、总结
- 需要结构化认知输出
- 可能需要多步思考，但不需要程序逻辑
- 用户显式要求委派给 worker/subagent

行为：
- 主 runtime 生成 `WorkerTask`
- delegated worker 在当前会话上下文下执行
- 返回 `WorkerResult`
- 主 runtime 决定是否继续回答、继续检索或升级到 codemode

### C. CodeMode path
适用于：
- 需要循环、条件、重试、聚合
- 需要胶水代码或批量编排
- 需要受控执行环境
- 用户显式要求 code mode

行为：
- 主 runtime 调用 orchestration primitive（例如 `execute_code_plan`）
- executor 执行 program
- program 通过 bridge 调 capability

## Core design rules
- capability 是唯一直接执行对象。
- recipe 是 docs/workflow guidance，不是 delegated runtime。
- subagent/worker 是 orchestration-layer invocation，不是 registry 中的长期能力对象。
- executor 只执行 code program，不承载 worker 认知语义。
- 审批型能力默认禁止进入 codemode toolset；优先 direct path。

## Desktop runtime flow
1. 注入固定 persona。
2. 做 capability discovery。
3. 做 route selection：`direct | worker | codemode`。
4. 基于 capability profile 做 recipe/docs 注入。
5. 按选中的路径执行。

其中：
- `route selection` 是显式 orchestration step
- `subagent/worker` 逻辑收敛到单独模块
- `local_orchestrator` 只负责调度步骤与保存上下文

## Route decision contract
建议桌面端统一输出结构化路由对象：
- `route`: `direct | worker | codemode`
- `reason_codes[]`
- `confidence`
- `task_profile`
- `route_evidence`
- `fallback_route`

最小判定优先级：
1. 用户显式指定
2. 高风险 / 审批敏感 -> `direct`
3. 单 capability 且单步 -> `direct`
4. 需要程序逻辑 -> `codemode`
5. 分析/规划/调研 -> `worker`
6. 兜底 -> `worker`

## WorkerTask contract
主 runtime 发给 worker 的最小输入应包含：
- `task_id`
- `goal`
- `user_query`
- `task_kind`: `analysis | planning | comparison | research | summarization`
- `context_summary`
- `capability_hints[]`
- `recipe_hints[]`
- `constraints`
- `output_contract`

约束：
- 默认不直接拥有 destructive capabilities
- 默认不直接写长期状态
- 默认只返回认知结果，不直接执行副作用动作

## WorkerResult contract
worker 返回的最小结构：
- `task_id`
- `status`: `completed | blocked | escalated | failed`
- `summary`
- `findings[]`
- `recommendations[]`
- `suggested_route`: `direct | worker | codemode | answer`
- `follow_up_actions[]`
- `citations_or_sources[]`
- `trace_meta`

语义要求：
- `worker` 可以建议后续 direct 或 codemode
- 但是否升级必须由主 runtime / policy 再次拍板

## Approval and policy

### Direct path
- 审批直接挂在 capability/policy 层
- 高风险动作优先 direct，以便显式审查

### Worker path
- worker 默认无 destructive authority
- 如果 worker 建议执行高风险动作，只能返回建议，不能自动执行

### CodeMode path
- bridge 继续承担运行时鉴权、approval、审计
- approval-required capability 默认不暴露给 codemode toolset

## Observability and trace
至少记录以下事件：
- `route_selected`
- `worker_task_started`
- `worker_task_completed`
- `worker_task_blocked`
- `worker_task_escalated`
- `orchestration_started`
- `bridge_call_started/completed/failed`

每次用户请求都应能回放：
- 为什么选了这条路
- worker 看到了哪些约束
- worker 给出了什么建议
- 是否发生了后续升级

## MVP implementation shape

### Phase 1: routing first
- 落地 deterministic route selector
- 在 `local_orchestrator` 中增加独立 `route_selection` step
- 先支持 `direct` 与 `codemode`，并为 `worker` 保留结构化 contract

### Phase 2: single worker invocation
- 增加 request-scoped delegated worker execution
- worker 只做分析/规划输出
- 主 runtime 负责整合 `WorkerResult`

### Phase 3: controlled escalation
- 支持 worker 返回 `suggested_route`
- 允许主 runtime 将 worker 结果升级为 direct 或 codemode

### Phase 4: future multi-worker
- 支持 planner/worker DAG
- 支持并行 worker 与 check-in
- 但不改变当前三路语义边界

## Repository direction
建议桌面端相关逻辑逐步收敛为：
- `modules/mcp/commands/runtime/route_selector`
- future `modules/mcp/commands/runtime/worker_orchestration`
- `modules/mcp/local_orchestrator` 仅做步骤接线

禁止把以下逻辑重新散落回多个模块：
- query route heuristics
- worker contract 定义
- worker trace/status 生成

## Acceptance criteria
- 桌面端能显式区分 `direct | worker | codemode`。
- `worker` 不再被表述为 assistant 切换或 skill 执行。
- `local_orchestrator` 中的 worker 接入保持为薄步骤。
- 高风险操作不会被默认提升到 codemode。
- 分析/规划类请求不会被误判成 code execution。

## Open questions
- worker 默认是 request-scoped 还是允许 session-scoped attach。
- worker 是否允许读取更完整的会话摘要而不仅是 query summary。
- 后续 planner/worker DAG 是否复用 spec-agent manifest，还是单独定义轻量桌面协议。
- UI 是否要显式展示“delegated worker active”，还是仅显示弱提示与 trace。

## Final decision
桌面端 `subagent` 的正确定位是：主 runtime 之下的 delegated worker orchestration unit，而不是新的 assistant runtime，也不是 skill/tool 的别名。桌面端长期应显式采用三路模型：默认 direct，认知委派走 worker，程序编排走 codemode。