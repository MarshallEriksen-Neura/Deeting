# Desktop 本地记忆 API（LanceDB）

更新时间：2026-03-02

## 范围说明
- 本文档描述桌面端（Tauri）新增的本地记忆命令。
- 存储介质：LanceDB（本地目录）。
- 当前版本仅支持存储结构 CRUD，不包含 embedding 生成与向量检索。

## 环境变量
- `DESKTOP_LANCEDB_PATH`（可选）
  - 含义：本地 LanceDB 数据目录。
  - 默认值：`<app_data_dir>/memory_lancedb`。
  - 示例（Windows）：`C:\Users\<you>\AppData\Roaming\deeting\memory_lancedb`

## 数据结构
### LocalMemoryItem
```json
{
  "id": "uuid",
  "content": "string",
  "session_id": "string | null",
  "assistant_id": "string | null",
  "meta_info": {},
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

### LocalMemoryListResponse
```json
{
  "items": [],
  "next_cursor": "created_at|id",
  "has_more": false
}
```

## Tauri Commands
### 1) `append_local_memory`
- 入参：
```json
{
  "content": "string, required",
  "session_id": "string | null",
  "assistant_id": "string | null",
  "meta_info": {}
}
```
- 返回：`LocalMemoryItem`
- 错误：
  - `validation error: content is required`
  - `storage error: ...`

### 2) `list_local_memories`
- 入参：
```json
{
  "query": {
    "cursor": "string | null",
    "limit": 30,
    "session_id": "string | null",
    "assistant_id": "string | null"
  }
}
```
- 返回：`LocalMemoryListResponse`
- 说明：
  - 仅返回未删除数据；
  - `limit` 范围：`1..=200`，默认 `30`。

### 3) `delete_local_memory`
- 入参：
```json
{
  "id": "string, required"
}
```
- 返回：
```json
{
  "id": "string",
  "deleted": true
}
```
- 说明：软删除（`is_deleted=true`）。

### 4) `clear_local_memories`
- 入参：
```json
{
  "payload": {
    "session_id": "string | null",
    "assistant_id": "string | null"
  }
}
```
- 返回：
```json
{
  "cleared": 0
}
```
- 说明：批量软删除，`payload` 为空时清理全部未删除记录。
