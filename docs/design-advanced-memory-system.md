# 进阶记忆治理系统设计 (Advanced Memory OS)

## 1. 背景与动机 (Background & Motivation)

在当前 Deeting 的架构中，我们已经通过 `QdrantUserVectorService` 实现了基于 Qdrant 的用户私有向量存储。然而，目前的记忆层仅仅停留在“基础设施层 (Infrastructure Layer)”，即作为一个被动的、无状态的数据库供大模型 (Agent) 进行 `upsert` 和 `search`。

随着 Agent 长期运行，单纯的 Vector DB 暴露出以下问题：
1. **记忆污染与冗余**：大模型往往会进行“覆盖式”或“无脑重复”的写入，导致向量库中充满互相矛盾或高度重复的记忆碎片。
2. **检索精度衰减**：随着记忆量增大，早期的无用背景信息（噪音）会干扰当前关键信息的检索（基于纯语义相似度无法区分时间权重和重要性）。
3. **缺乏干预手段**：如果 Agent 产生幻觉并写入了错误的设定，用户很难像代码版本控制一样去审查和回滚。

本设计旨在为 Deeting 引入一层**“记忆治理系统 (Memory Governance Layer)”**，在**不引入额外大模型调用开销**和**不引入新数据库组件 (如 SQLite FTS)** 的前提下，通过纯数据结构和向量空间算法，将现有的向量存储升级为具备生命周期管理的“记忆操作系统”。

---

## 2. 核心系统特性 (Core Features)

### 2.1 基于向量距离的写入守卫 (Vector-Distance Write Guard)
拒绝昂贵的 LLM 裁判器方案，采用**向量相似度阈值**进行自动化合并决策。当 Agent 请求记录新信息时，系统拦截并执行智能合并。
- **机制**：在写入前，系统先将新信息进行 Embedding，并在 Qdrant 中搜索 Top-1 最相似的现有记忆。
- **裁决算法** (假设使用 Cosine 相似度，阈值可配置)：
  - **`Score < 0.85` (全新知识)**：直接新增 (`ADD`)。
  - **`0.85 <= Score < 0.95` (知识演进)**：这通常是已有知识的延伸或修正。执行更新 (`UPDATE`)，可以将新文本与老文本在数据结构层拼接，或者更新时间戳。
  - **`Score >= 0.95` (高度重复)**：这已经是已知信息，直接忽略 (`NOOP`)，避免库内出现大量冗余的垃圾向量。

### 2.2 记忆生命周期与活力值 (Vitality Decay)
打破“所有记忆永久平等”的假象，引入拟人化的遗忘机制。
- **活力值 (Vitality Score)**：每条记忆创建时拥有基础活力值。每次在 `search` 中被召回且排在 Top-K 时，其 `payload.vitality` 增加。
- **自然衰减 (Decay)**：每次写入或全局定时任务，会对旧记忆的活力值进行数学衰减。
- **冷热分离**：搜索时，最终的相关性排序不单看向量 `Score`，而是采用加权公式：`Final_Rank = Vector_Score * f(Vitality, Time_Decay)`。这在纯 Qdrant 层即可通过 Payload 结合完成。

### 2.3 基于 Payload 的元数据过滤 (Payload-Driven Routing)
坚决不引入 FTS（全文搜索引擎）等新技术债，最大化榨干 Qdrant 的潜力。
- **机制**：利用 Qdrant 强大的 Payload Index（如 Keyword match, Range filter）。
- **结构化存储**：Agent 在写入记忆时，提取的关键名词（如项目名、技术栈）不光放在文本里，也存入 Qdrant 的 Payload 标签中。
- **意图降维**：搜索时，如果判断是“时间型”或“精准事实型”，不走全文检索，而是直接向 Qdrant 下发严格的 `Payload Filter`（例如匹配特定 tag，或根据时间戳区间截断），实现精准降噪。

