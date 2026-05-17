# Deeting RAG 架构

> 适用范围：桌面端本地对话（local chat）的检索增强生成（RAG）链路。
> 不覆盖：云端 / FastAPI 检索路径（如有，留待单独文档）。

本文档是 Deeting 桌面端 RAG 的"权威说明书"，目标是让未来回顾、其他人接手维护、新成员学习都可以从这一篇直接读懂：

- 系统的设计动机（为什么这么做）
- 系统的拓扑（谁在干什么）
- 系统的边界（什么允许、什么禁止）
- 在哪里加东西、在哪里改东西

## 1. TL;DR

Deeting 桌面端 **不再** 在生成回答前把 RAG 内容隐式拼到 system prompt 里。

取而代之的是：

- 进入对话前，runtime 只往 prompt 里写一份**简短清单（manifest）**——告诉模型"你有哪些上下文源、有哪些 context 工具、当前对话选中了哪些知识文件"，但不附带 chunk 正文。
- 模型自己在需要时**显式调用 context 工具**（`context_search` / `context_open` / `context_expand` / `context_summarize_evidence`）去拉记忆、文档、Wiki 片段。
- 三大检索源（Memory / LLM Wiki / Knowledge）保留各自的 source-native 评分与生命周期算法，新 context 层**只路由、不重打分**。

