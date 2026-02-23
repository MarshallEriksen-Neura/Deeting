# Memory API

## 用户记忆（User Memory）

### `GET /api/v1/memory`
- 鉴权：`Bearer` 用户令牌
- 说明：分页读取当前登录用户的个人长期记忆
- Query:
  - `limit`（可选，默认 `20`，范围 `1-100`）
  - `cursor`（可选，分页游标）
- 响应：
```json
{
  "items": [
    {
      "id": "string",
      "content": "string",
      "payload": {},
      "score": null
    }
  ],
  "next_cursor": "string|null"
}
```

### `PATCH /api/v1/memory/{memory_id}`
- 鉴权：`Bearer` 用户令牌
- 说明：更新单条记忆内容（会重新向量化）
- 请求体：
```json
{
  "content": "新的记忆内容"
}
```

### `DELETE /api/v1/memory/{memory_id}`
- 鉴权：`Bearer` 用户令牌
- 说明：删除指定记忆

### `DELETE /api/v1/memory`
- 鉴权：`Bearer` 用户令牌
- 说明：清空当前用户全部记忆

## 管理员系统记忆（Admin System Memory）

### `GET /api/v1/admin/memory`
- 鉴权：超级管理员
- 说明：分页读取系统公共知识库（`kb_system`）

### `POST /api/v1/admin/memory`
- 鉴权：超级管理员
- 说明：新增系统知识条目

### `PATCH /api/v1/admin/memory/{memory_id}`
- 鉴权：超级管理员
- 说明：更新系统知识条目

### `DELETE /api/v1/admin/memory/{memory_id}`
- 鉴权：超级管理员
- 说明：删除系统知识条目

### `DELETE /api/v1/admin/memory`
- 鉴权：超级管理员
- 说明：清空系统知识库

## 兼容性说明
- 自 `2026-02-23` 起，管理员系统记忆路径固定为 `/api/v1/admin/memory`。
- `/api/v1/memory` 仅用于“当前登录用户”的个人记忆管理。
