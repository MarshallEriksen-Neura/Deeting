# Desktop Knowledge Local Schema (P1)

更新时间：2026-03-03

## 范围
- 本文档描述桌面端 SQLite 新增的知识库基础表：`knowledge_folder`、`user_document`。
- 当前阶段为 P1+：已接入本地 tree/stats、文件夹 CRUD、文档 list/create 的 Tauri 命令。

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

## 兼容说明
- 字段命名与云端 `knowledge_folder` / `user_document` 保持核心语义一致。
- `user_document.media_asset_id` 当前为本地字符串外键占位，后续再和桌面端 `media_asset` 体系打通。

## Tauri Commands
- `get_local_knowledge_tree`
- `get_local_knowledge_stats`
- `create_local_knowledge_folder`
- `update_local_knowledge_folder`
- `delete_local_knowledge_folder`
- `list_local_user_documents`
- `create_local_user_document`

## 前端 API（Tauri 分支）
- `fetchKnowledgeTree`
- `fetchKnowledgeStats`
- `createFolder`
- `updateFolder`
- `deleteFolder`
- `listLocalUserDocuments`
- `createLocalUserDocument`