这种结构叫 **Context Orchestrator**。它住在 [`deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/)。

## 2. 为什么这么做

旧设计（自动内容注入）的问题：

1. **黑盒**：模型不知道哪段上下文从哪来、依据什么被选中——只看到一段拼好的 prompt body。难以解释、难以引用、难以让模型决定"我要不要再问一次"。
2. **预算浪费**：每轮对话都把 selected knowledge chunks、semantic memory 命中结果灌进 prompt，无论本轮是否真的需要。
3. **多源混淆**：Memory 的 vitality、LLM Wiki 的 corpus score、Knowledge 的 BM25 + RRF 被强行揉成同一个"上下文打分"，把不同语义的分数错放在同一个尺度上比较。
4. **没有可追溯的证据链**：UI 只能笼统说"已加载知识"，无法在回答里贴出具体来源、具体相关度、具体段落。

新设计（Context Orchestrator + 工具化检索）解决方式：

| 旧 | 新 |
|---|---|
| 静默地把 chunk 拼进 system prompt | 写清单（manifest），列出可用源和工具，不拼正文 |
| 一刀切的"上下文打分" | 每个源保留自己的 `score_semantics` 字符串和评分 |
| 模型不知道为什么得到这些内容 | 模型主动调用工具，工具返回带 `source_refs` 的 evidence envelope |
| 一次注入、注入完拉倒 | 模型可以 search → open → expand → summarize 多轮深挖 |
| 双重 lifecycle 风险（外层再加 decay） | 严格禁止——**No Double Lifecycle Rule** |

## 3. 架构总览

```text
┌────────────────────────────────────────────────────────────────┐
│ Local chat workflow (LocalOrchestrationEngine)                 │
│                                                                │
│   SummaryInjectionStep                                         │
│   PersonaPromptInjectionStep                                   │
│   ContextManifestStep  ← Context Orchestrator 的清单注入入口   │
│   GeneratedArtifactContextInjectionStep                        │
│   RouteSelectionStep                                           │
│   SkillRecipeInjectionStep                                     │
│   PromptVariantSelectionStep                                   │
│   TemplateRenderStep                                           │
│         │                                                      │
│         ▼  (orchestrated_messages)                             │
└────────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────┐
│ chat_tool_runtime (agentic loop)                               │
│                                                                │
│   每轮:                                                        │
│     ① 调 provider 拿 tool_calls                                │
│     ② 命中 context_* 工具 → execute_context_tool(...)          │
│           │                                                    │
│           ▼                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ context_orchestrator/tools.rs                       │    │
│     │   - parse args                                      │    │
│     │   - 按 source_type 分发                             │    │
│     │   - 通过 adapter 调用源原生检索                     │    │
│     │   - 包装为 ContextEvidenceEnvelope                  │    │
│     └─────────────────────────────────────────────────────┘    │
│           │                                                    │
│     ③ 工具结果回写到 orchestrated_messages，进下一轮           │
└────────────────────────────────────────────────────────────────┘
```

### 模块树

```
deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/
├── mod.rs        // 模块入口、re-exports
├── fsm.rs        // ContextOrchestrator、ContextManifest、prompt 渲染
├── policy.rs     // ContextRoutingPolicy + No Double Lifecycle Rule
├── envelope.rs   // ContextEvidenceEnvelope、ContextEvidenceItem 等返回类型
├── tools.rs      // execute_context_tool、search/open/expand/summarize 实现
├── trace.rs      // ContextTrace（FSM 状态轨迹）
├── tests.rs      // 单元测试
└── adapters/
    ├── mod.rs        // ContextSourceAdapter trait
    ├── memory.rs     // Memory adapter（不重打分）
    ├── llm_wiki.rs   // LLM Wiki adapter（不重打分）
    └── knowledge.rs  // Knowledge adapter（不重打分）
```

## 4. 状态机（FSM）

`ContextOrchestrator` 概念上经过以下状态：

```
BuildManifest
   → ClassifyNeed          // 当前实现保守：让模型自己判断需不需要调工具
   → PlanSources           // 由 ContextRoutingPolicy 决定哪些源参与
   → Retrieve              // 调 adapter，访问源原生检索
   → EvaluateCoverage      // 用 ContextCoverage 给标签（empty/sparse/focused/broad）
   → ExpandIfNeeded        // 由模型显式 context_expand
   → CompressIfNeeded      // 可选：context_summarize_evidence
   → EmitBundle            // 输出 envelope
   → RecordTrace
```

代码上的状态枚举见 [`fsm.rs::ContextOrchestratorState`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs)。当前实现把 `ClassifyNeed`/`PlanSources` 等做成"通过工具调用驱动"的形态：不主动检索，而是把可用源和工具写进 manifest，让模型决定何时调。

## 5. 三大上下文源与所有权

| 源 | source_type | 检索 owner | 评分语义（`score_semantics`） |
|---|---|---|---|
| Memory | `memory` | [`MemoryService::search`](../deeting/src-tauri/src/modules/memory/service.rs) | "memory.score is semantic relevance after MemoryService lifecycle/vitality/supersession handling" |
| LLM Wiki | `llm_wiki` | [`search_local_llm_wiki_corpus`](../deeting/src-tauri/src/modules/llm_wiki/service.rs) | "llm_wiki.score is corpus lexical and semantic relevance from llm_wiki search" |
| Knowledge | `knowledge` | [`KnowledgeStore`](../deeting/src-tauri/src/modules/knowledge/store.rs) (FTS5 BM25 + semantic + RRF) | "knowledge.score is evidence relevance from FTS/BM25, semantic search, chunk quality, and RRF fusion" |

每个源的算法**留在源所在的模块里**，context 层只通过 adapter 桥接：

- Memory 的 lifecycle / vitality / supersession 都封装在 [`retrieval_kernel/{lifecycle,write_guard,supersession}.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/) 里，MemoryService 调用它们，**adapter 拿到的就是已经 rerank 过的结果**。
- LLM Wiki 的 corpus lexical + semantic + final score 由 wiki 模块自己产出，envelope 透传 `lexical_score` / `semantic_score` / `final_score`。
- Knowledge 的 lexical_score、match_reasons、section_path、quality_flags、score_breakdown 全部从 store 层透传到 envelope。

> **重要**：三个源的 `score` 字段**不在同一个尺度**上。前端 UI 必须连带显示 `score_semantics`，不要做跨源直接比较。

## 6. No Double Lifecycle Rule（最重要的规则）

Context 层是**路由层**，不是**评分层**。允许：

- 路由：按 source_type 把请求送到对应 adapter
- 决定可见性：用 `ContextInjectionMode` 决定一个源是 `CoreOnly` / `ManifestOnly` / `ManifestAndTools` / `ToolOnly`
- 标签化覆盖度：用 `ContextCoverage` 给 `empty`/`sparse`/`focused`/`broad`
- 写 trace：在 envelope 里记录路由动作和状态

