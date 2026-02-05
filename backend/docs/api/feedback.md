# Feedback API

用于记录用户对某次响应的评分，并触发归因更新（Skill/Assistant/Bandit）。

## 1. 记录反馈

**端点**: `POST /v1/feedback`

### 请求头

```http
Authorization: Bearer <access_token>
```

### 请求体

```json
{
  "trace_id": "trace_abc123",
  "score": -1.0,
  "comment": "回答未命中预期",
  "tags": ["ux", "quality"]
}
```

**参数说明**:
- `trace_id`：请求追踪 ID（响应头或日志返回）
- `score`：评分范围 `-1.0 ~ 1.0`
- `comment`：可选备注
- `tags`：可选标签

### 响应体

```json
{
  "id": "c1f9e4d2-9bcd-4a4a-8f61-6c1a1c2b3d4e",
  "trace_id": "trace_abc123",
  "score": -1.0,
  "comment": "回答未命中预期",
  "tags": ["ux", "quality"],
  "created_at": "2026-02-04T12:00:00Z",
  "updated_at": "2026-02-04T12:00:00Z"
}
```
