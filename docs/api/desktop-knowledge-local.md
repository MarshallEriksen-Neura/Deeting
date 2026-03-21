# Desktop Knowledge Local Schema (P1+)

更新时间：2026-03-21

## 范围
- 本文档描述桌面端 SQLite 的离线知识库基础能力：`knowledge_folder`、`user_document`、`knowledge_chunk`。
- 当前阶段已接入本地 tree/stats、文件夹 CRUD、文档 list/create/get/update/delete/retry、chunk 分页查询。
- 新增：桌面端本地可解析文档上传后会自动分块并写入 `knowledge_chunk`，并将文档状态更新为 `indexed`。

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

## 本地上传与分块（Tauri）
- `uploadFile` 在桌面端会走本地分支，不再调用云端 `/api/v1/documents/files` 上传接口。
- 支持本地离线解析的类型：`pdf`、`txt`、`docx`、`md`、`csv`、`html`、`json`。
- 以上类型会先在桌面端提取正文文本，再自动切块并写入 `knowledge_chunk`，随后将文档状态置为 `indexed`。
- 其中 `docx` 会在本地先解压并提取 `word/document.xml` 正文文本；`pdf` 会使用本地 `pdfjs` 提取页面文本，再复用现有分块/索引流程。
- 非支持类型（如 `xlsx`）当前会在本地创建 `failed` 文档记录，并返回错误提示（便于用户在列表中看到失败状态）。
- 桌面端不再按源文件字节数强制限制本地解析；切块成功后会清理临时 `meta_info.raw_text`，避免长期保留整篇正文副本。

## 本地召回（聊天注入）
- `send_local_conversation_message` / `regenerate_local_conversation_reply` 会根据最后一条用户消息执行本地混合召回（仅 `indexed` 文档）：
  - SQLite `knowledge_chunk` 词法检索
  - LanceDB 向量检索（基于 chunk embedding）
- 两路结果会做去重和重排后注入系统上下文（最多 4 条），供模型回答时参考。
- 两个命令的 `payload` 现在统一携带 `session_id`，并支持可选 `request_id`（用于流式事件关联）；`send_local_conversation_message` 额外支持可选 `assistant_id`。
- 本地向量索引采用异步维护：
  - 新建/重试文档后后台增量索引
  - 删除文档时清理对应向量条目
  - 桌面端启动时会自动重建一次 `indexed` 文档向量索引

## 本地会话流式事件（Tauri Event）
- 事件名：`local-chat-stream`
- 发送方：`send_local_conversation_message` / `regenerate_local_conversation_reply`
- 事件公共字段：
  - `request_id?: string`（仅当请求携带时回传，用于前端过滤并发请求）
  - `trace_id: string`
  - `type: "status" | "delta" | "blocks" | "error" | "done"`

### `status`
- 字段：`stage`、`code`、`meta?`
- 用途：驱动前端“正在准备上下文/请求模型/生成中”等中间态。

### `delta`
- 字段：`delta: string`
- 用途：本地回答文本分片实时推送（前端可逐字拼接）。

### `blocks`
- 字段：`blocks: MessageBlock[]`
- 用途：补充结构化 block 渲染（如文本块）。

### `error`
- 字段：`code`、`message`
- 用途：本地链路失败时的即时反馈。

### `done`
- 字段：无额外字段
- 用途：标记一次本地会话流式发射结束。
