# 用户知识库 API

> 路由前缀：`/api/v1/documents`

用于用户知识库的文件夹管理、文件上传、异步索引、检索、文件复制与分享链接生成。

## 鉴权

- 需要用户登录（Bearer Token）

---

## 1) 获取统计

**GET** `/documents/stats`

响应：

```json
{
  "used_bytes": 123456,
  "total_bytes": 524288000,
  "total_vectors": 320,
  "total_files": 12,
  "total_folders": 3
}
```

---

## 2) 获取目录树

**GET** `/documents/tree`

Query 参数：
- `parent_id`：父目录 ID（可选，默认根目录）
- `q`：名称模糊搜索（可选）
- `sort_field`：`name|size|status|chunks|created_at`（默认 `created_at`）
- `sort_direction`：`asc|desc`（默认 `desc`）

响应：

```json
{
  "folders": [
    {
      "id": "uuid",
      "name": "合同",
      "parent_id": null,
      "file_count": 4,
      "created_at": "2026-02-13T12:00:00Z",
      "updated_at": "2026-02-13T12:00:00Z"
    }
  ],
  "files": [
    {
      "id": "uuid",
      "name": "报价单.pdf",
      "type": "pdf",
      "size": 102400,
      "status": "active",
      "chunks": 32,
      "error_message": null,
      "folder_id": null,
      "created_at": "2026-02-13T12:00:00Z",
      "updated_at": "2026-02-13T12:00:00Z"
    }
  ],
  "breadcrumb": [
    {"id": null, "name": "root"}
  ]
}
```

状态映射：
- `pending/processing -> processing`
- `indexed -> active`
- `failed -> failed`

---

## 3) 文件夹管理

### 3.1 新建文件夹

**POST** `/documents/folders`

请求体：

```json
{
  "name": "财务",
  "parent_id": null
}
```

### 3.2 重命名文件夹

**PATCH** `/documents/folders/{folder_id}`

请求体：

```json
{
  "name": "财务归档"
}
```

### 3.3 删除文件夹

**DELETE** `/documents/folders/{folder_id}?recursive=true|false`

- `recursive=false` 且目录非空时返回 `409`

响应：

```json
{"message": "Folder deleted"}
```

---

## 4) 文件管理

### 4.1 上传文件

**POST** `/documents/files`（`multipart/form-data`）

字段：
- `file`：文件（必填）
- `folder_id`：目标目录 ID（可选）
- `meta_info`：JSON 字符串（可选）

支持后缀：`pdf, txt, docx, doc, md, csv, html, json`

单文件大小上限：`50MB`

### 4.2 查询文件详情

**GET** `/documents/files/{file_id}`

### 4.3 更新文件（重命名 / 移动目录）

**PATCH** `/documents/files/{file_id}`

请求体（至少一项）：

```json
{
  "name": "新的文件名.pdf",
  "folder_id": "uuid 或 null"
}
```

### 4.4 删除文件

**DELETE** `/documents/files/{file_id}`

- 返回 `204 No Content`

### 4.5 重试索引

**POST** `/documents/files/{file_id}/retry`

- 将状态重置为 `pending` 并重新投递索引任务

### 4.6 获取下载链接

**GET** `/documents/files/{file_id}/download-url`

响应：

```json
{
  "download_url": "https://..."
}
```

### 4.7 复制文件

**POST** `/documents/files/{file_id}/copy`

请求体（全部可选）：

```json
{
  "name": "合同-copy.pdf",
  "folder_id": "uuid 或 null"
}
```

规则：
- 不传 `name` 时默认生成 `原文件名-copy.ext`
- 不传 `folder_id` 时沿用源文件目录；传 `null` 表示复制到根目录
- 复制后会创建新的文档记录并重新投递索引任务

响应：`KnowledgeFileRead`

### 4.8 生成分享链接

**POST** `/documents/files/{file_id}/share`

请求体：

```json
{
  "expires_seconds": 3600
}
```

字段说明：
- `expires_seconds`：可选，链接有效期（秒）；不传则使用系统默认值

响应：

```json
{
  "share_url": "https://..."
}
```

### 4.9 批量操作

#### 4.9.1 批量删除文件

**POST** `/documents/files/batch/delete`

请求体：

```json
{
  "file_ids": ["uuid1", "uuid2"]
}
```

响应：

```json
{
  "deleted_count": 2,
  "failed": [
    {
      "file_id": "uuid3",
      "reason": "not_found",
      "message": "Document not found"
    }
  ]
}
```

