# 主动监控与异步触达 API

用于创建和管理主动监控任务，支持定时研判、显著变化触达、失败熔断。

## 鉴权

- 所有接口均需登录态（`Bearer Token`）。

## 数据模型说明

- `status`: `active | paused | failed_suspended`
- `cron_expr`: 5 段 Cron 表达式（`minute hour day month weekday`）
- `allowed_tools`: 后台任务可调用的工具白名单，工具名必须匹配 `^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$`，最多 32 个
- `execution_target`: 执行目标，支持 `desktop | cloud`
  - `desktop`（默认，推荐）：仅由桌面端领取并本地执行，不走云端推理
  - `cloud`：由云端 Celery worker 执行
  - 兼容说明：历史值 `desktop_preferred` 仍可传入，但会按 `desktop` 处理，不再回落云端
- `notify_config`: 任务级通知配置；命中敏感键（如 `webhook/token/secret/password`）的值会自动加密存储，接口返回时会脱敏为 `***`
  - 当前支持 `channel_ids: string[]`（通知渠道 ID 列表，来自 `/api/v1/notification-channels`）。
  - 监控任务触发通知时，若配置了 `channel_ids`，会按优先级向这些渠道依次发送（不提前短路）；未配置时按用户全量启用渠道与优先级发送（首个成功后停止）。

---

## POST /api/v1/monitors

创建监控任务。

请求体：

- `title` string，必填，任务名
- `objective` string，必填，监控目标描述
- `cron_expr` string，可选，默认 `0 */6 * * *`
- `notify_config` object，可选
- `allowed_tools` array，可选
- `execution_target` string，可选，默认 `desktop`

约束：

- 仅 `cloud` 模式下，`cron_expr` 频率不能低于系统最小间隔（默认 5 分钟）。
- 若过于高频，接口返回 `400`，错误信息包含“Cron 频率过高”。

成功响应（201）：

```json
{
  "id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
  "title": "伊朗局势监控",
  "status": "active",
  "message": "任务创建成功并已关联态势助手",
  "assistant_id": "2e3ac467-437a-4238-a34d-61f1cb95f4cb",
  "execution_target": "desktop"
}
```

失败响应（400）：

```json
{
  "detail": "Cron 表达式非法: Cron 表达式必须是 5 段"
}
```

---

## GET /api/v1/monitors

获取当前用户监控任务（分页）。

查询参数：

- `skip` int，默认 `0`
- `limit` int，默认 `100`

---

## GET /api/v1/monitors/stats

获取当前用户任务统计：

- `total_tasks`
- `active_tasks`
- `paused_tasks`
- `failed_suspended_tasks`
- `total_tokens`
- `total_executions`

---

## GET /api/v1/monitors/{task_id}

获取任务详情。

- 不存在返回 `404`
- 非本人任务返回 `403`

---

## PATCH /api/v1/monitors/{task_id}

更新任务字段。

可更新字段：

- `title`
- `objective`
- `cron_expr`
- `status`
- `notify_config`
- `allowed_tools`
- `execution_target`

说明：

- `cron_expr` 会做格式校验（非法返回 `400`）。
- `cron_expr` 还会做最小执行间隔校验（过于高频返回 `400`）。
- `status/cron_expr` 变更会自动重建调度索引。

---

## POST /api/v1/monitors/{task_id}/pause

暂停任务（状态改为 `paused`，并从调度索引移除）。

---

## POST /api/v1/monitors/{task_id}/resume

恢复任务（状态改为 `active`，并重新写入调度索引）。

---

## POST /api/v1/monitors/{task_id}/trigger

立即触发一次异步研判。

说明：

- 该接口为“手动触发”，会强制发送通知（不受 `is_significant_change` 是否为 `true` 的限制）。
- `cloud` 模式采用即时投递（不加随机抖动），触发后会尽快进入 `reasoning_worker`。
- 非 `cloud` 模式不会触发云端推理，而是将任务标记为“本地立即执行”，等待桌面端领取。
- 定时调度触发仍保持原行为：仅在检测到显著变化时发送通知。
- 手动触发受冷却时间保护（默认同一用户同一任务 30 秒内仅允许一次）。

可能错误：

- `429 Too Many Requests`：手动触发过于频繁，请稍后重试。

成功响应：

```json
{
  "task_id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
  "message": "已提交执行"
}
```

---

## 桌面端执行接入

### POST /api/v1/monitors/local/heartbeat

桌面端上报在线心跳。

请求体：

- `agent_id` string，必填，桌面实例标识（建议稳定 UUID）

### POST /api/v1/monitors/local/pull

桌面端拉取“到期且应由本地执行”的任务。

请求体：

- `agent_id` string，必填
- `limit` int，可选，默认 `5`，最大 `20`

响应字段：

- `items[]`: 本次领取任务列表（含 `task_id/title/objective/cron_expr/allowed_tools/model_id/last_snapshot/execution_target/claimed_until`）
- `claimed`: 本次领取数量

### POST /api/v1/monitors/local/{task_id}/report

桌面端回传执行结果。

请求体：

- `agent_id` string，必填
- `status` string，必填，`success | failure | skipped`
- `is_significant_change` bool，可选
- `change_summary` string，可选
- `new_snapshot` object，可选
- `tokens_used` int，可选
- `error_message` string，可选
- `force_notify` bool，可选
- `model_id` / `strategy` string，可选

---

## DELETE /api/v1/monitors/{task_id}

软删除任务（`is_active=false`，并从调度索引移除）。

---

## GET /api/v1/monitors/{task_id}/logs

获取执行日志（分页）。

日志状态：

- `success`
- `failure`
- `skipped`

成功响应（200）：