**禁止**：

- ❌ `score *= freshness`
- ❌ `score *= recency`
- ❌ `score *= vitality`
- ❌ `score *= trust`
- ❌ 重新实现 write guard 阈值
- ❌ 因为文档"老旧"就降权
- ❌ 把不同源的分数归一到统一信任尺度

为什么这条规则这么硬？因为每个源的 lifecycle 算法已经在源所在的模块里被认真设计、调参、测试过。Context 层再叠一层 decay 等于无声地双重折损，并且**没人会知道**——一次提交就能引入，一次回滚也修不掉对线上数据的污染。

规则物化为：

1. [`policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs) 顶部的模块文档注释
2. 三个 adapter 文件顶部各自的提醒注释
3. 单元测试 `routing_policy_preserves_source_scores`（断言 `route_envelope` 不改写 score）

## 7. Manifest vs Body Injection

旧路径：把检索结果**正文**塞进 system prompt。
新路径：只塞**清单**。

| 仍然自动注入 | 改为显式工具 |
|---|---|
| session summary | 普通 semantic memory 召回 |
| persona prompt | LLM Wiki 正文 / chunks |
| **core/boot memory**（仅 core 层级的记忆） | 本地知识 chunks |
| 选中知识文件的 **manifest 元信息** | 多文档证据 |
| 可用 source 与可用 context 工具的列表 | 证据摘要 |

`ContextManifestStep` 是 workflow 里唯一的注入入口。它会在 system prompt 里写出这样一段（具体见 [`fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs)）：

```text
## Context Manifest
Use this manifest to decide whether to call context tools. ...

### Core Memories
- 始终使用简体中文。

### Selected Knowledge Files
- roadmap.md (file_id: file-abc, status: indexed, chunks: 12)
- spec.md (file_id: file-def, status: indexed, chunks: 8)
Open or search selected knowledge through context tools before using document evidence.
To search inside these selected files, call `context_search` with `scope: "selected"` and `filters.selected_file_ids: ["file-abc", "file-def"]`. If `selected_file_ids` is omitted in selected scope, the runtime falls back to the files listed here.
To open a specific chunk, call `context_open` with `source_type: "knowledge"`, `file_id`, and optional `chunk_index`.

Available context sources: memory, llm_wiki, knowledge.
Available context tools: context_search, context_open, context_expand, context_summarize_evidence.
```

## 8. Context Tools