#### 4.9.2 批量移动文件

**POST** `/documents/files/batch/move`

请求体：

```json
{
  "file_ids": ["uuid1", "uuid2"],
  "folder_id": "uuid 或 null"
}
```

说明：
- `folder_id=null` 表示移动到根目录

响应：

```json
{
  "files": [
    {
      "id": "uuid",
      "name": "a.txt",
      "type": "txt",
      "size": 123,
      "status": "active",
      "chunks": 1,
      "error_message": null,
      "folder_id": "uuid",
      "created_at": "2026-02-13T12:00:00Z",
      "updated_at": "2026-02-13T12:00:00Z"
    }
  ],
  "failed": [
    {
      "file_id": "uuid3",
      "reason": "not_found",
      "message": "Document not found"
    }
  ]
}
```

#### 4.9.3 批量复制文件

**POST** `/documents/files/batch/copy`

请求体：

```json
{
  "file_ids": ["uuid1", "uuid2"],
  "folder_id": "uuid 或 null（可选）"
}
```

规则：
- 不传 `folder_id`：每个复制文件沿用原目录
- `folder_id=null`：统一复制到根目录
- 复制后会创建新的文档记录并重新投递索引任务

响应：

```json
{
  "files": [
    {
      "id": "uuid",
      "name": "a-copy.txt",
      "type": "txt",
      "size": 123,
      "status": "processing",
      "chunks": null,
      "error_message": null,
      "folder_id": "uuid",
      "created_at": "2026-02-13T12:00:00Z",
      "updated_at": "2026-02-13T12:00:00Z"
    }
  ],
  "failed": [
    {
      "file_id": "uuid3",
      "reason": "not_found",
      "message": "Document not found"
    }
  ]
}
```

#### 4.9.4 批量重试索引

**POST** `/documents/files/batch/retry`

请求体：

```json
{
  "file_ids": ["uuid1", "uuid2"]
}
```

规则：
- 批量将文件状态重置为 `pending`，并重新投递索引任务
- `processing` 状态文件不会重试，会在 `failed` 中返回 `already_processing`

响应：

```json
{
  "files": [
    {
      "id": "uuid",
      "name": "a.txt",
      "type": "txt",
      "size": 123,
      "status": "processing",
      "chunks": null,
      "error_message": null,
      "folder_id": null,
      "created_at": "2026-02-13T12:00:00Z",
      "updated_at": "2026-02-13T12:00:00Z"
    }
  ],
  "failed": [
    {
      "file_id": "uuid2",
      "reason": "already_processing",
      "message": "Document is already processing"
    }
  ]
}
```

#### 4.9.5 批量生成分享链接

**POST** `/documents/files/batch/share`

请求体：

```json
{
  "file_ids": ["uuid1", "uuid2"],
  "expires_seconds": 3600
}
```

响应：

```json
{
  "items": [
    {
      "file_id": "uuid",
      "share_url": "https://..."
    }
  ],
  "failed": [
    {
      "file_id": "uuid3",
      "reason": "not_found",
      "message": "Document not found"
    }
  ]
}
```

说明：
- 批量接口采用“尽力执行”模式：可成功的先成功，不可成功的记录在 `failed`
- `failed.reason` 使用固定枚举值，映射如下：

| reason | 含义 | 常见场景 |
|---|---|---|
| `not_found` | 文件不存在或不属于当前用户 | 文件已删除、越权 file_id |
| `already_processing` | 文件正在索引中，不能重试 | 批量重试时命中 processing 文件 |
| `media_asset_not_found` | 文档关联的底层资源不存在 | 批量分享时资源缺失 |

---

## 5) Chunk 预览

**GET** `/documents/files/{file_id}/chunks?offset=0&limit=20`

响应：

```json
{
  "items": [
    {
      "id": "point-id",
      "file_id": "uuid",
      "index": 0,
      "content": "...",
      "token_count": 120
    }
  ],
  "total": 128,
  "offset": 0,
  "limit": 20
}
```

---

## 6) 向量检索

**POST** `/documents/search`

请求体：

```json
{
  "query": "查找付款条款",
  "limit": 5,
  "doc_ids": ["uuid"]
}
```

响应：

```json
[
  {
    "score": 0.92,
    "text": "...",
    "filename": "合同.pdf",
    "page": 0,
    "doc_id": "uuid"
  }
]
```