### 2.4 快照与审计 (Snapshot & Audit)
利用现有的关系型数据库记录变更，增强系统的可解释性。
- Qdrant 负责高速向量检索，关系型数据库 (PostgreSQL) 负责记录向量 ID 的 Snapshot。
- 每次触发 `UPDATE`，在 DB 中插入一条变更记录 (包含 Old Content 和 New Content)。
- 前端 UI 提供类似 Git Diff 的“记忆变迁视图”，允许用户审查 AI 记录了什么，并在发生幻觉时一键回滚 (即把老文本重新 Upsert 回 Qdrant)。

---

## 3. 架构定位与改造点 (Architecture & Integration)

当前我们的存储层已经非常贴合多租户架构，改造将作为一个**上层业务封装**进行，完全复用现有的 `QdrantUserVectorService`。

### 3.1 抽象 Memory Service 业务层
在 `backend/app/services/memory/` 目录下建立高阶控制器 `AdvancedMemoryService`，对下调用 `QdrantUserVectorService`。

```python
# 概念代码示例
class AdvancedMemoryService:
    def __init__(self, vector_store: QdrantUserVectorService, db_session):
        self.vector_store = vector_store
        self.db_session = db_session
        
    async def add_memory(self, content: str, payload: dict):
        # 1. 预先检索 Top-1
        results = await self.vector_store.search(content, limit=1)
        
        # 2. 纯数据结构距离计算 (Vector-Distance Write Guard)
        if not results or results[0]['score'] < 0.85:
            await self.vector_store.upsert(content, payload) # ADD
        elif results[0]['score'] >= 0.95:
            pass # NOOP: 重复记忆，丢弃
        else:
            # UPDATE: 合并或替换，并记录 Snapshot 到 DB
            old_id = results[0]['id']
            await self.merge_and_upsert(old_id, content) 
```

### 3.2 数据模型扩展
无需新起大表，仅需在 Qdrant Payload 和现有的 Memory DB 表中增加极少的字段：
- 增加字段：`vitality` (Float，存入 Qdrant Payload 用于加权)
- 增加字段：`last_accessed_at` (Timestamp)
- 增加关联结构：`MemorySnapshot` (PostgreSQL，用于版本回滚)

---

## 4. 桌面端架构分析 (Desktop Architecture Analysis)

> 桌面端是用户的**主战场**，使用频率远高于后端 API 直连场景。以下为桌面端现状与适配分析。

### 4.1 桌面端技术栈差异

| 维度 | 后端 (原设计假设) | 桌面端 (主战场) |
|------|-------------------|-----------------|
| 向量存储 | Qdrant (远程服务) | **LanceDB (本地嵌入式)** |
| 关系型 DB | PostgreSQL | **SQLite** |
| 运行时 | Python / Celery 异步 | **Rust / Tokio 异步** |
| 数据驻留 | 服务端 | **纯本地，无同步** |
| 去重机制 | 有 (0.92 阈值) | **完全没有** |
| 生命周期管理 | 无 | **无** |
| 审计能力 | 无 | **无** |
| Embedding | 服务端内部调用 | 通过 Provider API 远程调用 |

### 4.2 桌面端现有架构

**存储层：**
- `MemoryStore` (`deeting/src-tauri/src/modules/memory/store.rs`)：基于 LanceDB，管理两张表：
  - `local_memories`：对话/会话记忆，存储 content, session_id, assistant_id, metadata, timestamps
  - `local_assets`：语义搜索索引，存储工具/助手/知识文件的 embedding 向量
- `EmbeddingService` (`deeting/src-tauri/src/modules/providers/embedding.rs`)：通过配置的 Provider 生成 embedding 向量

**Tauri 命令层：**
- `append_local_memory`：追加记忆（纯文本，**无 embedding**）
- `list_local_memories`：分页列出记忆
- `delete_local_memory`：软删除
- `clear_local_memories`：按 session/assistant 批量清除

**知识系统（独立于记忆）：**
- SQLite 存储 `user_document`, `knowledge_folder`, `knowledge_chunk`
- 文档上传后分块存储，支持关键词搜索
- 与 `local_memories` 共存但职责分离

### 4.3 关键架构缺口

