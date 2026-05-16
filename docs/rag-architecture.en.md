# Deeting RAG Architecture

> Scope: the retrieval-augmented generation (RAG) path for desktop local chat.
> Out of scope: any cloud / FastAPI retrieval path (left for a separate document if it ever exists).

This document is the authoritative spec for desktop RAG in Deeting. The goal is the same as the Chinese version ([`rag-architecture.md`](./rag-architecture.md)) — anyone reviewing later, taking over maintenance, or learning agent design should be able to read this single file and understand:

- The design motivation (why we built it this way)
- The system topology (who does what)
- The system boundary (what is allowed, what is forbidden)
- Where to add things, where to change things

## 1. TL;DR

Deeting desktop **no longer** implicitly stitches RAG content into the system prompt before generating an answer.

Instead:

- Before each turn, the runtime writes only a short **manifest** into the prompt — telling the model "these are the context sources available, these are the context tools, these knowledge files are currently selected" — without including chunk bodies.
- The model **explicitly calls context tools** (`context_search` / `context_open` / `context_expand` / `context_summarize_evidence`) when it actually needs memories, documents, or wiki fragments.
- The three retrieval sources (Memory / LLM Wiki / Knowledge) keep their own source-native scoring and lifecycle algorithms. The new context layer **only routes; it never re-scores**.

This structure is called the **Context Orchestrator**. It lives in [`deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/).

## 2. Why we did it this way

The old design (automatic content injection) had several problems:

1. **Black box.** The model did not know where any piece of context came from or why it was selected — it just saw an assembled prompt body. Hard to explain, hard to cite, hard for the model to decide "should I ask again?"
2. **Wasted budget.** Every turn shoved selected knowledge chunks and semantic memory hits into the prompt regardless of whether this turn actually needed them.
3. **Source confusion.** Memory vitality, LLM Wiki corpus scores, and Knowledge BM25 + RRF were all forced into a single "context score" — putting numbers with different semantics on the same scale.
4. **No traceable evidence chain.** The UI could only say vaguely "knowledge loaded" — it could not attach specific sources, relevance values, or paragraphs to the answer.

The new design (Context Orchestrator + tool-based retrieval) fixes these:

| Old | New |
|---|---|
| Silently stitch chunks into the system prompt | Write a manifest listing sources and tools — no body |
| One-size-fits-all "context score" | Each source keeps its own `score_semantics` string and its own score |
| Model has no idea why it got this content | Model actively calls a tool; tool returns an evidence envelope with `source_refs` |
| Single-shot injection, take it or leave it | Model can search → open → expand → summarize iteratively |
| Risk of double-lifecycle (outer layer adds decay) | Strictly forbidden — **No Double Lifecycle Rule** |

## 3. Architecture overview

```text
┌────────────────────────────────────────────────────────────────┐
│ Local chat workflow (LocalOrchestrationEngine)                 │
│                                                                │
│   SummaryInjectionStep                                         │
│   PersonaPromptInjectionStep                                   │
│   ContextManifestStep  ← entry point of Context Orchestrator   │
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
│   Each round:                                                  │
│     ① call provider, get tool_calls                            │
│     ② if a context_* tool is hit → execute_context_tool(...)   │
│           │                                                    │
│           ▼                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ context_orchestrator/tools.rs                       │    │
│     │   - parse args                                      │    │
│     │   - dispatch by source_type                         │    │
│     │   - call source-native retrieval via adapter        │    │
│     │   - wrap as ContextEvidenceEnvelope                 │    │
│     └─────────────────────────────────────────────────────┘    │
│           │                                                    │
│     ③ write tool result back into orchestrated_messages,       │
│       continue next round                                      │
└────────────────────────────────────────────────────────────────┘
```

### Module tree

```
deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/
├── mod.rs        // module entry, re-exports
├── fsm.rs        // ContextOrchestrator, ContextManifest, prompt rendering
├── policy.rs     // ContextRoutingPolicy + No Double Lifecycle Rule
├── envelope.rs   // ContextEvidenceEnvelope, ContextEvidenceItem, etc.
├── tools.rs      // execute_context_tool, search/open/expand/summarize
├── trace.rs      // ContextTrace (FSM state trail)
├── tests.rs      // unit tests
└── adapters/
    ├── mod.rs        // ContextSourceAdapter trait
    ├── memory.rs     // Memory adapter (does NOT re-score)
    ├── llm_wiki.rs   // LLM Wiki adapter (does NOT re-score)
    └── knowledge.rs  // Knowledge adapter (does NOT re-score)
```

## 4. State machine (FSM)

`ContextOrchestrator` conceptually goes through these states:

```
BuildManifest
   → ClassifyNeed          // current impl is conservative: let the model decide
   → PlanSources           // ContextRoutingPolicy decides which sources participate
   → Retrieve              // call adapter → source-native retrieval
   → EvaluateCoverage      // tag with ContextCoverage (empty/sparse/focused/broad)
   → ExpandIfNeeded        // via explicit context_expand call from the model
   → CompressIfNeeded      // optional: context_summarize_evidence
   → EmitBundle            // emit envelope
   → RecordTrace
```

The enum lives at [`fsm.rs::ContextOrchestratorState`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs). The current implementation makes `ClassifyNeed` / `PlanSources` tool-call-driven — the runtime does not retrieve proactively; it writes available sources and tools into the manifest and lets the model decide when to call.

## 5. Three context sources and ownership

| Source | source_type | Retrieval owner | Score semantics (`score_semantics`) |
|---|---|---|---|
| Memory | `memory` | [`MemoryService::search`](../deeting/src-tauri/src/modules/memory/service.rs) | "memory.score is semantic relevance after MemoryService lifecycle/vitality/supersession handling" |
| LLM Wiki | `llm_wiki` | [`search_local_llm_wiki_corpus`](../deeting/src-tauri/src/modules/llm_wiki/service.rs) | "llm_wiki.score is corpus lexical and semantic relevance from llm_wiki search" |
| Knowledge | `knowledge` | [`KnowledgeStore`](../deeting/src-tauri/src/modules/knowledge/store.rs) (FTS5 BM25 + semantic + RRF) | "knowledge.score is evidence relevance from FTS/BM25, semantic search, chunk quality, and RRF fusion" |

Every source's algorithm **stays inside its own module**. The context layer only bridges via an adapter:

- Memory's lifecycle / vitality / supersession all live in [`retrieval_kernel/{lifecycle,write_guard,supersession}.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/). MemoryService calls them, and the adapter receives **already-reranked results**.
- LLM Wiki produces its own `lexical_score` / `semantic_score` / `final_score`; the envelope passes them through.
- Knowledge passes through `lexical_score`, `match_reasons`, `section_path`, `quality_flags`, `score_breakdown` from the store layer.

