# Desktop Local Knowledge Engine Design

**Lane:** `desktop local / knowledge / retrieval / ops`

## Goal

在当前桌面端本地知识库能力的基础上，定义一个可长期演进的目标架构。

这个架构的目标不是把桌面端做成一个重型本地 RAG 平台，而是把现有“能上传、能切 chunk、能用于本地 chat”的能力，收敛成一个：

- 本地优先
- 结构化 ingestion
- 轻量混合检索
- 可恢复
- 可调试
- 可解释
- 可重建

的桌面端本地知识引擎。

建议的内部名称：

- `Desktop Local Knowledge Engine`
- 或 `Desktop RAG Core`

## Short Answer

这条路线不需要推翻。

正确方向不是“单独再做一个桌面版 RAGFlow”，而是沿着现有桌面本地知识链路继续演进，但必须把下面四件事先补成正式 contract：

1. source of truth ownership
2. ingestion lifecycle contract
3. chunk and retrieval metadata contract
4. retry / rebuild / diagnostics contract

如果这四件事不先收敛，后续 OCR、结构化切分、FTS/BM25、explain、评测都会越做越散。

但当前这份设计里的 Phase 1 节奏必须是硬切基础设施，而不是继续保留兼容入口。

## Why now

当前桌面端知识能力已经不再只是一个上传页面的附属功能，它已经直接影响：

- 本地知识文件上传体验
- selected knowledge 注入效果
- 本地 chat 的回答质量
- 后续 OCR、多语言、结构化切分和 LLM Wiki 之类能力的复用空间

如果继续维持“前端提文本，Tauri 直接切 chunk，状态只分 processing/indexed/failed，错误靠字符串，重建靠局部补丁”的状态，后续每加一种格式和检索策略，维护成本都会成倍上升。

## Current Repo Truth

当前仓库里，桌面端本地知识链路的事实边界如下。

### 1. 上传与提取边界

桌面端上传入口在 `deeting/lib/api/knowledge.ts`。

当前行为：

- 文件先上传到本地 object storage
- 文本型文件由前端读取文本
- 图片型知识文件走单独的 OCR/多模态提取路径
- 最终把提取出来的 `meta_info.raw_text` 交给 `create_local_user_document`

这意味着当前桌面本地知识链路的 ingestion seam 仍然是：

`frontend/runtime extraction -> meta_info.raw_text -> local document create`

而不是：

- Rust/Tauri 直接解析所有原始文件
- 云端统一解析
- 单独的本地 ingestion worker 队列

### 2. Tauri 侧存储与 chunk 边界

`deeting/src-tauri/src/modules/knowledge/store.rs` 当前维护两张核心表：

- `user_document`
- `knowledge_chunk`

当前 `process_local_user_document_chunks_if_available(...)` 会：

- 从 `meta_info` 中读取文本
- 执行本地 chunk
- 写入 `knowledge_chunk`
- 把 `user_document.status` 改为 `indexed`
- 清掉 `meta_info.raw_text`

这说明当前系统已经存在一个很重要的工程事实：

- `raw_text` 是一个临时处理载荷
- `knowledge_chunk` 才是后续检索与注入的稳定下游输入

### 3. 当前 lexical 检索仍然是过渡态

`search_local_knowledge_chunks_in_documents(...)` 当前仍然是：

- SQLite `LIKE`
- Rust 内部手工算分
- 结果按 score 排序

这不是成熟的 lexical retrieval 内核。

### 4. 当前 selected knowledge 已经不是 lexical-only

`deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/retrieval.rs` 当前 selected knowledge 路径已经会并行执行：

- lexical search
- semantic search

然后做融合，再在没有结果时 fallback 到 leading chunks。

所以后续演进不能假设桌面知识检索还是“纯 chunk + 纯 lexical”的初始状态。

### 5. 当前已经存在局部 retry / rebuild seam

当前已有：

- `retry_local_user_document(...)`
- `rebuild_local_knowledge_vector_index(...)`

但它们覆盖的是局部重试和向量重建，不是一个完整的 ingestion rebuild contract。

尤其是：

- 成功文档在 chunk 完成后会 strip `raw_text`
- 这意味着“重新提取”与“重新切 chunk”目前并不是同一个能力

这也是本设计必须先定义 source of truth ownership 的原因。

## Product Thesis

桌面端知识引擎的正确产品形态应该是：

> RAGFlow 的工程思想 + 桌面端的轻量产品形态

它应该具备：