#### 缺口 1：`local_memories` 表没有 embedding 向量字段

这是**最大的 blocker**。当前 schema：
```
content: String
session_id: String
assistant_id: String
metadata: Option<String>  // JSON string
created_at: i64
is_deleted: bool
```

缺少 `embedding: FixedSizeList<f32>` 向量字段，导致：
- 无法做语义搜索（当前只能按 session_id/assistant_id 过滤列出）
- Write Guard 的前提（Top-1 语义检索）完全不成立
- Vitality rerank 无从实施

对比 `local_assets` 表已经具备 embedding 字段并支持向量搜索。

#### 缺口 2：写入路径无任何智能逻辑

`MemoryStore.append()` 是纯追加写入，每次调用直接 insert，不检查相似内容。长期使用下 `local_memories` 表会无限膨胀。

#### 缺口 3：离线 Embedding 能力缺失

当前 embedding 依赖远程 Provider API（如 OpenAI text-embedding-3）。离线场景下记忆系统完全瘫痪。桌面端需要考虑本地 embedding fallback 方案。

#### 缺口 4：记忆与知识系统边界模糊

`local_memories`（LanceDB）和 `knowledge_chunk`（SQLite）职责划分不清。用户上传文档属于”知识”还是”记忆”？长期对话中提取的事实应该进入哪个系统？缺乏统一的检索层。

#### 缺口 5：Bandit 优选仅覆盖 LLM 模型路由

当前 Bandit（epsilon-greedy 多臂老虎机）仅有一个 scene：`BANDIT_DEFAULT_SCENE = “router:llm”`，只用于 `runtime_and_routing.rs` 中的 LLM 模型选择（成功率/延迟/成本 → 自动优选最佳模型，失败模型 cooldown）。

尚未覆盖的优选维度：
- **Skills 优选**：同一意图可能有多个 skill 可处理，缺乏基于历史效果的自动选择
- **Prompt 模板优选**：不同 prompt 模板的效果差异无法量化和自动择优
- **Assistant 路由**：多个助手场景下，缺乏基于用户反馈的智能路由

`bandit_arm_state` 表的 `(scene, arm_id)` 唯一键设计已支持多 scene 扩展，无需改表结构，仅需在对应调用点新增 scene 和反馈回路。

### 4.4 核心特性在桌面端的适配方案

#### Write Guard 适配

LanceDB API 与 Qdrant 不同，需要翻译：
```rust
// 概念代码 (Rust/LanceDB)
impl MemoryStore {
    async fn smart_append(&self, content: &str, embedding: Vec<f32>) -> WriteAction {
        let table = self.db.open_table(“local_memories”).await?;

        // Top-1 语义搜索
        let results = table
            .vector_search(embedding.clone())
            .limit(1)
            .execute()
            .await?;

        match results.first() {
            None => self.do_add(content, embedding).await,  // 库为空
            Some(top1) => {
                let score = top1.score;  // cosine similarity
                if score < 0.85 {
                    self.do_add(content, embedding).await       // ADD
                } else if score >= 0.95 {
                    WriteAction::Noop                            // NOOP
                } else {
                    self.do_update(top1.id, content, embedding).await  // UPDATE
                }
            }
        }
    }
}
```

#### Vitality Decay 适配

LanceDB 是嵌入式数据库，无网络开销，**采用惰性衰减**（读时计算，不做定时全量扫描）：
```rust
fn compute_final_score(vector_score: f32, vitality: f32, last_accessed_at: i64) -> f32 {
    let now = current_timestamp();
    let days_since_access = (now - last_accessed_at) as f32 / 86400.0;
    let decay_factor = (-0.05 * days_since_access).exp(); // 指数衰减，半衰期 ~14 天
    vector_score * (0.7 + 0.3 * vitality * decay_factor)  // 向量分数占主导
}
```

搜索策略：over-fetch Top-20 → 应用层 rerank → 返回 Top-3。本地进程内操作，延迟可忽略。

#### Payload 过滤适配