工具通过 [`core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) 注册到 runtime 工具目录。chat_tool_runtime 在 agentic loop 里识别 `is_context_tool(name)` 并路由到 [`execute_context_tool`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs)。

### context_search

```jsonc
{
  "source": "memory | llm_wiki | knowledge | auto",  // 默认 auto
  "query": "string",                                  // 必填
  "scope": "selected | all | folder | workspace | session",
  "limit": 6,
  "include_neighbors": false,
  "filters": {
    "selected_file_ids": ["file-abc"],                // knowledge scope=selected 时使用
    "category": "preference",                        // memory source-local filter
    "doc_id": "llm_wiki_doc::abc",                   // llm_wiki source-local filter
    "relative_path_prefix": "wiki/analyses"          // llm_wiki source-local filter
  }
}
```

行为：

- `source: "auto"` → 并发查三源，分别返回三个 envelope（不归一）
- `source: "memory" | "llm_wiki" | "knowledge"` → 仅查该源
- `scope: "selected"` + 缺省 `filters.selected_file_ids` → 自动回落到工作流注入的 selected knowledge files（见 §9）
- `include_neighbors` 只是展开意图提示，`context_search` 仍只返回检索命中；需要邻近 chunk 时继续调用 `context_expand`
- source-local filters：Memory 支持 `session_id` / `capability_id` / `category` / `source` / `tags`；LLM Wiki 支持 `scope` / `doc_id` / `relative_path` / `relative_path_prefix`；Knowledge 支持 `selected_file_ids` / `file_ids`

### context_open

```jsonc
{
  "source_type": "memory | llm_wiki | knowledge",
  "id": "string",          // memory: memory id；llm_wiki: "docId:chunkIndex"；knowledge: "fileId:chunkIndex"
  "doc_id": "string",      // llm_wiki 时可单独传
  "file_id": "string",     // knowledge 时可单独传
  "chunk_index": 0,        // knowledge 时可单独传
  "window": 1              // 取邻居数（chunk 上下展开）
}
```

行为：

- `memory` → 按 memory id 直接打开本地记忆
- `llm_wiki` → 按 `doc_id + chunk_index` 精确打开 Wiki chunk；`id` 可用 `doc_id:chunk_index` 形式
- `knowledge` → 按 `file_id + chunk_index` 精确打开知识文件 chunk；`id` 可用 `file_id:chunk_index` 形式

### context_expand

与 `context_open` 同 schema，语义是"扩大窗口"。当前实现对 `knowledge` 与 `llm_wiki` 会打开焦点 chunk 附近的邻居 chunk；对 `memory` 则仍是按单条 memory id 打开。

### context_summarize_evidence

可选工具。对模型已经检索到的 envelope 做**确定性截断**——保留 `source_refs` 和 `score_semantics`，截断 content 到限定长度。不调用 LLM、不主动总结、不替代回答。

> 设计纪律：summarize 工具不能变成"隐藏的最终回答 agent"。它只是节省 token。

## 9. Selected Knowledge Fallback

来自一个具体场景：

> 用户在对话里选了几个知识文件，manifest 把 file_ids 写进了 system prompt。模型想搜这些文件，却忘了把 `filters.selected_file_ids` 写进工具参数，只传了 `scope: "selected"`。

旧实现会在缺省 filter 下用空数组去过滤，返回零命中。新实现是**双保险**：

1. **Prompt 端教学**：manifest 提示文本里内联具体 file_id 并明示"省略时会回落"。
2. **Runtime 端兜底**：`search_knowledge` 调用 [`resolve_selected_file_ids`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs)，规则是：

   ```
   IF filters.selected_file_ids 非空     → 用 filters 提供的 ids（显式胜出）
   ELSE IF scope == "selected"           → 用 workflow context 的 ids
   ELSE                                  → 空数组（不隐式作用域化）
   ```

3. **持久化打通**：`selected_knowledge_file_ids` 跟随状态串到 [`LocalChatToolRuntimeState`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) → `PersistedChatToolRuntimeContext` → `SuspendedChatToolExecution`，suspend/resume/recovery 三条路径都保留这份 fallback 列表（旧持久化记录通过 `#[serde(default)]` 安全回零）。

trace 里会写 `used_context_fallback: true/false`，方便排查"模型究竟有没有走兜底"。

## 10. Evidence Envelope

所有 context 工具的返回统一长这样：

```rust
pub struct ContextEvidenceEnvelope {
    pub source_type: ContextSourceType,            // memory / llm_wiki / knowledge
    pub query: String,
    pub items: Vec<ContextEvidenceItem>,
    pub coverage: ContextCoverage,                 // empty / sparse / focused / broad（按 item 数量分桶）
    pub coverage_signals: ContextCoverageSignals,  // 分数分布的形状统计 + confidence 离散标签
    pub score_semantics: String,                   // 源原生评分语义说明
    pub recommended_next_action: ContextNextAction,// answer_with_evidence / search_again / open_source / ...
    pub trace: ContextTrace,
}

pub struct ContextEvidenceItem {
    pub id: String,
    pub source_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub score: f64,                       // 源原生分数，禁止 cross-source 比较
    pub score_breakdown: serde_json::Value,
    pub source_refs: Vec<ContextSourceRef>,
    pub quality_flags: Vec<String>,
    pub lifecycle: Option<serde_json::Value>,
}
```

### 10.1 Coverage Signals（分数分布形状）

`coverage_signals` 由 [`ContextCoverageSignals::from_items`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/envelope.rs) 在构造 envelope 时自动计算，只读 `item.score`，不写任何分数 —— 是 envelope 自带的**描述性统计**，不是评分层。

```rust
pub struct ContextCoverageSignals {
    pub item_count: usize,
    pub top_score: Option<f64>,        // 最高分
    pub second_score: Option<f64>,     // 次高分
    pub score_gap: Option<f64>,        // top - second
    pub score_gap_ratio: Option<f64>,  // (top - second) / top
    pub score_mean: Option<f64>,
    pub score_stddev: Option<f64>,
    pub flatness: Option<f64>,         // stddev / mean，变异系数
    pub confidence: ContextConfidence, // 离散标签
}

pub enum ContextConfidence {
    Empty,      // 0 命中
    Strong,     // top 明显领先：score_gap_ratio >= 0.30
    Ambiguous,  // 分布平坦：item_count >= 3 且 flatness < 0.10
    Mixed,      // 其他（稀疏、渐降、单条等）
}
```

**阈值是纯形状的**：`score_gap_ratio` 是比值，`flatness` 是变异系数，都不带量纲，对任何分数尺度（0-1 / 0-100 / 任意单调评分）通用。这是为什么这些阈值可以**跨源共用**而不违反 No Double Lifecycle Rule —— 它们没有把不同源的分数归一到同一尺度，而是只看各源**自己分布的形状**。

**这一层是"通用基线"**：

- ✅ 它回答的是：「这次返回的分数形状像什么样？」
- ❌ 它**不**回答：「这条源的证据够不够下结论？」

后者属于源特定（source-specific）层的职责。如果未来要加 `needs_open_source` / `single_memory_only` / `selected_scope_fallback_used` 这类带源语义的 confidence 信号，应当**追加**在 `coverage_signals` 之外（例如 `coverage_signals.reasons: Vec<String>`），而不是替换或污染这层通用统计。

模型行为的引导通过 [§8 Manifest 文案](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs) 实现，会告诉模型：

- `confidence: strong` → 直接答 + 引用 source_refs
- `confidence: ambiguous` → 改写更具体的 query 再 `context_search`
- `confidence: mixed` → 考虑 `context_expand` 拿邻居，或 `context_open` 看 top 命中
- `confidence: empty` → 换 query / 换源 / 反问用户，不要编

trace 里会同步写入 `confidence` / `top_score` / `score_gap_ratio` / `flatness`，方便复盘"模型为什么决定再查一次"。

工具返回时再包一层格式版本号：

```jsonc
{
  "format_version": "context_evidence.v1",
  "tool": "context_search",
  "source": "knowledge",
  "query": "...",
  "envelope": { /* ContextEvidenceEnvelope */ }
}
```

`auto` 模式下用 `envelopes: [...]` + `errors: [...]`。

## 11. 前端集成

### 状态事件

`ContextManifestStep` 在执行完成时 emit：

```
code: "context.manifest.loaded"
meta: {
  "core_memory_count": N,
  "selected_knowledge_count": M,
  "available_sources": ["memory", "llm_wiki", "knowledge"],
  "available_tools": ["context_search", "context_open", ...]
}
```

前端在 [`lib/chat/status-detail.ts`](../deeting/lib/chat/status-detail.ts) 里把这个 code 翻成多语言展示。

为了不破坏老用户已持久化的对话，前端**保留** `knowledge.context.loaded` 的读侧解析（[`chat-message-list.tsx`](../deeting/components/chat/messages/chat-message-list.tsx)、[`use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts)），它只在历史消息回放时仍能正确渲染，但不再由 runtime 主动 emit。

### Evidence 卡片渲染

`status-rail.tsx` 目前是过渡进度指示器；envelope-based 证据卡片的通用化（覆盖三源）是 [`refactor 计划`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md) 里 Step 6 的待办事项。

## 12. 文件地图

按"我想改什么"反向定位：

| 我想… | 看这里 |
|---|---|
| 改 manifest prompt 文案 | [`context_orchestrator/fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs) |
| 改 source 路由策略 / injection_mode | [`context_orchestrator/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs) |
| 改某个工具的实现 | [`context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) |
| 改 envelope 字段 | [`context_orchestrator/envelope.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/envelope.rs) |
| 新增一个上下文源 | 新建 `adapters/<name>.rs` + 实现 `ContextSourceAdapter` trait + 在 [`tools.rs::search_source`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) 加分支 |
| 改 Memory 召回算法 | **不在 context 层**，去 [`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs) 或 [`retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/) |
| 改 Knowledge FTS / 语义检索 | **不在 context 层**，去 [`knowledge/store.rs`](../deeting/src-tauri/src/modules/knowledge/store.rs) |
| 改 LLM Wiki corpus 搜索 | **不在 context 层**，去 [`llm_wiki/service.rs`](../deeting/src-tauri/src/modules/llm_wiki/service.rs) |
| 改 context 工具注册 / 可见性 | [`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) |
| 改 agentic loop 中工具分发 | [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) 里搜 `is_context_tool` |
| 改前端 status 文案 | [`lib/chat/status-detail.ts`](../deeting/lib/chat/status-detail.ts) + 对应 [`messages/{zh-CN,en}/chat.json`](../deeting/messages/) |
| 改 workflow 步骤顺序 | [`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) |

## 13. 怎么扩展

### 加一个新的上下文源（例：`scout` 网页快照）

1. 在 [`adapters/`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/adapters/) 加 `scout.rs`：

   ```rust
   //! Scout source adapter.
   //!
   //! No Double Lifecycle Rule: scout snapshots already carry a freshness
   //! score from the scout crawler; this adapter must not re-decay them.

   use crate::modules::desktop_runtime::context_orchestrator::adapters::ContextSourceAdapter;
   use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;

   #[derive(Debug, Clone, Copy, Default)]
   pub struct ScoutContextAdapter;

   impl ContextSourceAdapter for ScoutContextAdapter {
       fn source_type(&self) -> ContextSourceType { ContextSourceType::Scout }
       fn score_semantics(&self) -> &'static str {
           "scout.score is page relevance from scout crawler (lexical + semantic + freshness, owned by scout)"
       }
   }
   ```

2. 在 [`envelope.rs::ContextSourceType`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/envelope.rs) 加变体 `Scout` 并补 `as_str`。
3. 在 [`policy.rs::ContextRoutingPolicy::default`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs) 加策略条目（通常 `ManifestAndTools` 或 `ToolOnly`）。
4. 在 [`tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) 的 `search_source` / `parse_source_type` / `auto` 列表 加分支。
5. 实现 `search_scout(app_state, query, limit) -> ContextEvidenceEnvelope`，**调用 scout 模块原生检索**，把 scout 的命中映射成 `ContextEvidenceItem`。
6. 写一个 adapter 不变形测试：断言 envelope 里的 `score` 与 scout 模块返回值逐字相等。

