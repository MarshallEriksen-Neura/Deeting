# 知识库(Knowledge Base)架构抽离重构计划

## 1. 背景与目标
当前项目中，用户个人知识库（文件夹、文档上传、分块切片、向量化存储）的业务逻辑被强行糅合在 `McpStore` 和 `MemoryState` 中。这不仅造成了 MCP 模块代码过度臃肿，还导致了“动态对话记忆(Conversation Memory)”与“静态知识库(Knowledge/RAG)”在概念和底层向量表上的耦合。

鉴于**当前线上环境还没有用户真正上传过知识库文件**（无历史数据包袱），这正是进行架构拆分的最佳时机。

**目标：** 将知识库从 MCP 和 Memory 中完全物理隔离，建立独立的 `knowledge` 业务模块、独立的 SQLite Store 以及独立的 LanceDB 向量表。

## 2. 详细重构步骤

### 2.1 后端目录结构与代码转移
在 `deeting/src-tauri/src/modules/` 目录下创建新的 `knowledge` 模块。

1. **类型迁移 (`types.rs`)**: 
   - 从 `mcp/types.rs` 中提取出 `LocalKnowledgeFolder`, `LocalUserDocument`, `LocalKnowledgeChunk` 及其相关请求/响应类型，移动到 `knowledge/types.rs`。
2. **错误处理 (`error.rs`)**: 
   - 创建 `knowledge/error.rs` 定义 `KnowledgeError` 替代原来在此处使用的 `McpError`。
3. **数据存储 (`store.rs`)**:
   - 将 `mcp/store/knowledge.rs`（目前约1200+行）的内容整体迁移到 `knowledge/store.rs`。
   - 移除这些方法对 `McpStore` 的依赖，改为依附于新建立的 `KnowledgeStore` 结构体。
   - 在 `KnowledgeStore::init` 中写入建表 DDL：`knowledge_folder`, `user_document`, `knowledge_chunk`。
   - 从 `mcp/store/mod.rs` (`McpStore::init`) 中**彻底删除**这三张表的创建语句。
4. **前端 IPC 接口 (`commands.rs`)**:
   - 将 `mcp/commands_parts/knowledge_folders.rs` 和 `mcp/commands_parts/knowledge_documents.rs` 合并并迁移到 `knowledge/commands.rs`。
   - 修正 Tauri 命令函数签名，由读取 `state.mcp.store` 改为读取 `state.knowledge.store`。
5. **向量库分离 (LanceDB)**:
   - 在文件切片(chunk)存入向量数据库时，确保创建一个全新的表名，例如 `user_knowledge_chunks`，坚决不与现有的对话记忆 (`user_memory`) 共用一个 Table，实现物理级别的相似度搜索隔离。

### 2.2 状态管理与初始化整合 (`setup.rs` & `state.rs`)
1. 在 `src/state.rs` 中的 `AppState` 结构体增加 `pub knowledge: KnowledgeState` 字段。
2. 在 `src/setup.rs` 中，复用之前创建的**全局共享 `SqlitePool`**：
   ```rust
   let knowledge_state = KnowledgeState::with_pool(global_pool.clone()).await?;
   // 并将其注册到 AppState 中
   ```
3. 在 `src/commands.rs` 和 `src/setup.rs` 的 `invoke_handler` 中，更新所有涉及知识库的 `#[tauri::command]` 路由映射，指向新的 `knowledge::commands::*` 路径。

### 2.3 前端结构调整
前端接口名称（如 `invoke('list_local_knowledge_folders')`）可以保持不变，以降低重构成本。但推荐进行以下结构整理：
1. **状态剥离**: 如果目前的 UI 状态管理中，知识库的数据存在 `chat-store.ts` 中，应该新建一个 `knowledge-store.ts` 专门维护知识库树状图和上传状态。
2. **逻辑剥离**: 将关联的 Hooks（如果有）从对话服务中解耦。

## 3. 验收标准
- [ ] 编译通过：重构后 `cargo build` 无报错，无废弃/未解析引用。
- [ ] 知识库上传：通过前端 UI 上传文档，在 SQLite 中能正确看到落入了 `user_document` 和 `knowledge_chunk` 表。
- [ ] 独立向量表：在 `.lancedb` 数据目录下能观察到生成了专属的知识库 Table（不与 memory 混用）。
- [ ] MCP 纯净：`mcp` 模块中不再包含任何关于 Folder 和 Document 逻辑的方法或建表语句。

## 4. 风险与回滚方案
- **风险**：由于大面积移动文件，可能会引起短暂的编译报错（未导入结构体）。
- **回滚**：利用 Git 版本控制特性，创建一个专门的重构分支 `feat/knowledge-base-separation`，如遇不可预期错误，直接切回主分支即可。