LanceDB 支持 SQL-like 过滤，直接可用：
```rust
table.vector_search(query_embedding)
    .filter(“assistant_id = 'xxx' AND category = 'fact' AND created_at > 1700000000”)
    .limit(20)
    .execute()
    .await?
```

#### 快照审计适配

复用桌面端已有的 SQLite，新建 `memory_snapshots` 表：
```sql
CREATE TABLE memory_snapshots (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL,       -- 'ADD' | 'UPDATE' | 'DELETE'
    old_content TEXT,
    new_content TEXT,
    old_metadata TEXT,          -- JSON
    new_metadata TEXT,          -- JSON
    created_at INTEGER NOT NULL
);
```

### 4.5 桌面端三套存储系统的隔离问题

> 深入调查后发现，桌面端的"记忆"并非单一系统，而是**三套完全隔离的存储系统**，彼此之间没有任何数据流通。

#### 存储系统全景

```
┌─────────────────────────────────────────────────────────┐
│                    桌面端存储全景                          │
├───────────────┬──────────────────┬───────────────────────┤
│  MemoryState  │ McpRuntimeState  │   McpRuntimeState     │
│  (LanceDB)    │ (SQLite)         │   (SQLite)            │
├───────────────┼──────────────────┼───────────────────────┤
│local_memories │conversation_msg  │ user_document         │
│local_assets   │conversation_     │ knowledge_folder      │
│               │  summary         │ knowledge_chunk       │
│               │summary_job       │                       │
├───────────────┼──────────────────┼───────────────────────┤
│记忆片段存储     │对话历史与摘要      │ 知识库（文档上传）      │
│(无向量搜索能力) │(用于上下文注入)    │ (纯关键词 LIKE 搜索)   │
└───────────────┴──────────────────┴───────────────────────┘
         ↕ 无             ↕ 无              ↕ 无
   三套系统之间完全没有数据流通
```

#### 隔离导致的四个具体问题

**问题 1：缺少自动记忆提取功能（后端已有，桌面端空白）**

后端拥有完整的自动记忆提取链路：`MemoryExtractorService` 用 LLM 从对话中提取有价值的事实 → 向量去重(0.92阈值) → 写入 Qdrant，并通过 `MemoryScheduler` 在会话空闲 3 分钟后自动触发。桌面端**完全缺失这一能力**——`local_memories` 只有手动 `append_local_memory`，没有从对话中自动提取并持久化事实的机制。

注意：对话摘要（`conversation_summary`）是上下文压缩手段，仅在聊天链路中注入使用，不应写入记忆系统。真正需要的是独立的**事实提取管道**。

```
后端路径：对话消息 → LLM 事实提取 → 向量去重 → Qdrant 持久化 → 长期可检索
桌面现状：对话消息 → 无提取 → local_memories 只有手动写入
桌面期望：对话消息 → LLM 事实提取 → Write Guard 去重 → LanceDB 持久化 → 长期可检索
```

**问题 2：知识库搜索是纯关键词匹配**

`search_local_knowledge_chunks()` 的实现是 SQLite `LIKE '%keyword%'` 搜索，完全没有语义理解能力：
- 搜索"用户偏好设定"无法匹配到内容为"他喜欢深色主题"的知识块
- 与 LanceDB 中已有的向量搜索能力（`local_assets` 已在使用）形成明显落差

**问题 3：语义记忆注入名不副实**

`SemanticMemoryInjectionStep` 名为"语义"，实际只是 `store.list(limit=5)`——按时间倒序取最近 5 条记忆，没有任何语义匹配：
```rust
// 当前实现（local_orchestrator.rs）
let query = LocalMemoryListQuery {
    limit: Some(5),
    session_id: Some(ctx.session_id.clone()),
    assistant_id: ctx.assistant_id.clone(),
    ..Default::default()
};
let memories = ctx.app_state.memory.store.list(query).await?;
```
用户问"我之前说过的编程偏好是什么"，系统只能返回最近 5 条记忆，而非语义相关的记忆。

**问题 4：Asset 索引有向量能力，记忆却没有**