```json
{
  "items": [
    {
      "id": "934cab76-5fa7-40f2-9943-e1d667ecf0af",
      "task_id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
      "triggered_at": "2026-03-01T11:20:00Z",
      "status": "success",
      "input_data": {
        "source": "scheduler"
      },
      "output_data": {
        "is_significant_change": true
      },
      "tokens_used": 128,
      "error_message": null,
      "created_at": "2026-03-01T11:20:05Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "limit": 50
}
```

---

## 后台执行行为（实现说明）

- 调度中心由 Celery Beat 每 30 秒触发 `scheduler_task`，优先从 Redis ZSET（`monitor:schedule:zset`）弹出到期任务并投递推理队列。
- `bootstrap_schedule` 周期扫描 active 任务并重建 Redis 调度索引；仅在 Redis 不可用时降级为 DB 到期扫描。
- `desktop` 任务不会进入云端调度执行；历史值 `desktop_preferred` 与 `desktop` 等价（仅本地执行）。
- `next_run_at` 统一由 `cron_expr` 计算，并回写到 DB（用于审计与降级兜底）。
- 触发研判时会自动加入 `0~120s` 随机抖动，平滑并发峰值。
- 调度器每个 tick 有全局触发上限与单用户上限（默认 `50` / `3`）；超限任务会按背压延后（默认 60 秒）而不是立即触发。
- 研判输出强制 JSON Schema：

```json
{
  "is_significant_change": true,
  "change_summary": "Markdown",
  "new_snapshot": {
    "key_metrics": {}
  }
}
```

- 若 `is_significant_change=true`，才会进入通知队列。
- `reasoning_worker` 与 `notification_worker` 均启用指数退避重试（`max_retries=3`）；连续失败超过阈值后任务置为 `failed_suspended`。
- worker 达到最大重试后会写入 `deeting_monitor_dead_letter`（DLQ 表），并向用户发送系统级告警通知。

调度保护配置（环境变量）：

- `MONITOR_MIN_CLOUD_INTERVAL_MINUTES`：云端最小 Cron 间隔分钟数（默认 `5`）
- `MONITOR_MAX_TRIGGER_PER_TICK`：每个调度 tick 最多触发任务数（默认 `50`）
- `MONITOR_MAX_TRIGGER_PER_USER_PER_TICK`：每个调度 tick 单用户最多触发任务数（默认 `3`）
- `MONITOR_BACKPRESSURE_DELAY_SECONDS`：超限任务的延后秒数（默认 `60`）
- `MONITOR_MANUAL_TRIGGER_COOLDOWN_SECONDS`：手动触发冷却秒数（默认 `30`）
- `MONITOR_DESKTOP_HEARTBEAT_TTL_SECONDS`：桌面心跳存活时间（默认 `120` 秒）
- `MONITOR_LOCAL_CLAIM_LEASE_SECONDS`：桌面领取任务租约时长（默认 `180` 秒）
- `MONITOR_DESKTOP_PULL_MAX_LIMIT`：桌面单次拉取任务上限（默认 `20`）

---

## Agent 工具

### sys_create_monitor

创建任务，支持参数：

- `title`
- `objective`
- `cron_expr`
- `initial_strategies`
- `notify_config`
- `allowed_tools`

### sys_list_monitors

列出任务与成本概览。

### sys_update_monitor

更新任务：

- `action=pause | resume | update | delete`
- `cron_expr` / `title` / `objective` / `notify_config` / `allowed_tools`（`action=update` 时生效）

---

## 飞书回调动作

`POST /api/v1/monitors/feishu/callback` 支持以下事件：

- `useful` / `useless`：写入 trace feedback
- `pause`：暂停对应监控任务
- `dialogue`：返回“立即对话”提示（包含助手会话入口）

安全要求：

- 必须携带飞书签名头（`X-Lark-Request-Timestamp` / `X-Lark-Request-Nonce` / `X-Lark-Signature`）。
- 服务端会做时间窗校验与 nonce 防重放校验。
- 需要配置 `FEISHU_CALLBACK_SECRET`，否则回调接口会拒绝请求。

### 飞书应用机器人消息事件

`POST /api/v1/monitors/feishu/events` 用于飞书应用机器人事件订阅（`im.message.receive_v1`）：

- 群聊场景：仅当消息中 `@机器人` 时触发自动回复。
- 私聊场景：文本消息直接触发自动回复。
- 仅处理 `message_type=text`，其余事件会返回 `code=0` 并忽略。
- 回调收到后会异步投递 Celery 任务 `app.tasks.monitor.feishu_message_reply`，接口立即返回 `{"code":0}`。

配置项：

- `FEISHU_CALLBACK_SECRET`：飞书事件签名密钥（与卡片回调共用）。
- `FEISHU_BOT_APP_ID` / `FEISHU_BOT_APP_SECRET`：应用级默认凭证（仅作为兜底）。
- `FEISHU_BOT_OPEN_ID` / `FEISHU_BOT_MODEL` / `FEISHU_BOT_SYSTEM_PROMPT`：全局兜底配置（可选）。

多用户推荐做法（按渠道配置覆盖，优先级高于环境变量）：

- 在 `user_notification_channel` 的 `feishu` 渠道 `config` 中按群维度配置：
  - `chat_ids: ["oc_xxx", "..."]` 或 `chat_id: "oc_xxx"`（用于把群映射到用户渠道）
  - `bot_app_id` / `bot_app_secret`（可选，允许每个用户/渠道独立应用）
  - `bot_open_id`（可选，精准识别 @机器人）
  - `bot_model`（可选，用户级回复模型）
  - `bot_system_prompt`（可选，用户级提示词）
