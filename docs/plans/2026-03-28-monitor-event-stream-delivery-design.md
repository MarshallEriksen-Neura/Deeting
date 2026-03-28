# Monitor Event Stream Delivery Design

Date: 2026-03-28

## Summary

`desktop local` 下的 `主动寻猎` 应从“页面主导的监控台”收敛为“通知型异步代理”。

本次设计不替换桌面端现有聊天/runtime 内核，而是在其上新增一层 `monitor run wrapper`：

- 底层继续复用桌面端 runtime 作为唯一执行真相
- `monitor` 只负责把一次任务执行包装成 `run`
- `IM`、页面记录、后续渠道通知都消费同一条 `execution-to-delivery event stream`

目标不是新造第二套 runtime，而是把当前散落在 `emit_status / result / notify` 里的真相统一起来。

## Goals

- 保持桌面端 runtime 为唯一执行内核。
- 为 monitor 引入稳定的 `RunEvent` schema。
- 将“是否通知、通知多细、无变化怎么办”从执行逻辑中拆出，形成任务级 delivery policy。
- 将页面从 dashboard 心智改成“任务与记录”心智。
- 保留本地执行日志作为运行真相，并让其事件结构可被页面与 IM 复用。

## Non-Goals

- 本轮不重写 desktop local orchestrator。
- 本轮不新增 Webhook、Email 等新通知渠道。
- 本轮不把 monitor 扩展为完整 workflow engine。
- 本轮不追求一次性事件 sourcing 全量重构。

## Product Boundary

### 1. IM is the primary delivery surface

用户主要通过：

- 飞书
- Telegram
- 微信

接收主动寻猎的运行结果与阶段性进展。

### 2. Page is control + audit

页面保留：

- 任务列表
- 创建/编辑
- 暂停/恢复
- 手动触发
- 历史执行记录
- 通知渠道配置入口

页面弱化：

- 实时统计卡片
- 长轮询“正在运行中”的 dashboard 心智

### 3. Local logs remain runtime truth

本地执行日志不是附属调试信息，而是 monitor 的审计真相：

- 一次 run 的生命周期
- 每个阶段的变化
- 工具轨迹摘要
- 最终结论 / 失败原因
- 投递失败信息

## Current Seams

### 1. Execution truth is already partially present

当前 `monitor` 已在运行中累计 `events`：

- `emit_status()` 把阶段状态写入 `ctx.events`
- `record_execution_success()` 将 `events` 持久化进执行日志
- 页面日志抽屉已经显示 `output_data.events`

问题不是没有事件，而是事件没有成为对外稳定产品 contract。

### 2. Notification truth is still split

当前通知分支仍是：

- 仅显著变化发送
- 熔断挂起发送
- 其余运行过程仅记录，不参与统一投递

这导致：

- IM 收到的是分支结果，而不是完整 run truth
- 页面与 IM 的心智分裂
- 后续卡片更新无法围绕稳定 `execution_id` 组织

### 3. Frontend still thinks in dashboard terms

当前 monitor 页面仍保留：

- stats row
- 30s 任务/统计轮询
- 15s 日志轮询

这和“通知型异步代理”的产品心智不一致。

## Core Architecture

### 1. Keep the existing desktop runtime

底层继续复用：

- `desktop_runtime::local_orchestrator`
- 现有审批挂起/恢复
- 现有 tool trace / tool trace blocks
- 会话消息写回

`monitor` 不得再造第二套执行平面。

### 2. Add a monitor run wrapper

每次任务触发，monitor 创建一个新的 `run` 包装层：

```text
task trigger
  -> create execution context
  -> invoke existing monitor execution/runtime path
  -> normalize runtime signals into RunEvent
  -> persist run projection
  -> evaluate delivery policy
  -> deliver to channel adapters
```

这一层负责新增：

- `execution_id`
- 稳定事件序列
- 任务级 delivery policy
- delivery failure 记录

### 3. Make consumers read events, not branches

后续三类消费者统一读 event stream：

- IM delivery
- 页面 execution log
- 本地统计/后续分析

