# 助手审核 API（管理员）

- 前置条件：需要 `assistant.manage` 权限（Bearer Token），路由前缀 `/api/v1`。
- 审核对象：`entity_type = assistant_market`。

## 列出审核任务

- `GET /admin/assistant-reviews`
- Query：`cursor` / `size` / `status`
- 响应：`CursorPage[ReviewTaskDTO]`

## 审核通过

- `POST /admin/assistant-reviews/{assistant_id}/approve`
- Body：
  ```json
  {
    "reason": "looks good"
  }
  ```
- 响应：`ReviewTaskDTO`

## 审核拒绝

- `POST /admin/assistant-reviews/{assistant_id}/reject`
- Body：
  ```json
  {
    "reason": "缺少必要描述"
  }
  ```
- 响应：`ReviewTaskDTO`

---

变更记录
- 2026-01-15：新增助手审核列表/通过/拒绝接口。
