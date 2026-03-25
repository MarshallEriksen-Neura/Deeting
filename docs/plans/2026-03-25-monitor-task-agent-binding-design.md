# Monitor Task Agent Binding Design

Date: 2026-03-25

## Summary

`desktop local` 下的 `主动寻猎` 应从“自带一套半独立研判逻辑的 monitor”收敛为“必须绑定一个已有任务智能体的自动化任务壳层”。

这次设计把 `任务智能体` 提升为一等公民：

- `任务智能体` 是唯一执行主体
- `主动寻猎` 负责调度、快照、通知、日志
- `策略层` 继续保留，但上升为绑定智能体之上的系统内部 policy layer，而不是 monitor 私有 prompt 配置

目标不是给 monitor 再补更多配置，而是消除 monitor 与 task agent 并行维护两套执行脑的问题。

## Why now

当前本地 monitor 已经暴露出明显的架构分裂：

- `local_monitor_tasks` 表已经预留 `assistant_id` / `model_id`
- monitor UI 文案已经暗示“自动孵化专属 AI 助手”
- 但实际执行路径仍然是 monitor 自己拼 prompt、自己选模型、自己解析自由文本

与此同时，`custom_task_agent` 已经具备更稳定的执行基础：

- 持久化 profile
- 显式模型配置
- MCP tool 绑定
- guidance skill / skill action 绑定
- 可复用的 worker profile 执行路径

继续让 monitor 维持“裸调用 + prompt 拼接”的执行模型，会让产品语义与实际架构长期漂移。

## Goals

- 让 `主动寻猎` 必须绑定一个已有的 `chat` 型任务智能体。
- 让绑定的任务智能体成为 monitor 的唯一执行主体。
- 让 monitor 只拥有自动化任务职责，而不再拥有独立 AI 人格或独立工具绑定真源。
- 保留“越来越智能”的产品能力，但将其提升为系统内部策略层。
- 为后续 desktop workflow/runtime 演进保留一致的 worker-profile 方向。

## Non-Goals

- 本轮不允许绑定 `image_generation` 或 `text_to_speech` 型任务智能体。
- 本轮不把 monitor 直接升级为完整 workflow runtime。
- 本轮不自动为历史 monitor 生成新的 task agent profile。
- 本轮不把策略臂作为底层术语直接暴露为面向用户的主配置。

## Core stance

### 1. Task agents are the only execution brains

绑定完成后，monitor 不再单独拥有以下真源：

- prompt
- model selection
- MCP tool allowlist
- guidance skill binding
- callable skill action binding

这些都统一回到绑定的任务智能体。

### 2. Monitor is a scheduling shell, not a second assistant system

monitor 只负责：

- 何时运行
- 监控什么
- 保存哪些历史快照
- 何时通知
- 如何记录执行轨迹和用户反馈

换句话说，monitor 是自动化任务基础设施，不是第二套智能体中心。

### 3. Policy layer survives, but above the agent

不建议删除策略臂能力。

正确做法是把它从“monitor 里的几段策略 prompt”提升成“绑定智能体之上的自适应策略系统”，由系统根据历史执行结果、用户反馈、成本与命中效果动态优化本轮执行方式。

## Current seams

### 1. Monitor persistence already hints at binding, but does not enforce it

`local_monitor_tasks` 目前已经有：

- `assistant_id`
- `model_id`

但 create/update request 并未把 `assistant_id` 作为必填输入，创建时也没有真正落下绑定关系。

### 2. Monitor runtime still uses a direct model path

当前 monitor 执行链是：

`resolve model -> build_monitor_prompt -> invoke model -> parse text/json`

这意味着：

- 执行人格是 monitor 自己硬编码的
- 工具边界依赖 monitor 自身字段
- 任务智能体的绑定能力没有真正成为执行真源

### 3. Worker profile path already exists elsewhere

当前 task agent 已能作为 `user_worker_profile:*` 被执行。

这说明系统里已经存在“持久化 profile -> 受控执行”的正统路径，monitor 应该复用它，而不是继续维持独立执行栈。

## Product direction

### 1. New monitor creation flow

新建主动寻猎任务时，必须先绑定一个已有的 `chat` 型任务智能体。

UI 首版建议暴露以下配置：

- 绑定任务智能体
- 监控目标
- 执行频率
- 通知渠道
- 研判模式

其中：

- “绑定任务智能体”是必选项
- “研判模式”是轻量产品入口，不暴露策略臂底层实现

### 2. Product copy

建议产品表达调整为：

- `任务智能体`：决定这个寻猎者是谁、会什么、能调用什么
- `主动寻猎任务`：决定它盯什么、多久执行一次、如何通知你
- `自动优化`：系统会根据反馈持续调整研判方式

不建议继续使用“自动孵化专属 AI”这种暗示自动生成新智能体的说法，除非系统真的实现了 profile 自动孵化。

### 3. Task card and detail panel

任务卡片和日志详情应该明确展示：

- 当前绑定的任务智能体名称
- 当前研判模式
- 最近一次执行使用的策略标签
- 最近一次执行模型来源于哪个 task agent profile

## Target architecture

### 1. Runtime flow

目标执行链：