这意味着旧的“是否显著变化就直接发通知”逻辑要降级为 delivery planner 的一个规则，而不是主执行路径上的分支。

## Canonical RunEvent Schema

第一版建议最小字段：

```ts
type RunEvent = {
  event_id: string
  execution_id: string
  task_id: string
  occurred_at: string
  seq: number
  kind:
    | "run_started"
    | "stage_changed"
    | "tool_called"
    | "tool_succeeded"
    | "tool_failed"
    | "run_completed"
    | "run_failed"
    | "delivery_failed"
  stage?: string
  step?: string
  state?: "running" | "success" | "failed" | "info"
  summary?: string
  meta?: Record<string, unknown>
}
```

### Mapping guidance

- `run_started`: wrapper 显式发出
- `stage_changed`: 由现有 `emit_status()` 投影而来
- `tool_*`: 由 `tool_trace` / `tool_trace_blocks` 投影而来
- `run_completed`: wrapper 在成功结束后显式发出
- `run_failed`: wrapper 在执行失败后显式发出
- `delivery_failed`: 由渠道发送失败补发

## Delivery Policy

delivery policy 主放在 `task` 级，不放在 channel 级。

原因：

- “这类任务是否打扰用户”是任务语义
- “这个渠道支持什么交付形态”是渠道语义

### Task-level policy

首版主策略字段：

- `notify_on_change`
- `notify_on_failure`
- `heartbeat_enabled`
- `heartbeat_cron`
- `include_run_started`
- `detail_level`
- `silent_hours`
- `auto_pause_after_consecutive_failures`

默认建议：

- 变化时通知
- 失败时通知
- 每日一次心跳摘要
- 默认粒度 `stage`
- 不默认推送 `run_started`

### Channel capabilities

首版只围绕当前真实渠道：

- `feishu`
- `telegram`
- `wechat`

能力约束：

- 飞书：富交付、卡片/交互优先
- Telegram：thread text 优先
- 微信：压缩文本优先

## Channel Mapping

### 1. Feishu

优先做：

- 单 run 对应单卡片
- 阶段更新尽量落在同一交付对象上
- 支持审批卡片和结果卡片统一心智

### 2. Telegram

优先做：

- 首条 anchor message
- 后续都走 reply thread
- 保持稳定文本模板

### 3. WeChat

优先做：

- 压缩文本通知
- 默认只发变化 / 失败 / 心跳
- 不追求阶段刷屏

## Frontend Direction

### 1. Remove dashboard emphasis

页面不再强调：

- 运行中数量
- 已暂停数量
- 累计 token

对应实现上：

- 删除 stats row
- 停止默认自动轮询

### 2. Keep explicit refresh moments

页面数据刷新改成：

- 首次读取
- 用户手动刷新
- 创建/编辑/暂停/恢复/手动触发之后显式刷新

### 3. Keep execution log drawer as audit surface

日志抽屉继续保留，但显示应逐步切向：

- RunEvent timeline
- 结论摘要
- 失败原因
- 必要的 tool summary

## Storage Strategy

第一阶段不强制拆新表。

先沿用现有执行日志存储：

- `local_monitor_execution_logs`
- `output_data.events`

只要 `events` 从 ad-hoc status payload 升级为稳定 `RunEvent[]` 即可。

后续如果需要更强查询能力，再拆出：

- `local_monitor_run_events`
- `local_monitor_delivery_receipts`

## Migration Stance

旧逻辑里直接通知的分支应该逐步删除：

- 保留现有 channel senders
- 删除“显著变化 -> 直接发通知”的主路径地位
- 改为 `RunEvent -> DeliveryIntent -> ChannelAdapter`

过时实现如果与新 event stream 冲突，建议直接删除，不做长期兼容层。

## Verification Targets

本轮完成标准应是：

- monitor 执行日志里的 `events` 变成稳定 `RunEvent[]`
- notification delivery 不再直接依赖“显著变化分支”
- monitor 页面不再默认轮询 stats/logs
- monitor 页面不再展示 stats row
- 触发、暂停、恢复、编辑后仍能正常刷新页面