`local_assets` 表已具备完整的向量搜索链路（`upsert_asset` → embedding → `search_assets` → vector search），而 `local_memories` 作为核心记忆系统反而缺少这一能力。同一个 `MemoryStore` 中两张表的能力差距极大。

#### 统一记忆层的方向

Advanced Memory OS 的实施不仅需要增强 `local_memories` 本身，还需要打通三套系统的数据壁垒：

| 整合目标 | 数据流方向 | 实施阶段 |
|---------|----------|---------|
| 自动事实提取（对标后端） | 对话消息 → LLM 提取 → Write Guard → LanceDB memories | Phase 0 |
| 语义记忆检索替代时序列出 | `SemanticMemoryInjectionStep` 改用向量搜索 | Phase 0 |
| 知识库向量化搜索 | SQLite chunks → embedding → LanceDB 或原表增加向量列 | Phase 3 (可选) |
| 统一检索层 | 记忆 + 知识 + 摘要联合语义查询 | Phase 3 |

### 4.6 桌面端扩展 Schema

升级后的 `local_memories` 目标 schema：
```
id: String (UUID)
content: String
embedding: FixedSizeList<f32>    -- [新增] 向量字段
session_id: String
assistant_id: String
metadata: Option<String>         -- JSON
tags: Vec<String>                -- [新增] 语义标签
category: String                 -- [新增] fact | preference | event | relation
source: String                   -- [新增] conversation | manual | plugin
vitality: f32                    -- [新增] 活力值，初始 1.0
embedding_model: String          -- [新增] 模型版本追踪
created_at: i64
last_accessed_at: i64            -- [新增]
is_deleted: bool
```

---

## 5. 后端架构适配补充 (Backend Architecture Addendum)

> 原设计 (第 2-3 章) 的核心理念正确，以下为与现有代码对齐后的补充事项。

### 5.1 与现有 LLM 决策层的关系

当前后端在 `persist_external_memory()` 和 `MemoryExtractorService` 中使用 LLM 判断是否值得记忆（`MEMORY_PERSIST_DECISION_SYSTEM_PROMPT`）。Write Guard 的向量距离裁决**不应替代**这一机制，而应作为**叠加层**：

```
LLM 决策 (是否值得记忆) → Write Guard (ADD/UPDATE/NOOP) → Upsert
```

LLM 负责语义质量判断，Write Guard 负责去重与合并，两者互补。

### 5.2 Plugin 隔离边界

当前记忆按 `plugin_id` 隔离（`QdrantUserVectorService` 构造函数注入）。Write Guard 的 Top-1 检索**必须在同一 plugin scope 内进行**，避免跨 plugin 误合并。

### 5.3 Embedding 模型版本兼容

当前 payload 中有 `embedding_model` 字段，且 `enforce_embedding_model_scope=True` 时搜索会过滤模型版本。切换模型后旧记忆无法被检索，Write Guard 也需要在同一模型版本内裁决。跨模型迁移需要单独的批量 re-embed 任务。

### 5.4 异步写入链保持

当前 `MemoryWriteStep` 是 fire-and-forget 异步步骤。Write Guard 的拦截逻辑应在异步链内完成（Celery task 中），不得阻塞主请求路径。

### 5.5 Vitality 衰减策略修正

原设计提出”全局定时任务衰减”，在 Qdrant 上需要 scroll 全量点后逐个 update payload，成本过高。**改为惰性衰减**：
- 不做定期写入，搜索时根据 `last_accessed_at` 实时计算衰减值
- 被召回时异步更新 `vitality` 和 `last_accessed_at`（fire-and-forget）

---

## 6. 实施计划 (Implementation Plan)

### 6.1 桌面端路线图 (主战场，优先实施)

