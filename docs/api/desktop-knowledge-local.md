# Desktop Knowledge Local Schema (P1+)

更新时间：2026-03-03

## 范围
- 本文档描述桌面端 SQLite 的离线知识库基础能力：`knowledge_folder`、`user_document`、`knowledge_chunk`。
- 当前阶段已接入本地 tree/stats、文件夹 CRUD、文档 list/create/get/update/delete/retry、chunk 分页查询。

## knowledge_folder
字段：
- `id` (TEXT, PK)
- `user_id` (TEXT, NOT NULL)
- `parent_id` (TEXT, NULL)
- `name` (TEXT, NOT NULL)
- `created_at` (TEXT, NOT NULL)
- `updated_at` (TEXT, NOT NULL)

索引/约束：
- `uq_knowledge_folder_user_parent_name`：`(user_id, parent_id, name)` 唯一
- `uq_knowledge_folder_user_root_name`：`(user_id, name)` 且 `parent_id IS NULL` 唯一
- `ix_knowledge_folder_user_id`
- `ix_knowledge_folder_parent_id`

## user_document
字段：
- `id` (TEXT, PK)
- `user_id` (TEXT, NOT NULL)
- `media_asset_id` (TEXT, NOT NULL)
- `filename` (TEXT, NOT NULL)
- `folder_id` (TEXT, NULL)
- `status` (TEXT, NOT NULL, 默认 `pending`)
- `error_message` (TEXT, NULL)
- `chunk_count` (INTEGER, NOT NULL, 默认 `0`)
- `embedding_model` (TEXT, NULL)
- `meta_info` (TEXT, NOT NULL, 默认 `{}`)
- `created_at` (TEXT, NOT NULL)
- `updated_at` (TEXT, NOT NULL)

索引：
- `ix_user_document_user_id`
- `ix_user_document_status`
- `ix_user_document_media_asset_id`
- `ix_user_document_folder_id`

## knowledge_chunk
字段：
- `id` (TEXT, PK)
- `document_id` (TEXT, NOT NULL)
- `user_id` (TEXT, NOT NULL)
- `chunk_index` (INTEGER, NOT NULL)
- `text_content` (TEXT, NOT NULL)
- `token_count` (INTEGER, NOT NULL, 默认 `0`)
- `created_at` (TEXT, NOT NULL)
- `updated_at` (TEXT, NOT NULL)

索引/约束：
- `uq_knowledge_chunk_document_index`：`(document_id, chunk_index)` 唯一
- `ix_knowledge_chunk_document_id`
- `ix_knowledge_chunk_user_id`

## 兼容说明
- 字段命名与云端 `knowledge_folder` / `user_document` / `knowledge_chunk` 保持核心语义一致。
- `user_document.media_asset_id` 当前为本地字符串外键占位，后续再与桌面端 `media_asset` 体系打通。

## Tauri Commands
- `get_local_knowledge_tree`
- `get_local_knowledge_stats`
- `create_local_knowledge_folder`
- `update_local_knowledge_folder`
- `delete_local_knowledge_folder`
- `list_local_user_documents`
- `create_local_user_document`
- `get_local_user_document`
- `update_local_user_document`
- `delete_local_user_document`
- `retry_local_user_document`
- `list_local_user_document_chunks`

## 新增命令参数说明
### `update_local_user_document`
请求：
- `file_id: string`
- `payload.name?: string | null`
- `payload.folder_id?: string | null`
- `payload.folder_id_provided?: boolean`

语义：
- `folder_id_provided = false/undefined`：忽略 `folder_id`，保持原文件夹不变。
- `folder_id_provided = true && folder_id = null`：清空文件夹归属。
- `folder_id_provided = true && folder_id = "..."`：移动到目标文件夹（目标必须存在）。

### `list_local_user_document_chunks`
请求：
- `file_id: string`
- `query.offset?: number`（默认 `0`，最小 `0`）
- `query.limit?: number`（默认 `20`，范围 `1..100`）

响应：
- `items: LocalKnowledgeChunk[]`
- `total: number`
- `offset: number`
- `limit: number`

说明：
- 若 `knowledge_chunk` 还未落库，但 `user_document.chunk_count` 已有值，`total` 会回退取两者较大值，保证前端进度展示稳定。

## 前端 API（Tauri 分支）
- `fetchKnowledgeTree`
- `fetchKnowledgeStats`
- `createFolder`
- `updateFolder`
- `deleteFolder`
- `listLocalUserDocuments`
- `createLocalUserDocument`
- `getFile`
- `updateFile`
- `deleteFile`
- `retryFile`
- `fetchFileChunks`