- 分层 ingestion
- 结构感知 chunk
- 本地 lexical 主导的轻量混合检索
- explain 和 diagnostics
- rebuild 与版本化

但它不应该变成：

- 重型 DAG 编排器
- 一堆长期驻留服务
- 一个桌面版知识库运维控制台

桌面端的核心价值仍然应该是：

- 轻
- 稳
- 离线
- 快
- 用户友好

## Design Principles

### 1. Keep the current extraction boundary, but cut the storage compatibility

短期内可以继续复用当前“前端 / OCR 负责 extraction”的产品边界。

但这不等于保留 `meta_info.raw_text` 这种 runtime 兼容入口。

Phase 1 应该保留的是 extraction ownership，不是保留旧 payload contract。

### 2. Separate lifecycle detail from user-facing readiness

不要把所有状态都堆进一个 `status` 字段。

内部流水阶段、失败原因、检索可用性、质量标记，应该分开建模。

### 3. Make rebuild semantics explicit

“重试 extraction”、“重切 chunk”、“重建索引”不是同一件事。

每种重建能力都必须有清晰的输入、产物和前提条件。

### 4. Keep hybrid retrieval, but strengthen lexical truth first

当前系统已经有 semantic lane。

后续不是回退到纯 lexical，而是：

- 先把 lexical 层升级成 FTS/BM25
- 再与当前 semantic lane 保持稳定融合

### 5. Prefer durable contracts over ad hoc metadata growth

不能继续让 `meta_info` 变成一个“想到什么塞什么”的容器。

要明确：

- durable metadata
- transient processing payload
- chunk metadata
- retrieval/debug metadata

分别归谁持有、保存多久、什么时候删除。

### 6. Phase 1 is a hard cut, not a compatibility lane

Phase 1 的目标是建立唯一真相，不是让新旧 contract 长期并存。

允许一次性迁移。

不允许长期 live dual-read。

## Target Layered Architecture

## 1. Source Layer

负责：

- 原文件接收
- object storage 写入
- 文件 hash
- MIME / 文件类型识别
- 上传来源记录

输出：

- `DocumentSource`

建议字段：

```ts
type DocumentSource = {
  document_id: string
  source_type: "desktop-local-upload"
  file_name: string
  file_type: string
  size_bytes: number
  content_hash?: string
  object_storage?: {
    object_key: string
    asset_url?: string
  }
}
```

Source Layer 的职责不是提文本，而是稳定保存原始来源与定位信息。

## 2. Extraction Layer

负责：

- 文本型文件提取
- 图片/OCR 提取
- 提取模式判定
- 提取质量估计
- parser 版本记录

输出：

- `DocumentExtractionResult`

```ts
type DocumentExtractionResult = {
  document_id: string
  parser_version: string
  extraction_mode:
    | "plain-text"
    | "pdf-text"
    | "docx-text"
    | "html-text"
    | "markdown-text"
    | "ocr"
  extraction_quality: "high" | "medium" | "low"
  text: string
  warnings: string[]
  page_count?: number
}
```

Phase 1 cutover policy:

- Phase 1 直接删除 `meta_info.raw_text` 作为 runtime ingestion seam 的角色
- 前端 / OCR 仍可继续负责 extraction，但必须写入正式的 extraction artifact 或 processing snapshot
- `user_document.meta_info` 只保留 durable metadata，不再混入完整文本载荷
- 旧文档通过一次性 backfill / migration 升级；迁不动的文档显式标记 `rebuild_required`

## 3. Normalization Layer

负责：

- 空白和换行标准化
- 页眉页脚去噪
- 短碎片合并
- 重复段落去噪
- 结构预切
- 质量标记

输出：

- `NormalizedDocument`
- 轻量 Block IR

```ts
type KnowledgeBlock =
  | { type: "title"; text: string; level?: number }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string; language?: string }
  | { type: "table"; text: string }
  | { type: "quote"; text: string }
  | { type: "section_break" }

type NormalizedDocument = {
  document_id: string
  normalizer_version: string
  text: string
  blocks: KnowledgeBlock[]
  structure_hints?: {
    title?: string
    headings?: string[]
    page_count?: number
  }
  quality_flags: string[]
}
```

## 4. Chunking Layer

负责：

- 结构优先切分
- 长块递归切分
- overlap
- chunk metadata 生成
- chunk 质量标记

输出：

- `KnowledgeChunkRecord[]`

建议 chunk config：

```ts
type ChunkingConfig = {
  strategy: "recursive_character" | "structure_first"
  max_chars: number
  overlap_chars: number
  min_chars: number
  prefer_boundaries: string[]
  version: string
}
```

