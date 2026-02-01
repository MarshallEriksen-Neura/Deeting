# 技能注册表（Admin）

- 前置条件：需要 `assistant.manage` 权限（Bearer Token），路由前缀 `/api/v1`。

## 1. 创建技能
`POST /admin/skills`

**Request Body**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "status": "draft"
}
```

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "status": "draft",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```

## 2. 技能列表
`GET /admin/skills?skip=0&limit=50`

**Response**
```json
[
  {
    "id": "docx_editor",
    "name": "Docx Editor",
    "status": "draft",
    "created_at": "2026-02-01T00:00:00Z",
    "updated_at": "2026-02-01T00:00:00Z"
  }
]
```

## 3. 技能详情
`GET /admin/skills/{skill_id}`

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "status": "draft",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```

## 4. 更新技能
`PATCH /admin/skills/{skill_id}`

**Request Body**
```json
{
  "status": "active"
}
```

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "status": "active",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```