### 加一个新的 context 工具（例：`context_pin`）

1. 在 [`fsm.rs::CONTEXT_TOOL_NAMES`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs) 加名字。
2. 在 [`core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) 注册 input/output schema、example_arguments、permission_scope。
3. 在 [`tools.rs::execute_context_tool`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) match 分支加实现。
4. 决定要不要 `manifest` 中宣传给模型（在 fsm.rs 里追加一行 prompt 说明）。

### 改 manifest 行为

只改 [`fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs)。注意：

- 不要在这里塞 chunk 正文。要正文就调工具。
- 不要按 ms 单位的时间戳塞 prompt——模型会糊。给绝对日期或相对描述。
- 改完一定要同步更新 [`tests.rs::manifest_renderer_*`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tests.rs)。

## 14. 反模式（PR review 时拒绝）

- 在 context 层对 `item.score` 做任何 `*=` 操作
- 在 adapter 里手写 freshness/recency/vitality 公式
- 把"chunk 正文"重新塞回 `ContextManifestStep` 的 system prompt
- 把多个源的 score 归一到统一信任分
- 在 `ContextOrchestrator` 里持有可变全局状态（FSM 是无状态算子）
- 引入"默认就调 context_search"的隐式预检索（要查就让模型查）
- 让 `context_summarize_evidence` 调用 LLM 来"总结后回答"——它必须是确定性截断
- 把 fallback 行为做成"任何 scope 缺 file_ids 都用 ctx ids"（只在 selected scope 下兜底，否则会污染 all/auto）