建议 chunk metadata：

```ts
type KnowledgeChunkRecord = {
  id: string
  document_id: string
  chunk_index: number
  content: string
  chunk_type: string
  section_path: string[]
  page_hint?: number
  char_start?: number
  char_end?: number
  char_count: number
  estimated_token_count: number
  content_hash: string
  parser_version: string
  normalizer_version: string
  chunker_version: string
  quality_flags: string[]
}
```

## 5. Indexing Layer

负责：

- lexical index
- metadata index
- semantic chunk asset rebuild
- chunk adjacency / window relation

输出：

- `SearchReadyDocument`

建议路线：

- lexical: `SQLite FTS5/BM25`
- semantic: 保留现有 chunk asset / vector lane
- ranking: lexical 主导，semantic 作为增强

## 6. Retrieval Layer

负责：

- query normalization
- lexical recall
- semantic recall
- hybrid merge
- rerank
- window expansion
- explain

输出：

- `RetrievedContext[]`

重点不是“是否有 embedding”，而是“无论 lexical-only 还是 hybrid，都能解释为什么命中”。

## 7. Ops and Quality Layer

负责：

- versioning
- retry
- rebuild
- diagnostics
- corpus health
- offline evaluation

这是知识引擎从“能跑”升级到“能维护”的关键层。

## Ownership and Persistence Contract

这是本设计最关键的部分。

| Artifact | Owner | Durable | Purpose | Rebuild From |
| --- | --- | --- | --- | --- |
| 原文件 object | Source Layer | yes | 原始来源与用户可追溯性 | N/A |
| extraction text | Extraction Layer | yes, as extraction artifact or snapshot | 重新 normalize / re-chunk 的上游输入 | source object |
| normalized text / block IR | Normalization Layer | optional durable snapshot | 调试、re-chunk、结构分析 | extraction artifact |
| chunk rows | Chunking Layer | yes | 检索与注入基础单位 | normalized snapshot |
| lexical index | Indexing Layer | rebuildable | lexical recall | chunk rows |
| semantic chunk assets | Indexing Layer | rebuildable | semantic recall | chunk rows |
| debug preview / stage events | Ops Layer | yes, bounded retention | 调试、可观察性 | pipeline run |

结论：

- `meta_info.raw_text` 不能继续作为 Phase 1 的兼容 ingress seam
- Phase 1 必须把 extraction artifact / processing snapshot 立成正式 durable owner
- runtime 不再从 `raw_text` / `text` / `content` / `markdown` / `body` 做多 key 猜测
- 对旧文档只允许一次性迁移或显式 `rebuild_required`

## Status Model

当前 `processing/indexed/failed` 太粗，但也不应该简单扩成十几个互斥 status。

推荐拆成四层：

### 1. `stage`

内部流水阶段：

- `uploaded`
- `extracting`
- `normalizing`
- `chunking`
- `indexing`
- `ready`
- `retrying`
- `rebuilding`
- `archived`

### 2. `readiness_status`

对上层 UI 和检索可见的状态：

- `processing`
- `ready`
- `ready_low_quality`
- `failed`
- `stale`
- `rebuild_required`
- `archived`

### 3. `failure_reason`

失败原因：

- `unsupported`
- `empty_text`
- `parse_error`
- `ocr_required`
- `index_error`
- `storage_error`
- `unknown`

### 4. `quality`

质量标记：

- `high`
- `medium`
- `low`

这样做的好处是：

- UI 可以继续只显示用户可理解的状态
- 检索层可以依赖 `readiness_status`
- 诊断层可以看 `stage` 和 `failure_reason`
- 不会把“低质量但可检索”混同为“失败”

## Metadata Contract

`meta_info` 应该只承载 durable metadata，不继续承担所有处理载荷。

建议 durable `meta_info` 结构如下：

```json
{
  "contract_version": "desktop-local-knowledge-v1",
  "source": {
    "source_type": "desktop-local-upload",
    "file_type": "pdf",
    "size_bytes": 123456
  },
  "processing": {
    "parser_version": "desktop-parser-v1",
    "normalizer_version": "normalizer-v1",
    "chunker_version": "chunker-v1",
    "extraction_mode": "pdf-text",
    "extraction_quality": "high"
  },
  "structure_hints": {
    "title": "Example",
    "headings": ["A", "B"],
    "page_count": 12
  },
  "object_storage": {
    "object_key": "knowledge/...",
    "asset_url": "..."
  }
}
```