> **Important**: the three sources' `score` fields **are not on the same scale**. The frontend UI must always show `score_semantics` next to them and must not cross-source compare.

## 6. The No Double Lifecycle Rule (the most important rule)

The context layer is a **routing layer**, not a **scoring layer**. Allowed:

- Route: dispatch by source_type to the corresponding adapter
- Decide visibility: `ContextInjectionMode` — `CoreOnly` / `ManifestOnly` / `ManifestAndTools` / `ToolOnly`
- Tag coverage: `ContextCoverage` — `empty` / `sparse` / `focused` / `broad`
- Write trace: record routing actions and state inside the envelope

**Forbidden**:

- ❌ `score *= freshness`
- ❌ `score *= recency`
- ❌ `score *= vitality`
- ❌ `score *= trust`
- ❌ Re-implementing the write guard threshold
- ❌ Down-weighting because a document is "old"
- ❌ Normalizing different sources' scores into a unified trust scale

Why is this rule so hard? Because every source's lifecycle algorithm has already been carefully designed, tuned, and tested inside its home module. Adding another decay layer in the context layer means silent double-degradation — and **nobody will notice**: one commit can introduce it, one rollback cannot undo the data pollution it left behind.

The rule is materialized as:

1. Module-doc comment at the top of [`policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs)
2. Reminder comments at the top of each of the three adapter files
3. Unit test `routing_policy_preserves_source_scores` (asserts `route_envelope` does not rewrite scores)

## 7. Manifest vs body injection

Old path: shove retrieval **content** into the system prompt.
New path: shove only the **manifest**.

| Still auto-injected | Now explicit-tool only |
|---|---|
| session summary | regular semantic memory recall |
| persona prompt | LLM Wiki body / chunks |
| **core / boot memory** (only the core tier) | local knowledge chunks |
| **manifest metadata** of selected knowledge files | multi-doc evidence |
| list of available sources and context tools | evidence summary |

`ContextManifestStep` is the only injection entry in the workflow. It writes a section like this into the system prompt (see [`fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs)):