## 15. 已知决策与原始计划

| 决策 | 来源 |
|---|---|
| 硬切而非长期双轨 | [`.omx/plans/2026-05-16-context-orchestrator-refactor.md`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md) |
| 三源不归一 score | 同上 "Do not force all scores into one global trust scale" |
| selected_knowledge_file_ids 工作流→工具兜底 | 本次重构（2026-05-16） |
| 旧 `knowledge.context.loaded` 仅保留读侧兼容 | 同上 |
| Memory lifecycle / write_guard / supersession 留在 retrieval_kernel | [`retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/) |

## 16. 验证清单

改动 RAG 链路的 PR 必须自检以下任一相关项：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo check --tests`
- [ ] `cargo test --lib context_orchestrator --no-fail-fast`
- [ ] `cargo test --lib local_orchestrator --no-fail-fast`
- [ ] `cargo test --lib retrieval_kernel --no-fail-fast`
- [ ] `cargo test --lib memory --no-fail-fast`
- [ ] `cargo test --lib llm_wiki --no-fail-fast`
- [ ] `cargo test --lib knowledge --no-fail-fast`
- [ ] 前端：`npm test -- hooks/chat/__tests__/use-chat-messaging-service.test.tsx --runInBand`
- [ ] 前端：`npm test -- lib/chat --runInBand`
- [ ] 桌面端手测：新建对话 → 选中知识文件 → 提问 → 观察模型是否调 `context_search` / `context_open` → 状态栏是否显示 `context.manifest.loaded`

> Windows 主机已知 caveat：`cargo test` 的二进制有时会因 DLL 加载失败（STATUS_ENTRYPOINT_NOT_FOUND）启动失败。区分"编译失败"和"运行失败"——前者必须修，后者通常是宿主环境问题，应在 CI/Linux 复跑。

## 17. FAQ

**Q：为什么核心记忆（core / boot memory）还在自动注入？**
A：核心记忆是"始终适用的人格 + 用户偏好（如语言、称呼）"，体量小、命中率近 100%、不依赖当前 query。把它工具化反而会让每轮强制调一次工具，得不偿失。`ContextInjectionMode::CoreOnly` 表达的就是这个边界。

**Q：模型会不会因为内容不再自动注入就忘了用 RAG？**
A：风险存在，缓解手段：(1) manifest prompt 明确广告可用工具；(2) 失败 / 空命中时 envelope 的 `recommended_next_action` 会引导下一步；(3) 必要时通过 prompt variant 加强提示。下一步可考虑加 tool-call 行为测试（"含选中知识时第一轮必须出现 context_*"）。

**Q：能不能在 context 层叠加 "trust score"，让来源更可信的源排前面？**
A：不能。trust 是 cross-source 比较，违反 No Double Lifecycle Rule。如果产品上确实需要 cross-source 排序，正确做法是在**展示层**做，并且必须连带显示 `score_semantics`。

**Q：`context_summarize_evidence` 能不能变成"用 LLM 总结后再回答"？**
A：不能。一旦它能进入回答路径，就变成隐藏的二级 agent，破坏可追溯性。它的合法用法只有一种：在 token 紧张时确定性截断 envelope 内容，保留 source_refs。

**Q：将来要加 reranker（如 cross-encoder）怎么办？**
A：放在源所在模块内部（如 `knowledge/reranker.rs`），让 KnowledgeStore 返回 rerank 后的 hits。Context 层照常透传。**不要**在 adapter 里写 reranker。

## 18. 参考

- 重构原始计划：[`.omx/plans/2026-05-16-context-orchestrator-refactor.md`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md)
- Retrieval Kernel 模块：[`deeting/src-tauri/src/modules/retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/)
- 桌面 runtime 主权宪章（设计哲学）：[`deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)
- Workflow 引擎：[`deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)
- **RAG 评测**:[`docs/rag-eval.md`](./rag-eval.md) —— 用 recall@k / MRR 量化每次 RAG 改动的回归与提升