Phase 1 cutover requirements:

- Phase 1 之后 runtime 只认正式 extraction / normalization artifact，不再接受 `raw_text` / `text` / `content` / `markdown` / `body`
- `meta_info` 只保留 durable metadata，不再承担全文 payload 或 chunks fallback
- 旧数据通过 backfill / migration 升级；未升级数据显式标记 `rebuild_required`

## Minimal Schema Evolution

建议最小演进如下。

### `user_document`

新增或重构出：

- `stage`
- `readiness_status`
- `failure_reason`
- `quality`
- `content_hash`
- `parser_version`
- `normalizer_version`
- `chunker_version`
- `last_processed_at`
- `rebuild_required`

### `knowledge_chunk`

新增：

- `chunk_type`
- `section_path`
- `page_hint`
- `char_start`
- `char_end`
- `char_count`
- `content_hash`
- `parser_version`
- `normalizer_version`
- `chunker_version`
- `quality_flags`

### New supporting tables

建议新增至少一张：

- `user_document_processing_snapshot`

用于保存：

- extraction text
- normalized text
- block IR
- preview
- run metadata

如果不想一次性上完整快照表，也至少要先为 `extraction artifact` 找一个正式持久化位置。

## Retry and Rebuild Contract

这是当前最容易被误写成空话的一部分。

推荐把重试 / 重建能力显式区分为四类：

### 1. Retry extraction

输入：

- source object
- parser config

输出：

- new extraction artifact

适用场景：

- parser 升级
- OCR provider 更换
- 原始提取失败

### 2. Retry normalization

输入：

- extraction artifact
- normalizer config

输出：

- new normalized snapshot

适用场景：

- 去噪规则升级
- 结构切分规则升级

### 3. Rebuild chunks

输入：

- normalized snapshot
- chunker config

输出：

- fresh `knowledge_chunk[]`

适用场景：

- chunk strategy 升级
- overlap 策略调整
- 结构切分落地

### 4. Rebuild index

输入：

- chunk rows

输出：

- lexical index
- semantic index

适用场景：

- FTS 索引重建
- embedding provider 变更
- semantic asset rebuild

原则：

- 不要把“重新上传”当成唯一恢复手段
- 也不要把“重建向量索引”误当成“重新处理整个文档”

## Retrieval Strategy

## Phase 1 Target

保留现有 hybrid retrieval 路径，但只把它当作新 chunk contract 的消费者。

Phase 1 不重写 selected knowledge 的 lexical + semantic 融合逻辑，优先切掉 ingestion / storage 的兼容包袱：

- retrieval 只读新的 `readiness_status`
- lexical 仍可暂时沿用当前 `LIKE + 手工 score`
- 但 query 输入、chunk metadata、fallback 边界必须全部来自新的 durable contract
- fallback 不得再回退到 `user_document.meta_info` 内容字段

## Phase 2 Target

chunk 从机械切分升级到结构感知切分。

## Phase 3 Target

lexical 层从当前 SQLite `LIKE` 升级到 `FTS5/BM25`，并保持与现有 semantic lane 的稳定融合。

推荐最终检索形态：

1. query normalization
2. lexical recall
3. semantic recall
4. hybrid fusion
5. quality penalty / heading boost / filename boost
6. chunk window expansion
7. explain output

### Ranking signals

建议总分由以下部分组成：

- `lexical_score`
- `semantic_score`
- `filename_boost`
- `heading_boost`
- `exact_phrase_boost`
- `quality_penalty`
- `noisy_chunk_penalty`
- `recency_boost` optional

### Explain contract

每次命中结果应可解释：

```json
{
  "document_id": "...",
  "chunk_id": "...",
  "final_score": 0.81,
  "score_breakdown": {
    "lexical_score": 0.72,
    "semantic_score": 0.60,
    "heading_boost": 0.08,
    "quality_penalty": -0.05
  },
  "match_reason": [
    "fts:title",
    "semantic:top8",
    "window:+1"
  ]
}
```

## Diagnostics and Debug Panel

至少需要一个开发侧 diagnostics surface。

### Document view

- 原文件信息
- 当前 stage
- readiness status
- failure reason
- extraction quality
- source object
- extraction preview
- normalized preview
- block IR preview
- chunk 列表
- 每个 chunk 的长度与质量标记

### Retrieval view

- query
- normalized query
- lexical hits
- semantic hits
- fused top results
- explain score
- expanded context

### System view

