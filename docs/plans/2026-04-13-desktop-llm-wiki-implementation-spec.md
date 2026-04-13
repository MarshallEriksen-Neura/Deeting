# Desktop LLM Wiki Implementation Spec

**Lane:** `desktop local / llm wiki / managed corpus / custom task agent`

## Goal

Ship a productized desktop LLM Wiki surface that lets a user bind an existing Obsidian vault, create a managed workspace, maintain a dedicated LLM Wiki corpus, and delegate wiki work to a dedicated maintainer custom task agent.

This spec is intended to be the implementation handoff for the next execution pass.

## Current State

The repo already has a partial LLM Wiki implementation:

- standalone dashboard route: `/dashboard/llm-wiki`
- managed workspace bootstrap flow
- vault binding persistence
- dedicated `llm_wiki` backend module
- extracted shared retrieval/lifecycle kernel
- dedicated LLM Wiki corpus sync/state
- maintainer custom task agent creation/update
- visible corpus status card on the page

Current architectural intent is already defined in:

- [2026-04-13-desktop-llm-wiki-productization-design.md](/d:/20260302170616/Deeting/docs/plans/2026-04-13-desktop-llm-wiki-productization-design.md)
- [2026-04-13-desktop-llm-wiki-layered-architecture.md](/d:/20260302170616/Deeting/docs/plans/2026-04-13-desktop-llm-wiki-layered-architecture.md)

## Hard Architecture Rules

These are not optional during implementation.

1. LLM Wiki must remain a **dedicated corpus**, not a child of the main knowledge product surface.
2. Main runtime must **not** read this corpus by default.
3. Main runtime may only reach this system through **explicit delegation**.
4. The wiki maintainer custom task agent is the **write owner** for managed markdown maintenance.
5. Shared retrieval pieces like embedding, BM25/RRF, and lifecycle must be reused from the extracted kernel, not copied again.
6. Default read scope is whole vault; default write scope is managed workspace only.

## In Scope

This next implementation pass should finish the following:

### 1. Corpus Search Exposure

Complete the dedicated LLM Wiki corpus search path:

- expose `search_local_llm_wiki_corpus_command`
- finish frontend API binding
- allow page-level search queries and result inspection

### 2. Corpus Inspector Panel

Turn the current corpus card into a real live inspector:

- search input
- search action
- result list
- selected result detail
- clear visual separation from generic dashboard stats

The panel should explicitly communicate:

- this is the corpus the maintainer agent uses
- this is not the main assistant's default retrieval context

### 3. Maintainer Agent Corpus Access

Finish the maintainer agent integration:

- dedicated `llm_wiki_search_corpus` callable should be available only for LLM Wiki maintainer agents
- maintainers should be able to call it in their delegated execution loop
- the system prompt should explain the existence and intended use of this callable

### 4. Maintainer Context Injection

For `source_kind = llm_wiki_maintainer`:

- add a small, bounded corpus preview into the initial system context
- do not overload the context
- keep it as read-only evidence

This is not main runtime retrieval injection. It is maintainer-agent-local context only.

### 5. Product Surface Polish

Use the existing iOS-style glass visual language and tighten the page around a 3-stage journey:

- connect vault
- bootstrap workspace and sync corpus
- inspect corpus and hand off to maintainer

Do not redesign the whole dashboard shell.

## Out of Scope

Do not implement these in this pass:

- hooks / event-driven automation
- automatic crystallization on session end
- automatic ingest on new source arrival
- user memory promotion rules
- supersession engine
- contradiction resolution engine
- typed knowledge graph
- direct integration into main runtime default retrieval
- migration of this corpus into main knowledge UI
- deep Obsidian plugin integration

## Existing Reusable Modules

### Frontend

- route shell: [page.tsx](/d:/20260302170616/Deeting/deeting/app/[locale]/dashboard/llm-wiki/page.tsx)
- page state: [use-llm-wiki.ts](/d:/20260302170616/Deeting/deeting/app/[locale]/dashboard/llm-wiki/components/use-llm-wiki.ts)
- corpus card: [llm-wiki-corpus-card.tsx](/d:/20260302170616/Deeting/deeting/app/[locale]/dashboard/llm-wiki/components/llm-wiki-corpus-card.tsx)
- agent card: [llm-wiki-agent-card.tsx](/d:/20260302170616/Deeting/deeting/app/[locale]/dashboard/llm-wiki/components/llm-wiki-agent-card.tsx)
- API client: [llm-wiki.ts](/d:/20260302170616/Deeting/deeting/lib/api/llm-wiki.ts)

### Backend

- module shell: [mod.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/mod.rs)
- commands: [commands.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/commands.rs)
- service: [service.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/service.rs)
- corpus sync/search: [corpus.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/corpus.rs)
- config keys: [config.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/config.rs)
- types: [types.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/llm_wiki/types.rs)

### Shared Retrieval Kernel

- ranking: [ranking.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/retrieval_kernel/ranking.rs)
- lifecycle: [lifecycle.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs)

### Custom Task Agents

- runtime loop: [runtime.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/custom_task_agents/runtime.rs)
- bound callables: [bound_callables.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs)
- service: [service.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/custom_task_agents/service.rs)
- commands: [commands.rs](/d:/20260302170616/Deeting/deeting/src-tauri/src/modules/custom_task_agents/commands.rs)

## Implementation Tasks

### Task 1. Finish Backend Corpus Search Contract

Ensure the following are complete and wired end-to-end:

- `SearchLocalLlmWikiCorpusRequest`
- `LocalLlmWikiCorpusSearchHit`
- `SearchLocalLlmWikiCorpusResult`
- `search_local_llm_wiki_corpus(...)` in `llm_wiki/service.rs`
- `search_local_llm_wiki_corpus_command(...)` in `llm_wiki/commands.rs`
- command registration in `src/commands.rs`

