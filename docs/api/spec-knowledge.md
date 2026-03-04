# Spec Knowledge 审核 API

> 路由前缀：`/api/v1/admin/spec-knowledge-candidates`

## 1. 候选区列表

权限：仅超级管理员可访问。

**GET** `/admin/spec-knowledge-candidates`

Query：
- `status`（可选）：候选状态过滤

候选状态（示例）：
- `pending_signal` / `pending_eval` / `pending_review`
- `approved` / `rejected` / `disabled`

响应（分页）：
```json
{
  "items": [
    {
      "id": "uuid",
      "canonical_hash": "sha256",
      "status": "pending_review",
      "plan_id": "uuid",
      "user_id": "uuid",
      "project_name": "My Plan",
      "usage_stats": {
        "positive_feedback": 3,
        "negative_feedback": 0,
        "apply_count": 2,
        "revert_count": 0,
        "error_count": 0,
        "total_runs": 2,
        "success_runs": 2,
        "success_rate": 1.0,
        "unique_sessions": 2
      },
      "eval_snapshot": {
        "static_pass": true,
        "llm_score": 92,
        "critic_reason": "通用性较强"
      },
      "review_status": "pending",
      "last_positive_at": "2026-01-27T10:00:00Z",
      "last_negative_at": null,
      "last_eval_at": "2026-01-27T10:05:00Z",
      "promoted_at": null,
      "created_at": "2026-01-27T09:59:00Z",
      "updated_at": "2026-01-27T10:05:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "size": 10
}
```

## 2. 通过候选

权限：仅超级管理员可访问。

**POST** `/admin/spec-knowledge-candidates/{candidate_id}/approve`

请求体：
```json
{
  "reason": "审核通过"
}
```

响应：返回候选详情（同上）。

错误码：
- 400 `candidate_not_promotable`
- 404 `candidate_not_found`

## 3. 拒绝候选

权限：仅超级管理员可访问。

**POST** `/admin/spec-knowledge-candidates/{candidate_id}/reject`

请求体：
```json
{
  "reason": "包含危险指令"
}
```

响应：返回候选详情（同上）。

错误码：
- 400 `candidate_not_rejectable`
- 404 `candidate_not_found`