```text
monitor scheduler
  -> load bound task agent profile
  -> build monitor context packet
  -> resolve policy arm for this run
  -> execute bound chat task agent
  -> normalize structured monitor result
  -> persist snapshot / execution log / feedback signal
  -> emit notifications if needed
```

### 2. Responsibility split

`custom_task_agent` 负责：

- task prompt
- model config
- callable MCP tools
- guidance skills
- callable skill actions
- execution identity

`monitor` 负责：

- cron / interval
- monitored objective
- last snapshot
- next run scheduling
- execution logs
- notification channels
- user feedback

`policy layer` 负责：

- 本轮研判风格选择
- 历史上下文注入策略
- 工具预算倾向
- 风险优先级倾向
- reward / weight 调整

### 3. Structured output adapter

即使 monitor 改为执行绑定的 task agent，也不能直接信任自由文本。

monitor 需要一个强制收敛层，将 task agent 输出规范到固定 contract：

- `is_significant_change`
- `change_summary`
- `new_snapshot`
- `strategy_tag`（新增，可选）
- `observations`（新增，可选）

允许 task agent 自由思考和用工具，但 monitor 最终入库和通知依赖的必须是结构化结果，而不是随意 markdown。

## Policy layer design

### 1. User-facing surface

首版只暴露高层研判模式：

- `concise`
- `deep`
- `alert_first`

这不是底层策略臂本身，而是用户对策略系统的高层偏好。

### 2. Internal policy arms

系统内部可以继续维护多个策略臂，但应从 prompt 片段提升为结构化 policy：

- `reasoning_style`
- `context_budget_policy`
- `tool_budget_policy`
- `alert_threshold_policy`
- `cost_sensitivity`

### 3. Learning signals

策略权重调整可使用：

- 用户 feedback 分数
- 是否命中显著变化
- 通知后是否被用户查看/恢复/继续追踪
- token 成本
- 失败率和解析失败率

### 4. Policy boundary

策略层只能“驱动绑定智能体更好执行”，不能替代绑定智能体的身份和能力边界。

也就是说：

- policy 可以加 overlay
- policy 不可以私自切换到 monitor 自己的独立模型/工具体系

## Data truth and schema changes

### 1. Monitor task contract

建议将 monitor task contract 改成：

- `assistant_id` 必填
- 仅允许引用本地已启用、未删除、`chat` 类型的 task agent
- `model_id` 从“持久化配置真源”降级为“最近一次执行观测字段”或直接删除

### 2. Strategy storage

建议将当前 monitor 的策略能力拆成两层：

- `analysis_mode`: 用户显式选择的高层模式
- `policy_state_json`: 系统内部策略状态与权重

不建议继续把策略仅表示为前端临时 prompt 列表。

### 3. Execution log shape

建议 monitor execution log 增加可选字段：

- `assistant_id`
- `assistant_name`
- `strategy_tag`
- `policy_snapshot`
- `normalized_output_version`

这样后续调试时能明确区分：

- 是绑定的智能体行为问题
- 还是策略层选型问题
- 还是 monitor 适配层问题

## Migration

### 1. Existing tasks

历史未绑定 monitor task 不建议继续直接运行旧逻辑。

推荐迁移策略：

- 将历史任务标记为 `binding_required`
- UI 展示“绑定任务智能体后继续”
- 未绑定前不允许恢复运行

### 2. No automatic agent generation

本轮不建议为旧 monitor 自动生成 task agent profile，因为这会制造大量来源不明的 profile，并且把“智能体是一等公民”的理念重新弱化成系统代用户偷偷造对象。

### 3. Backward compatibility

允许读取旧任务，但不再允许以旧执行栈继续运行。

兼容的重点应是：

- 可以看到旧数据
- 可以完成绑定迁移
- 迁移后进入新执行链

## UX constraints

- monitor 创建和编辑页都必须展示已绑定 task agent
- 不能让用户误以为 monitor 还能单独配置另一套模型和工具
- 不要同时展示“task agent prompt”和“monitor prompt”两套人格字段
- 如果绑定的 task agent 被禁用或删除，monitor 进入不可执行状态，并给出明确修复入口

## Acceptance criteria

- 新建主动寻猎任务必须绑定一个已有 `chat` 型任务智能体。
- monitor runtime 不再走当前 `build_monitor_prompt -> direct model invoke` 的裸调用主链。
- 绑定智能体成为模型、prompt、工具权限的唯一真源。
- monitor 仍可基于结构化结果完成快照、通知、日志、反馈闭环。
- 策略层继续存在，但只作为系统内部 policy layer，不再成为 monitor 的独立执行脑。
- 旧任务能被识别并进入“待绑定迁移”状态，而不是继续偷偷走旧逻辑。

## Recommended implementation stance

实现上建议优先做“绑定已有 task agent + monitor 结构化适配层 + 轻量 analysis_mode”，先不要把完整自适应策略学习一次性做深。

正确顺序应该是：

1. 先让执行真源统一到 task agent
2. 再让 monitor 的结构化 contract 稳定
3. 最后逐步把策略层从静态模式演进到自适应优化

这样能先解决当前最核心的不稳定问题，同时保留产品上“越来越智能”的上升空间。
