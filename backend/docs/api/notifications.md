# 通知管理 API

用于管理员发布通知（单用户/全员）。发布后会异步投递到通知收件表。

## 权限
- `notification.manage`

## POST /admin/notifications/users/{user_id}
发布单用户通知。

请求体字段：
- `title` string，标题（必填）
- `content` string，内容（必填）
- `type` string，通知类型（默认 `system`）
- `level` string，通知级别（默认 `info`）
- `payload` object，扩展字段（非敏感）
- `source` string，来源模块/服务
- `dedupe_key` string，去重键（幂等）
- `expires_at` string(datetime)，过期时间
- `tenant_id` string(uuid)，租户 ID（可选）

响应示例：
```json
{
  "notification_id": "0e4e2c2f-9b6a-4c7a-a7a7-6bdf2d2ffb2a",
  "scheduled": true,
  "message": "Notification scheduled"
}
```

## POST /admin/notifications/broadcast
发布全员通知（默认仅激活用户）。

请求体字段：
- `title` string，标题（必填）
- `content` string，内容（必填）
- `type` string，通知类型（默认 `system`）
- `level` string，通知级别（默认 `info`）
- `payload` object，扩展字段（非敏感）
- `source` string，来源模块/服务
- `dedupe_key` string，去重键（幂等）
- `expires_at` string(datetime)，过期时间
- `tenant_id` string(uuid)，租户 ID（可选）
- `active_only` boolean，仅激活用户（默认 `true`）

响应示例：
```json
{
  "notification_id": "c4cba3de-6ff3-4e22-9194-9f76c3a1a2d4",
  "scheduled": true,
  "message": "Notification scheduled for all users"
}
```
