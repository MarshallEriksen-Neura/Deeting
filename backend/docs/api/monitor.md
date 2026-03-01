# 主动监控与异步触达 API

用于创建和管理主动监控任务，支持定时研判、显著变化触达、失败熔断。

## 鉴权

- 所有接口均需登录态（`Bearer Token`）。

## 数据模型说明

- `status`: `active | paused | failed_suspended`
- `cron_expr`: 5 段 Cron 表达式（`minute hour day month weekday`）
- `allowed_tools`: 后台任务可调用的工具白名单，工具名必须匹配 `^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$`，最多 32 个
- `notify_config`: 任务级通知配置；命中敏感键（如 `webhook/token/secret/password`）的值会自动加密存储，接口返回时会脱敏为 `***`

---

## POST /api/v1/monitors

创建监控任务。

请求体：

- `title` string，必填，任务名
- `objective` string，必填，监控目标描述
- `cron_expr` string，可选，默认 `0 */6 * * *`
- `notify_config` object，可选
- `allowed_tools` array，可选

成功响应（201）：

```json
{
  "id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
  "title": "伊朗局势监控",
  "status": "active",
  "message": "任务创建成功并已关联态势助手",
  "assistant_id": "2e3ac467-437a-4238-a34d-61f1cb95f4cb"
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

说明：

- `cron_expr` 会做格式校验（非法返回 `400`）。
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

成功响应：

```json
{
  "task_id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
  "message": "已提交执行"
}
```

---

## DELETE /api/v1/monitors/{task_id}

软删除任务（`is_active=false`，并从调度索引移除）。

---

## GET /api/v1/monitors/{task_id}/logs

获取执行日志（分页）。

日志状态：

- `success`
- `failure`

---

## 后台执行行为（实现说明）

- 调度中心由 Celery Beat 每 30 秒触发 `scheduler_task`，优先从 Redis ZSET（`monitor:schedule:zset`）弹出到期任务并投递推理队列。
- `bootstrap_schedule` 周期扫描 active 任务并重建 Redis 调度索引；仅在 Redis 不可用时降级为 DB 到期扫描。
- `next_run_at` 统一由 `cron_expr` 计算，并回写到 DB（用于审计与降级兜底）。
- 触发研判时会自动加入 `0~120s` 随机抖动，平滑并发峰值。
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