```text
## Context Manifest
Use this manifest to decide whether to call context tools. ...

### Core Memories
- Always respond in Simplified Chinese.

### Selected Knowledge Files
- roadmap.md (file_id: file-abc, status: indexed, chunks: 12)
- spec.md (file_id: file-def, status: indexed, chunks: 8)
Open or search selected knowledge through context tools before using document evidence.
To search inside these selected files, call `context_search` with `scope: "selected"` and `filters.selected_file_ids: ["file-abc", "file-def"]`. If `selected_file_ids` is omitted in selected scope, the runtime falls back to the files listed here.
To open a specific chunk, call `context_open` with `source_type: "knowledge"`, `file_id`, and optional `chunk_index`.

Available context sources: memory, llm_wiki, knowledge.
Available context tools: context_search, context_open, context_expand, context_summarize_evidence.
```

## 8. Context tools

Tools are registered into the runtime catalog via [`core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs). The chat_tool_runtime recognizes `is_context_tool(name)` in the agentic loop and routes to [`execute_context_tool`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs).

### context_search

```jsonc
{
  "source": "memory | llm_wiki | knowledge | auto",  // default: auto
  "query": "string",                                  // required
  "scope": "selected | all | folder | workspace | session",
  "limit": 6,
  "include_neighbors": false,
  "filters": {
    "selected_file_ids": ["file-abc"]                 // for knowledge scope=selected
  }
}
```

Behavior:

- `source: "auto"` → query all three sources in parallel, return three envelopes (no normalization)
- `source: "memory" | "llm_wiki" | "knowledge"` → query that one
- `scope: "selected"` + missing `filters.selected_file_ids` → auto-fallback to workflow-injected selected knowledge files (see §9)

### context_open

```jsonc
{
  "source_type": "memory | llm_wiki | knowledge",
  "id": "string",          // memory: memory id; knowledge: "fileId:chunkIndex"
  "file_id": "string",     // knowledge: can pass separately
  "chunk_index": 0,        // knowledge: can pass separately
  "window": 1              // neighbor expansion size
}
```

### context_expand

Same schema as `context_open`. Semantics: "widen the window." Current implementation reuses open's internals with a larger default `window`.

### context_summarize_evidence

Optional. Performs a **deterministic truncation** on envelopes the model has already retrieved — keeping `source_refs` and `score_semantics` while clipping content to a length limit. Does not call an LLM, does not auto-summarize, does not replace the answer.

> Design discipline: the summarize tool must not become a "hidden final-answer agent." Its only legitimate use is saving tokens.

## 9. Selected Knowledge Fallback

Originally driven by a concrete scenario:

> The user selected a few knowledge files in chat. The manifest wrote their file_ids into the system prompt. The model wanted to search inside these files but forgot to pass `filters.selected_file_ids` — it only sent `scope: "selected"`.

The old impl would filter with an empty array under that default and return zero hits. The new impl has **two safety nets**:

1. **Prompt teaching**: the manifest inline-lists specific file_ids and explicitly says "if omitted, the runtime falls back."
2. **Runtime backstop**: `search_knowledge` calls [`resolve_selected_file_ids`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) with this rule:

   ```
   IF filters.selected_file_ids non-empty   → use filter-provided ids (explicit wins)
   ELSE IF scope == "selected"              → use workflow-context ids
   ELSE                                     → empty array (no implicit scoping)
   ```

3. **Persistence wiring**: `selected_knowledge_file_ids` is threaded through [`LocalChatToolRuntimeState`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) → `PersistedChatToolRuntimeContext` → `SuspendedChatToolExecution`. Suspend / resume / recovery all preserve the fallback list (legacy persisted records degrade safely to empty via `#[serde(default)]`).

The trace records `used_context_fallback: true/false`, letting us tell whether the model actually used the backstop.

## 10. Evidence Envelope

Every context tool returns this uniform shape:

```rust
pub struct ContextEvidenceEnvelope {
    pub source_type: ContextSourceType,            // memory / llm_wiki / knowledge
    pub query: String,
    pub items: Vec<ContextEvidenceItem>,
    pub coverage: ContextCoverage,                 // empty / sparse / focused / broad
    pub score_semantics: String,                   // source-native score semantics
    pub recommended_next_action: ContextNextAction,// answer_with_evidence / search_again / open_source / ...
    pub trace: ContextTrace,
}

pub struct ContextEvidenceItem {
    pub id: String,
    pub source_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub score: f64,                       // source-native; cross-source compare is forbidden
    pub score_breakdown: serde_json::Value,
    pub source_refs: Vec<ContextSourceRef>,
    pub quality_flags: Vec<String>,
    pub lifecycle: Option<serde_json::Value>,
}
```

The tool wraps it with a format version:

```jsonc
{
  "format_version": "context_evidence.v1",
  "tool": "context_search",
  "source": "knowledge",
  "query": "...",
  "envelope": { /* ContextEvidenceEnvelope */ }
}
```

`auto` mode uses `envelopes: [...]` + `errors: [...]` instead.

## 11. Frontend integration

### Status events

When `ContextManifestStep` finishes it emits:

```
code: "context.manifest.loaded"
meta: {
  "core_memory_count": N,
  "selected_knowledge_count": M,
  "available_sources": ["memory", "llm_wiki", "knowledge"],
  "available_tools": ["context_search", "context_open", ...]
}
```

The frontend translates this code in [`lib/chat/status-detail.ts`](../deeting/lib/chat/status-detail.ts) for i18n display.

To preserve compatibility with persisted older conversations, the frontend **keeps** the read-side parser for `knowledge.context.loaded` (in [`chat-message-list.tsx`](../deeting/components/chat/messages/chat-message-list.tsx) and [`use-chat-messaging-service.ts`](../deeting/hooks/chat/use-chat-messaging-service.ts)) so historical messages still render correctly — but the runtime no longer emits it.

### Evidence card rendering

`status-rail.tsx` is currently a transitional progress indicator. Generalized envelope-based evidence cards (covering all three sources) are pending Step 6 in [`refactor plan`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md).

## 12. File map

By "what do I want to change":

| I want to… | Look here |
|---|---|
| Change the manifest prompt text | [`context_orchestrator/fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs) |
| Change source routing / injection_mode | [`context_orchestrator/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs) |
| Change a tool's implementation | [`context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) |
| Change envelope fields | [`context_orchestrator/envelope.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/envelope.rs) |
| Add a new context source | New `adapters/<name>.rs` + implement `ContextSourceAdapter` + add branch in [`tools.rs::search_source`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) |
| Change the Memory recall algorithm | **Not in the context layer.** Go to [`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs) or [`retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/) |
| Change Knowledge FTS / semantic retrieval | **Not in the context layer.** Go to [`knowledge/store.rs`](../deeting/src-tauri/src/modules/knowledge/store.rs) |
| Change LLM Wiki corpus search | **Not in the context layer.** Go to [`llm_wiki/service.rs`](../deeting/src-tauri/src/modules/llm_wiki/service.rs) |
| Change context tool registration / visibility | [`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) |
| Change tool dispatch in the agentic loop | [`chat_tool_runtime/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs), grep for `is_context_tool` |
| Change frontend status text | [`lib/chat/status-detail.ts`](../deeting/lib/chat/status-detail.ts) + [`messages/{zh-CN,en}/chat.json`](../deeting/messages/) |
| Change workflow step order | [`local_orchestrator/workflow.rs::build_desktop_local_chat_engine`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) |

## 13. How to extend

### Add a new context source (example: `scout` web snapshot)

1. Add `scout.rs` under [`adapters/`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/adapters/):

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

2. Add `Scout` variant to [`envelope.rs::ContextSourceType`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/envelope.rs); update `as_str`.
3. Add a policy entry in [`policy.rs::ContextRoutingPolicy::default`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/policy.rs) (usually `ManifestAndTools` or `ToolOnly`).
4. Add branches in [`tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) `search_source` / `parse_source_type` / `auto` list.
5. Implement `search_scout(app_state, query, limit) -> ContextEvidenceEnvelope` that **calls scout's native search** and maps hits to `ContextEvidenceItem`.
6. Write an adapter-invariance test: assert the envelope's `score` equals the scout module's returned value byte-for-byte.

### Add a new context tool (example: `context_pin`)

1. Add the name to [`fsm.rs::CONTEXT_TOOL_NAMES`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs).
2. Register input/output schema, example_arguments, permission_scope in [`core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs).
3. Add an arm in [`tools.rs::execute_context_tool`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs).
4. Decide whether to advertise it in the manifest (add a line in fsm.rs prompt).

### Change manifest behavior

Only edit [`fsm.rs::render_context_manifest_prompt`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/fsm.rs). Notes:

- Do not stuff chunk content here. If you want content, call a tool.
- Do not put ms-precision timestamps in the prompt — the model will fumble it. Use absolute dates or relative descriptions.
- After changes, sync [`tests.rs::manifest_renderer_*`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tests.rs).

## 14. Anti-patterns (reject in PR review)

- Any `*=` on `item.score` inside the context layer
- Hand-rolled freshness/recency/vitality formulas inside an adapter
- Re-injecting "chunk content" into the system prompt via `ContextManifestStep`
- Normalizing multiple sources' scores into a unified trust score
- Holding mutable global state inside `ContextOrchestrator` (the FSM is a stateless operator)
- Introducing an implicit "always call context_search first" pre-fetch (if you want to search, let the model search)
- Letting `context_summarize_evidence` call an LLM to "summarize before answering" — it must be deterministic truncation
- Making fallback "use ctx ids whenever filters.selected_file_ids is empty" (only fall back in selected scope, otherwise you contaminate all/auto)

## 15. Recorded decisions and origin plan

| Decision | Source |
|---|---|
| Hard switch, not long-term dual-track | [`.omx/plans/2026-05-16-context-orchestrator-refactor.md`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md) |
| Three sources, no unified score | Same plan — "Do not force all scores into one global trust scale" |
| selected_knowledge_file_ids: workflow → tool fallback | This refactor (2026-05-16) |
| Old `knowledge.context.loaded` kept for read-side compat only | Same |
| Memory lifecycle / write_guard / supersession stays in retrieval_kernel | [`retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/) |

## 16. Verification checklist

A PR that touches the RAG path must self-check the applicable items:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo check --tests`
- [ ] `cargo test --lib context_orchestrator --no-fail-fast`
- [ ] `cargo test --lib local_orchestrator --no-fail-fast`
- [ ] `cargo test --lib retrieval_kernel --no-fail-fast`
- [ ] `cargo test --lib memory --no-fail-fast`
- [ ] `cargo test --lib llm_wiki --no-fail-fast`
- [ ] `cargo test --lib knowledge --no-fail-fast`
- [ ] Frontend: `npm test -- hooks/chat/__tests__/use-chat-messaging-service.test.tsx --runInBand`
- [ ] Frontend: `npm test -- lib/chat --runInBand`
- [ ] Desktop manual test: new conversation → select knowledge files → ask → observe whether the model calls `context_search` / `context_open` → check status rail shows `context.manifest.loaded`

> Known Windows caveat: `cargo test` binaries sometimes fail to launch due to DLL load failures (STATUS_ENTRYPOINT_NOT_FOUND). Distinguish "compile failed" (must fix) from "run failed" (usually a host-env issue — rerun on CI/Linux).

## 17. FAQ

**Q: Why is core/boot memory still auto-injected?**
A: Core memory is "always-applicable persona + user preferences (like language, name)" — small in size, ~100% hit rate, query-independent. Tool-izing it would force every turn to call a tool — bad tradeoff. `ContextInjectionMode::CoreOnly` expresses this boundary.

**Q: Won't the model forget to use RAG now that content is not auto-injected?**
A: Risk exists. Mitigations: (1) the manifest prompt advertises available tools; (2) on empty / failed hits, the envelope's `recommended_next_action` guides the next step; (3) prompt variants can reinforce the cue if needed. Next step could be tool-call behavior tests ("when selected knowledge exists, first round must emit a context_* call").

**Q: Can we stack a "trust score" in the context layer to put more trustworthy sources first?**
A: No. Trust is cross-source comparison, which violates the No Double Lifecycle Rule. If product genuinely needs cross-source ranking, the correct place is the **presentation layer**, and `score_semantics` must be displayed alongside.

**Q: Can `context_summarize_evidence` become "summarize via LLM, then answer"?**
A: No. The moment it can enter the answer path, it becomes a hidden secondary agent and breaks traceability. Its only legitimate use is deterministic truncation of envelope content under token pressure while preserving source_refs.

**Q: What if we want to add a reranker (e.g. cross-encoder) later?**
A: Put it inside the source's own module (e.g. `knowledge/reranker.rs`) so `KnowledgeStore` returns reranked hits. The context layer passes them through. **Do not** write a reranker inside an adapter.

## 18. References

- Refactor origin plan: [`.omx/plans/2026-05-16-context-orchestrator-refactor.md`](../.omx/plans/2026-05-16-context-orchestrator-refactor.md)
- Retrieval Kernel module: [`deeting/src-tauri/src/modules/retrieval_kernel/`](../deeting/src-tauri/src/modules/retrieval_kernel/)
- Desktop runtime sovereignty charter (design philosophy): [`deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)
- Workflow engine: [`deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs)