Acceptance:

- frontend can issue a corpus query and receive typed hits
- search remains scoped to LLM Wiki corpus assets only

### Task 2. Finish Frontend Corpus Search Flow

Extend `use-llm-wiki.ts` and `llm-wiki.ts` so the page can:

- hold search query state
- run corpus search
- store result list
- store selected result
- show loading and failure states cleanly

Acceptance:

- querying from the page updates the inspector without a full page refresh
- empty, loading, and no-result states are distinct

### Task 3. Turn Corpus Card into Live Inspector

Refine `llm-wiki-corpus-card.tsx` into a live preview surface:

- left: search + result list
- right: selected result detail
- preserve the current corpus sync CTA
- keep the visual style aligned with the existing glass/iOS direction

Acceptance:

- user can type a query
- user can see 3-6 corpus hits
- user can inspect one selected hit
- UI clearly communicates that this is maintainer-only corpus context

### Task 4. Finish Maintainer Runtime Corpus Access

In `custom_task_agents/runtime.rs` and `bound_callables.rs`:

- ensure builtin callable lane is supported
- expose `llm_wiki_search_corpus` only to LLM Wiki maintainer agents
- execute it via the backend corpus search service

Acceptance:

- maintainer agents can call corpus search during delegated execution
- non-maintainer agents do not automatically receive this callable

### Task 5. Add Maintainer-Specific Corpus Context

Add a small initial corpus preview to `build_initial_messages(...)` for LLM Wiki maintainers:

- only for `source_kind = llm_wiki_maintainer`
- use a few top search results or summary lines
- keep token footprint bounded

Acceptance:

- maintainer gets immediate local corpus awareness
- regular custom task agents do not get this behavior

## UI Guidance

Keep the page productized, not admin-heavy.

Required qualities:

- should feel like a premium desktop utility
- should feel trustworthy and bounded
- should emphasize visibility and control over hidden automation

Prefer:

- glass panels
- softened gradients
- rounded, tactile controls
- explicit stage progression
- short labels and trust-building copy

Avoid:

- raw debug-console aesthetics
- giant config forms
- generic table-heavy admin feel

## Testing and Verification

Minimum verification for this pass:

- targeted frontend lint for touched LLM Wiki page files
- targeted frontend tests if the touched surface already has a good seam
- `cargo fmt`
- focused Rust compile check only if the current repo blockers permit it

Known repo reality:

- Rust-wide verification may still be blocked by unrelated LanceDB / memory-store issues
- do not misreport those as LLM Wiki feature regressions

## Completion Criteria

This pass is complete when:

1. page can search corpus and show inspector results
2. maintainer agent can directly access corpus search through its own callable lane
3. maintainer-specific initial context includes bounded corpus evidence
4. no main assistant default retrieval path is widened
5. no main knowledge surface coupling is introduced

## Follow-up Phase

Only after this pass is complete should the next phase begin:

- hook/trigger layer
- visible automation UX
- crystallization suggestions
- scheduled lint suggestions

That phase must remain delegation-first, not hidden-autonomy-first.

## Follow-up Hooks Spec

The next phase should explicitly split automation into two layers.

### Layer 1: Helpful Event-Driven Triggers

This layer is the "good to use" phase.

These hooks should favor:

- visibility
- suggested actions
- bounded automation
- low-risk state refresh

The expected hooks are:

#### `on vault bound`

Behavior:

- automatically prompt or trigger the first corpus sync

Expected outcome:

- the user does not need to discover corpus sync manually after binding

#### `on workspace bootstrapped`

Behavior:

- automatically suggest creating the maintainer agent

Expected outcome:

- the user moves naturally from scaffold creation into delegated ownership

#### `on corpus sync completed`

Behavior:

- automatically refresh corpus health and preview results

Expected outcome:

- the inspector stays live without requiring a second manual refresh step

#### `on session end`

Behavior:

- generate a crystallization candidate

Expected outcome:

- useful work done in chat can be proposed for wiki maintenance without silently writing it back

#### `on schedule`

Behavior:

- trigger lint suggestions
- trigger stale checks
- trigger corpus refresh suggestions

Expected outcome:

- the LLM Wiki stays maintainable and visible without surprise edits

### Layer 2: Stronger Automation Loop

This layer should only start after Layer 1 is stable.

These hooks are more powerful and require stronger review and product controls.

The expected hooks are:

#### `on new source`

Behavior:

- automatically ingest the source into the dedicated corpus
- then trigger ingest delegation to the maintainer agent

Expected outcome:

- source arrival shortens the path to maintained wiki updates

#### `on valuable answer`

Behavior:

- automatically form a wiki update candidate

Expected outcome:

- high-value answers stop disappearing into chat history

#### `on maintenance schedule`

Behavior:

- automatically delegate lint
- automatically delegate repair
- automatically delegate supersession review

Expected outcome:

- the wiki becomes self-maintaining in a bounded, agent-owned way

#### `on repeated stable conclusion`

Behavior:

- promote the conclusion into user memory

Expected outcome:

- only repeated, stable, higher-confidence knowledge enters long-term memory

## Hook Guardrails

All future hooks must preserve the current architecture boundaries:

1. Hooks may trigger delegation, but they must not silently widen main runtime default retrieval.
2. Hooks may update the managed workspace, but they must not silently rewrite unrelated vault notes.
3. Hooks may promote to user memory only after stronger confidence and repetition signals.
4. Hooks must remain visible to the user through status, suggestions, or audit surfaces.
5. Hooks must preserve the dedicated-corpus ownership model instead of collapsing LLM Wiki into the main knowledge surface.