**Phase 0: 向量基础补全 + 数据流打通** ← 必须最先完成
- `local_memories` 表增加 `embedding` 向量字段（FixedSizeList<f32>）
- `append_local_memory` 命令改造：写入时自动调用 `EmbeddingService` 生成向量
- 新增 `search_local_memories` Tauri 命令（基于向量搜索 + 过滤）
- 存量数据批量 embedding 回填任务（后台 async task，启动时检测并执行）
- `SemanticMemoryInjectionStep` 改造：从 `store.list(limit=5)` 替换为基于当前用户消息的向量搜索（参见 4.5 问题 3）
- 自动事实提取管道：对标后端 `MemoryExtractorService`，在会话空闲后用 LLM 从对话中提取有价值事实，经 Write Guard 去重后写入 `local_memories`（参见 4.5 问题 1）

**Phase 1: 写入守卫 + 元数据扩展**
- `append` 前执行 Top-1 语义搜索，实现三段式裁决 (ADD / UPDATE / NOOP)
- 扩展字段：`tags`, `category`, `source`, `embedding_model`
- SQLite 新建 `memory_snapshots` 表，记录 UPDATE 操作的 Diff
- 前端 TypeScript API 层同步更新（`lib/api/local-memory.ts`）

**Phase 2: 活力值 + 智能检索**
- 增加 `vitality`, `last_accessed_at` 字段
- 搜索改造：over-fetch Top-20 → Rust 应用层 rerank（score * vitality * decay）→ 返回 Top-K
- 被召回时异步回写 vitality 增量
- 前端记忆管理 UI（查看/搜索/删除/按分类过滤）

**Phase 3: 高阶能力**
- 本地 embedding 模型支持（ONNX Runtime 集成，如 all-MiniLM-L6-v2，离线可用）
- 记忆审计 UI（Diff 视图 + 一键回滚，读取 SQLite memory_snapshots）
- 桌面端 ↔ 后端记忆同步（可选，基于 user_id 关联）
- 知识库向量化搜索：`knowledge_chunk` 增加 embedding 或迁移至 LanceDB，替代纯 LIKE 搜索（参见 4.5 问题 2）
- 统一检索层：记忆 + 知识 + 摘要联合语义查询，提供单一搜索入口（参见 4.5 统一记忆层方向）
- Bandit 多 scene 扩展：在现有 `"router:llm"` 基础上，新增 `"router:skill"`（Skills 优选）、`"router:prompt"`（Prompt 模板优选）、`"router:assistant"`（Assistant 路由）scene，复用 `bandit_arm_state` 表和 epsilon-greedy 框架，在各调用点接入反馈回路（参见 4.3 缺口 5）

### 6.2 后端路线图

**Phase 1: 写入守卫**
- 在 `persist_external_memory()` 和 `MemoryExtractorService._save_fact()` 入口增加 Write Guard
- 保留现有 LLM 决策层，Write Guard 作为叠加层
- 阈值需基于实际 embedding 模型校准（建议先用生产数据做阈值分析）
- Payload 扩展 `tags`, `category` 字段

**Phase 2: 活力值 + 检索优化**
- Qdrant Payload 增加 `vitality`, `last_accessed_at`
- `QdrantUserVectorService.search()` 改造：over-fetch + 应用层 rerank
- 被召回时异步更新 vitality（fire-and-forget，不阻塞检索）

**Phase 3: 审计与回滚**
- PostgreSQL 新建 `MemorySnapshot` 表 + Alembic 迁移
- UPDATE 操作写入变更记录（old_content, new_content, action, timestamp）
- 回滚 API（`POST /api/v1/memory/{id}/rollback`）

### 6.3 阈值校准建议

Write Guard 的阈值（0.85 / 0.95）需要基于实际 embedding 模型校准，不同模型的距离分布差异很大：

| 模型 | 建议 ADD 阈值 | 建议 NOOP 阈值 | 备注 |
|------|---------------|----------------|------|
| text-embedding-3-small | 0.82 | 0.93 | OpenAI，分布较分散 |
| text-embedding-3-large | 0.85 | 0.95 | OpenAI，分布较集中 |
| all-MiniLM-L6-v2 | 0.80 | 0.92 | 本地模型，维度较低 |

建议上线前用生产数据样本做分布分析，绘制相似度直方图后确定最终阈值。
