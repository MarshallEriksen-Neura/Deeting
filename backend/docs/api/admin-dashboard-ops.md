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