- parser / chunker / retriever version 分布
- rebuild backlog
- stale / rebuild-required 文档数
- failure reason 聚合
- OCR required 队列

## Evaluation Strategy

评测不要等到最后才做。

建议在 Phase 2 末之前就建立最小评测集：

- 一组标准文档
- 一组标准 query
- 期望命中的 section / chunk
- 期望的 citation span

建议指标：

- `Recall@k`
- `MRR`
- `grounded context hit rate`
- `section hit accuracy`

## Phase Plan

## Phase 1: Foundation Cutover

目标：

- 把 `source -> extraction artifact -> normalization/chunk -> index` 立成唯一真相链路
- 删除 `meta_info.raw_text` 与多 key 文本猜测的 runtime 兼容
- 拆分 `stage` / `readiness_status` / `failure_reason` / `quality`
- 让 retry / rebuild 变成明确的分阶段能力，而不是一个笼统 `retry`
- 建立最小 diagnostics，能看出文档当前卡在哪一层

完成标准：

- `user_document.meta_info` 不再承载全文 payload
- runtime 只从正式 artifact / snapshot 读取可处理文本
- `knowledge_chunk` 成为 lexical / semantic / diagnostics 的统一下游真相
- 旧文档要么完成一次性 backfill，要么进入 `rebuild_required`
- Phase 1 合并后不再保留 live compatibility path

执行任务分解见：`.omx/plans/2026-04-16-desktop-local-knowledge-engine-hard-cutover-plan.md`

## Phase 2: Structure-Aware Chunking

目标：

- 引入 Block IR
- 结构预切
- chunk metadata 升级
- quality 标记

完成标准：

- chunk 不再是纯字符盲切
- section / page / type 等边界开始可追溯
- 可以为 explain 和 window expansion 提供结构依据

## Phase 3: Mature Local Retrieval Core

目标：

- lexical 层切换到 FTS5 / BM25
- 保持 hybrid retrieval
- 引入 ranking 策略
- 引入 window expansion
- 提供 explain

完成标准：

- 不再依赖当前 `LIKE + 手工 score` 作为主 lexical 内核
- query -> result 的排名可解释
- selected knowledge 与后续本地检索复用同一套核心逻辑

## Phase 4: Long-Term Operations

目标：

- 全链路版本化
- rebuild 管理
- 去重与增量更新
- 产品级 diagnostics
- 离线评测体系

完成标准：

- 可以识别旧产物并要求升级
- 可以单文档 / 全库 rebuild
- 可以对检索退化做有指标的回归判断

## Migration Strategy

这次迁移应按 **branch-scoped hard cutover** 执行，而不是长期兼容：

1. 先落地新 schema / artifact / status contract，并把 uploader、commands、store、embedding trigger 改到新链路
2. 同批删除 `meta_info.raw_text` 和 `raw_text` / `text` / `content` / `markdown` / `body` 的 runtime 兜底读取
3. 对历史数据只做一次性 backfill / migration；无法升级的文档显式标记 `rebuild_required`
4. 在 foundation cutover 稳定后，再推进结构切分、FTS5/BM25、ranking explain

禁止继续引入以下“看起来省事、实际上会变成维护地狱”的做法：

- 旧 schema 读兼容 + 新 schema 写并存
- 运行时按多个 `meta_info` key 猜测正文
- 在 retrieval 或 rebuild 时偷偷回退到旧 payload
- 用“先留着，后面再删”掩盖 owner 没切干净

## Explicit Non-Goals

- 不在本轮把所有本地文件解析统一迁到 Rust
- 不把桌面知识引擎改造成重型 DAG 编排平台
- 不把主 chat 默认注入改成“全库无差别知识检索”
- 不把语义 embedding 作为第一优先级，优先升级 lexical truth
- 不把 LLM Wiki 或其他专用 corpus 与主知识库 ownership 混在一起

## Final Recommendation

最终建议非常明确：

- 保留当前桌面本地知识链路的大方向
- 不推翻，不另起一个桌面版 RAGFlow
- 在现有架构上演进为一个正式的 `Desktop Local Knowledge Engine`

这个目标形态的核心不是“上传 + chunk 表”，而是：

- 有 source of truth
- 有分层 ingestion
- 有结构感知 chunk
- 有 lexical-first hybrid retrieval
- 有 explain
- 有 rebuild
- 有 diagnostics
- 有 versioning
- 有 evaluation

只有这样，桌面端知识库才会从“当前能用”升级为“后续真的能维护、能优化、能继续长大”。
