# Admin Dashboard Missing Backend APIs

> 路由前缀：`/api/v1`
> 鉴权：全部接口需管理员（`get_current_superuser`）

## 会话管理

- `GET /admin/conversations`
- `GET /admin/conversations/{session_id}`
- `GET /admin/conversations/{session_id}/messages`
- `GET /admin/conversations/{session_id}/summaries`
- `POST /admin/conversations/{session_id}/archive`
- `POST /admin/conversations/{session_id}/close`

支持过滤：`user_id`、`assistant_id`、`channel`、`status`、`start_time`、`end_time`。

## Agent 任务监控

- `GET /admin/spec-plans`
- `GET /admin/spec-plans/{plan_id}`
- `GET /admin/spec-plans/{plan_id}/logs`
- `GET /admin/spec-logs/{log_id}/sessions`
- `POST /admin/spec-plans/{plan_id}/pause`
- `POST /admin/spec-plans/{plan_id}/resume`

## 生成任务管理

- `GET /admin/generation-tasks`
- `GET /admin/generation-tasks/{task_id}`
- `GET /admin/generation-tasks/{task_id}/outputs`
- `GET /admin/generation-shares`
- `PATCH /admin/generation-shares/{share_id}`

`PATCH` 请求体：

```json
{
  "is_active": false
}
```

## 计费与配额管理

- `GET /admin/quotas`
- `GET /admin/quotas/{tenant_id}`
- `PATCH /admin/quotas/{tenant_id}`
- `POST /admin/quotas/{tenant_id}/adjust`
- `GET /admin/billing/transactions`
- `GET /admin/billing/transactions/{transaction_id}`
- `GET /admin/billing/summary`

`POST /admin/quotas/{tenant_id}/adjust` 请求体：

```json
{
  "amount": 100,
  "reason": "manual recharge"
}
```

## 网关日志管控台

- `GET /admin/gateway-logs`
- `GET /admin/gateway-logs/{log_id}`
- `GET /admin/gateway-logs/stats`

`stats` 返回：`success_rate`、`cache_hit_rate`、`error_distribution`、`model_ranking`、`latency_histogram`。

口径说明（`/admin/gateway-logs/stats`）：

- `success_rate` 仅统计 `2xx/3xx` 为成功。
- `status_code <= 0`（如历史异常日志）不计入成功，避免错误请求被算成成功。
- `error_distribution` 优先按 `error_code` 聚合；无 `error_code` 时回退到 `status_code` 分桶。

## 知识库审核

- `GET /admin/knowledge/artifacts`
- `GET /admin/knowledge/artifacts/{artifact_id}`

支持过滤：`status`、`artifact_type`、`q`。

## 插件管理

- `GET /admin/plugins`
- `GET /admin/plugins/{plugin_name}`
- `POST /admin/plugins/{plugin_name}/reload`

## 通知管理（Admin）

- `GET /admin/notifications`
- `POST /admin/notifications/users/{user_id}`
- `POST /admin/notifications/broadcast`

`GET /admin/notifications` 支持过滤：`type`、`level`、`source`、`q`、`is_active`，并返回 offset 分页结构（`items/total/skip/limit`）。

## 智能路由分析（Routing MAB）

- `GET /admin/routing-mab/overview`
- `GET /admin/routing-mab/strategy`
- `GET /admin/routing-mab/arms`
- `GET /admin/routing-mab/skills`
- `GET /admin/routing-mab/assistants`

`GET /admin/routing-mab/assistants` 支持查询参数：

- `min_trials`：最小试用次数（可选）
- `min_rating`：最小评分 0~1（可选）
- `limit`：返回条数上限，默认 50（可选）
- `sort`：`score_desc` / `rating_desc` / `trials_desc` / `recent_desc`（可选）

响应示例：

```json
{
  "assistants": [
    {
      "assistantId": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
      "name": "Expert A",
      "summary": "summary",
      "totalTrials": 20,
      "positiveFeedback": 16,
      "negativeFeedback": 4,
      "ratingScore": 0.7727,
      "mabScore": 0.7727,
      "routingScore": 0.5795,
      "selectionRatio": 0.8,
      "explorationBonus": 0.0,
      "lastUsedAt": "2026-01-16T09:42:01+08:00",
      "lastFeedbackAt": "2026-01-16T09:45:01+08:00",
      "isExploring": false
    }
  ]
}
```
