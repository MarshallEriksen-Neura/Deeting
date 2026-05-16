# Deeting Memory System Architecture

> Scope: desktop long-term memory, automatic fact extraction, write gate, lifecycle decay, conversation-level replay.
> Out of scope: context orchestration ([rag-architecture.en.md](./rag-architecture.en.md)); self-evolution ([self-evolution-architecture.en.md](./self-evolution-architecture.en.md)); security policy ([security-architecture.en.md](./security-architecture.en.md)).

This document is the authoritative spec for Deeting's desktop "memory system." The goal mirrors the sibling docs: anyone reviewing, maintaining, or learning should be able to read this single file and understand:

- The design motivation (why not "vector DB + direct write")
- The system topology (who writes, who reads, who filters, who decays)
- The system boundary (what is allowed, what is forbidden)
- Where to add things, where to change things

## 1. TL;DR

Deeting desktop "memory" is not a single vector store. It is a **multi-source, lifecycle-managed, write-controlled** local storage:

- Writes pass through the **Write Guard** (three actions: Add / Update / Noop). Duplicate or near-duplicate entries cannot silently enter the store.
- When the same fact appears at multiple times, the **Supersession** module recognizes "new value supersedes old" semantics (e.g. "I now use GPT-5" supersedes "Last year I used GPT-4") and marks the old memory as `superseded` instead of letting them coexist.
- Retrieval applies a **different decay curve per memory category**: identity/preference memories have a 120-day half-life, Wiki conclusions 90 days, current facts 14 days, session episodic 7 days, general 30 days.
- Each memory has a **vitality** (0-1). When hit by retrieval, vitality `+= 0.08`, capped at 1.0. More-used memories stay sturdier.
- The **Fact Extractor** runs LLM + heuristic at conversation end to extract "long-term useful user facts" (max 5), writing them through the Write Guard.
- Every write/update/delete is recorded in the **Snapshot Store** for audit and rollback.

Core code:

```
deeting/src-tauri/src/modules/
├── memory/
│   ├── mod.rs
│   ├── types.rs              // LocalMemoryItem / WriteGuardResult / query types
│   ├── service.rs            // MemoryService — append / search / list / etc.
│   ├── store.rs              // SQLite + vector retrieval bottom layer
│   ├── snapshot_store.rs     // write audit / rollback source
│   ├── fact_extractor.rs     // conversation → long-term facts
│   ├── backfill.rs           // historical backfill / migration
│   ├── migration.rs          // schema evolution
│   ├── commands.rs           // Tauri commands
│   └── error.rs
└── retrieval_kernel/
    ├── mod.rs
    ├── lifecycle.rs          // 6 decay profiles + vitality math
    ├── write_guard.rs        // three actions + three profiles (manual/auto-fact/wiki)
    ├── supersession.rs       // claim parsing + temporal scope judgment
    └── ranking.rs            // shared BM25 + RRF algorithms
```

## 2. Why this way

A naive "vector store + automatic write" has several problems:

1. **Garbage accumulation.** LLMs love to treat "what was said in conversation" as "valuable facts." Within days the store fills with near-duplicate entries, and retrieval quality collapses.
2. **Conflicting coexistence.** "I use GPT-4" and "I use GPT-5" both exist; retrieval returns both; the model gets confused about which is the current truth.
3. **Permanent suppression.** Old preferences never decay → "I prefer React 16" said a year ago still sits at the top of retrieval today.
4. **No audit.** AI silently updated a user's "user profile" memory; the user doesn't know, can't roll it back.
5. **Write algorithm tangled with read algorithm.** One formula judges "is this a duplicate" AND scores "how important is it on retrieval"; next time someone wants to change one, they break the other.

Deeting separates these concerns:

| Naive pitfall | Deeting's approach |
|---|---|
| No write defense | Write Guard with three actions (Add / Update / Noop) + three profile-specific thresholds |
| Conflicting coexistence | Supersession marks old entries `lifecycle.claim_state=superseded`, rank ×0.35 |
| Old preferences forever | 6 decay profiles, each with independent half-life + floor |
| Auto-writes without audit | Snapshot Store retains old/new content copies for rollback |
| Write/read algorithms tangled | Write Guard decides "can it enter the store"; Lifecycle decides "how to score on retrieval"; they share no formulas |
| Global vitality decay | Vitality only `+= 0.08` on retrieval hit (capped at 1.0), never auto-decays. Frequently-used memories stay sturdy naturally |

## 3. Architecture overview

```text
┌────────────────────────────────────────────────────────────────┐
│ Write path                                                     │
│                                                                │
│   External entries:                                            │
│     - User manual add (commands.rs)                            │
│     - Fact Extractor (auto at conversation end)                │
│     - LLM Wiki promotion (durable conclusions from wiki)       │
│   ↓                                                            │
│   MemoryService::append_guarded(profile, request)              │
│     ① embed query vector                                       │
│     ② store.search_memories_for_write_guard(...)               │
│     ③ Supersession::find_supersession_target                   │
│        └→ hit: mark old as superseded + take Update branch     │
│     ④ Write Guard decision (Add / Update / Noop)               │
│     ⑤ store.insert / store.update (writes snapshot)            │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ Read path                                                      │
│                                                                │
│   MemoryService::search(query)                                 │
│     ① embed query → vector                                     │
│     ② store.search_memories(over-fetch × 3)                    │
│     ③ for each hit:                                            │
│        rerank_score = raw_similarity                           │
│                     × memory_recency_multiplier(profile)        │
│                     × supersession_rank_multiplier              │
│        on hit: vitality += 0.08 (cap 1.0)                       │
│     ④ Top-K return                                             │
└────────────────────────────────────────────────────────────────┘
```

## 4. Data skeleton

### 4.1 `LocalMemoryItem`

Defined in [`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs):

```rust
pub struct LocalMemoryItem {
    pub id: String,
    pub content: String,
    pub session_id: Option<String>,        // associated session (None = cross-session long-term)
    pub capability_id: Option<String>,
    pub meta_info: Option<Value>,          // metadata — lifecycle / extraction / pinned …
    pub embedding_model: Option<String>,   // embedding model name (critical for migration)
    pub category: Option<String>,          // identity / preference / fact / llm_wiki / ...
    pub source: Option<String>,            // manual / auto_extraction / llm_wiki / ...
    pub tags: Option<Vec<String>>,
    pub vitality: Option<f32>,             // 0..=1, += 0.08 on hit
    pub last_accessed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

### 4.2 Category × Source: decides the decay profile

`category` and `source` are not decorative — they directly determine **which decay curve a memory gets at retrieval time**. The rules in [`lifecycle.rs::classify_memory_decay_profile`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs):

| Profile | Trigger | Half-life | Floor |
|---|---|---|---|
| `Protected` | `meta.pinned == true` or `manual_override` | no decay (constant 1.0) | — |
| `DurableWikiConclusion` | `category` / `source` contains `llm_wiki` | 90 days | 0.55 |
| `StablePreference` | `category` contains `identity` / `persona` / `profile` / `preference` | 120 days | 0.60 |
| `CurrentFact` | `category == "fact"` or `source` contains `auto_extract*` / `fact` | **14 days** | 0.20 |
| `SessionEpisodic` | has `session_id` (and not in any of above) | **7 days** | 0.10 |
| `General` | fallback | 30 days | 0.25 |

**Why 6 profiles instead of one unified formula?**

Because different memories **should be forgotten at fundamentally different speeds**:
- "User prefers concise answers" (preference) is stable for months → 120-day half-life
- "User is debugging X bug today" (current fact) expires tomorrow → 14 days
- "User said 'hi' in session-1" (session episodic) should fade within a week → 7 days

A single formula forces "preferences" and "throwaway chatter" to decay at the same speed — **both get wrong**.

### 4.3 Vitality

Vitality is a 0-1 float:

- On retrieval hit, [`touched_vitality`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) adds `0.08` (`DEFAULT_VITALITY_TOUCH_INCREMENT`), capped at 1.0.
- At retrieval time, vitality multiplies into `recency_multiplier`: high-vitality old memories resist decay better than low-vitality old ones.
- **No active decay.** Deeting does not run a background GC to slowly subtract vitality — the decay curve's **floor** already expresses "a memory not used for a long time has limited weight, but still exists."

> Design tradeoff: vitality measures "how useful is this memory," not "how new." Newness comes from timestamps + profile half-life; usefulness comes from actual user hits = automatic evidence.

## 5. Write Guard

[`retrieval_kernel/write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs) is the core defense on the write path.

### 5.1 Three actions

```rust
pub(crate) enum WriteGuardCoreAction {
    Add,         // new knowledge — store directly
    Update,      // evolution — update/merge an existing item
    Noop,        // high duplication — silently discard
    Ambiguous,   // unclear — caller decides (usually falls back to Add with warn)
}
```

The simplified version exposed upward (drops Ambiguous) is at [`memory/types.rs::WriteAction`](../deeting/src-tauri/src/modules/memory/types.rs).

### 5.2 Three profiles (different write entries, different strictness)

```rust
pub(crate) enum WriteGuardProfile {
    ManualMemory,        // user manual add (conservative, rarely drops)
    AutoExtractedFact,   // Fact Extractor (strict, easily Noop)
    WikiPromotion,       // Wiki conclusion promoted to long-term memory (medium)
}
```

Each profile has independent thresholds in `policy_for_profile`:

| Profile | base_update | base_noop | min_gap | max_ratio | protected_noop |
|---|---|---|---|---|---|
| ManualMemory | 0.92 | 0.985 | 0.04 | 0.975 | 0.995 |
| AutoExtractedFact | 0.86 | 0.96 | 0.03 | 0.98 | 0.99 |
| WikiPromotion | 0.89 | 0.978 | 0.03 | 0.98 | — |

**Intuition**:
- Manual add (ManualMemory) is lenient (base_update=0.92) — only similarity ≥ 0.985 counts as duplicate Noop.
- Auto extraction (AutoExtractedFact) is strict (base_update=0.86, base_noop=0.96) — LLMs tend to extract near-duplicate facts; the gate clamps down.
- `protected_noop_threshold` is "if the existing memory is pinned / high-importance, require higher similarity to overwrite" — protects existing important memories.

### 5.3 Dynamic thresholds

Top of [`write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs):

```rust
const DYNAMIC_THRESHOLD_MAX_BOOST: f32 = 0.04;
const DYNAMIC_THRESHOLD_TOP2_FLOOR: f32 = 0.70;
const DYNAMIC_THRESHOLD_RATIO_BASELINE: f32 = 0.85;
const IMPORTANCE_PROTECT_THRESHOLD: f32 = 0.75;
```

Meaning:
- When top-1 and top-2 are similarly close (`score_ratio` high), the search result is "ambiguous" — **raise** the threshold temporarily and prefer Add over a possibly-wrong Update.
- When top-1 is an important memory (`importance >= 0.75`), raise the noop threshold to prevent "thinking it's an update" when it's actually "an unrelated hit replacing important content."

### 5.4 Decision detail

```rust
pub(crate) struct WriteGuardDecisionDetail {
    pub action: WriteGuardCoreAction,
    pub reason: String,                          // human-readable reason
    pub top1_score: Option<f32>,                 // best hit score
    pub top2_score: Option<f32>,                 // second-best (for score_gap)
    pub score_gap: Option<f32>,                  // top1 - top2
    pub score_ratio: Option<f32>,                // top2 / top1 (higher = more ambiguous)
    pub effective_update_threshold: f32,         // actual threshold used this time
    pub effective_noop_threshold: f32,
    pub protected_existing: bool,                // important-memory protection triggered?
    pub selected_existing_id: Option<String>,    // Update target id (if any)
}
```

These fields surface in `WriteGuardResult` to the caller, so the **UI can show** "this memory was not added because score=0.97 triggered Noop" — explainable, debuggable.

## 6. Supersession

[`retrieval_kernel/supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) solves "same fact, new value beats old."

### 6.1 When it applies

Only `AutoExtractedFact` and `WikiPromotion` go through Supersession — `ManualMemory` is never auto-superseded (user wrote it themselves; don't let AI replace it).

### 6.2 Mechanism

```text
new_claim = parse_claim(new_content)     // "subject + predicate + value + temporal_scope"
for candidate in nearby_candidates:
    if candidate already superseded:                     → skip
    if candidate.exact_score < min_score (0.74 / 0.80):  → skip
    old_claim = parse_claim(candidate.content)
    if claim_key differs:                                → skip (not the same claim)
    if values equivalent:                                → skip (not a conflict, just a duplicate)
    if temporal_dominance(new, old) does not hold:       → skip
    return SupersessionDecision { target_memory_id, claim_key, reason }
```

`claim_key` is `subject + predicate` — the same assertion about the same subject.
`TemporalScope` has three variants: `Current` / `Historical` / `Unknown`, determining whether the new claim dominates.

### 6.3 Consequences of supersession

Old memory is **not deleted** — it's marked with `meta.lifecycle.claim_state = "superseded"`:

- At retrieval, [`supersession_rank_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) multiplies its score by 0.35 (`SUPERSEDED_RANK_MULTIPLIER`). It won't surface, but can still be looked back at (historical traceback).
- The new memory's metadata stores `superseded_memory_id` + `claim_key` as a back-reference.

> Why not just delete? Because "undo supersession" needs the old entry around. Same philosophy as `apply_task_policy_delta`: observable, rollbackable > clean and simple.

## 7. Fact Extractor

[`memory/fact_extractor.rs`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) runs at conversation end (or explicit trigger):

```text
input: conversation history (truncated to length limit)

step 1: ask LLM with a predefined prompt to extract "long-term user facts"
        prompt constraints:
        - only user preferences / identity / long-term needs
        - no opinions about general topics
        - no transient info (current task details, temp state)
        - max 5 facts

step 2: parse output
        - JSON array? → take facts
        - no?         → heuristic_fallback extraction
        - heuristic also fails? → skip this round (do not pollute store)

step 3: for each fact:
        CreateLocalMemoryRequest {
            content: fact text,
            source: "auto_extraction",
            category: inferred (fact / preference / identity / ...),
            meta_info: {
                auto_extraction: { ... },
                extraction_mode: "model" | "heuristic_fallback"
            }
        }
        call MemoryService::append_guarded(AutoExtractedFact, request)
        accumulate add / update / noop / failed counts
```

**Discipline**:
- Fact Extractor is the **only** entry that uses the `AutoExtractedFact` profile. Other auto-writes (e.g. Wiki promotion) must use their own profile; do not share.
- On extraction failure, **do not write**. Better no fact than wrong facts.
- Every fact passes through Write Guard and Supersession — the LLM cannot bypass the gate.
- Every meta_info marks `extraction_mode` so audits can tell model output from fallback output.

## 8. Snapshot Store (audit / rollback)

[`memory/snapshot_store.rs`](../deeting/src-tauri/src/modules/memory/snapshot_store.rs) keeps a **before-and-after copy** for every write/update/delete:

```rust
pub struct MemorySnapshot {
    pub id: String,
    pub memory_id: String,
    pub action: String,            // create / update / delete / supersede
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub old_metadata: Option<String>,
    pub new_metadata: Option<String>,
    pub created_at: String,
}
```

Used for:
- **Audit**: the UI can show "this memory was added by which source (manual / auto_extraction / llm_wiki) at what time."
- **Rollback**: the UI can trigger "undo the last auto-extraction" — restore from snapshot's old/new.
- **Debug**: when tuning write thresholds, you can offline-replay historical snapshots to see how different thresholds would change decisions (write_guard is an idempotent function).

## 9. Lifecycle math in detail

[`lifecycle.rs::exponential_half_life_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs):

```rust
fn exponential_half_life_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
    floor: f32,
    half_life_days: f32,
) -> f32 {
    let vitality = vitality.unwrap_or(1.0).clamp(0.0, 1.0);
    let days_since = parse_days_since(reference_timestamp, now);
    let decay = (-LN_2 * days_since / half_life_days.max(0.5)).exp();
    (floor + (1.0 - floor) * vitality * decay).clamp(floor, 1.0)
}
```

Intuitive read:

- `decay = 0.5^(days_since / half_life_days)` — every half-life halves the decay.
- `(1 - floor) * vitality * decay` — age + vitality together shape the decay.
- `+ floor` — the multiplier always preserves at least `floor` (a minimum retrieval-visible baseline).
- `.clamp(floor, 1.0)` — two-way clamp, no float drift under/over the limits.

**Floor meaning**: even a "user preference" untouched for a year still scores 0.60 on recall; a year-old "session chitchat" only scores 0.10. The former remains visible; the latter is essentially silenced.

**LLM Wiki specialness**: besides exponential decay, [`wiki_freshness_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) offers a **power-law freshness curve** — more "gentle" than exponential, because knowledge conclusions age better than personal memories.

## 10. Memory Service public API

Entry at [`memory/service.rs::MemoryService`](../deeting/src-tauri/src/modules/memory/service.rs). Main methods:

| Method | Use |
|---|---|
| `append(request)` | **Direct write, bypasses Write Guard** (rarely used, only migration / tests) |
| `append_guarded(profile, request)` | Recommended entry; goes through Write Guard |
| `append_guarded_scoped(profile, request, scope)` | Same, but limits the search scope (e.g. session-only) |
| `search(query)` | Embed query → vector retrieval → vitality rerank |
| `search_with_query_vector(query, vec)` | Same but caller already embedded |
| `list(query)` | Paginated list (filter by session / capability) |
| `delete(id)` | Delete one (writes snapshot) |
| `update(id, request)` | Explicit update (writes snapshot) |
| `clear(payload)` | Batch clear by scope (writes snapshot) |
| `list_snapshots(memory_id)` | Pull history snapshots for one memory |

**Caller discipline**:

- **Always use `append_guarded`**. Do not call `append` directly unless you can explain why this write should bypass the gate.
- `append_guarded` returns `WriteGuardResult`: caller should reflect the `action` to UI (Add → show new entry, Update → show merged, Noop → show "similar memory already exists").
- Embeddings come from [`EmbeddingService`](../deeting/src-tauri/src/modules/providers/embedding.rs) — reuse within a session; do not re-embed the same query on every write.

## 11. Frontend integration

Tauri commands in [`memory/commands.rs`](../deeting/src-tauri/src/modules/memory/commands.rs):

- `local_memory_create`
- `local_memory_search`
- `local_memory_list`
- `local_memory_update`
- `local_memory_delete`
- `local_memory_clear`
- `local_memory_snapshots`

Frontend pages in [`app/[locale]/memory/`](../deeting/app/[locale]/memory/). Memory cards render vitality bars, decay state, and source badges directly from `LocalMemoryItem` fields.

**Frontend discipline**:
- Do not "merge by similarity" again on the frontend — the Write Guard already did that on the backend; merging again is double-filtering.
- `vitality` is a display aid, not a sort key — the backend's `search` already vitality-reranks; render in the returned order.

## 12. File map

By "what do I want to change":

| I want to… | Look here |
|---|---|
| Add a memory field (a column) | [`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs) + [`memory/store.rs`](../deeting/src-tauri/src/modules/memory/store.rs) + [`memory/migration.rs`](../deeting/src-tauri/src/modules/memory/migration.rs) |
| Change decay half-life / floor | [`retrieval_kernel/lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) top-of-file `MEMORY_PROFILE_*` constants |
| Add a new decay profile | Same file + `MemoryDecayProfile` enum + `classify_memory_decay_profile` + `memory_recency_multiplier` |
| Change vitality increment | [`lifecycle.rs::DEFAULT_VITALITY_TOUCH_INCREMENT`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) |
| Change Write Guard thresholds | [`write_guard.rs::policy_for_profile`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs) |
| Add a Write Guard profile | Same file + `WriteGuardProfile` enum + call sites |
| Change Supersession judgment | [`supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) |
| Change Fact Extractor rules | [`memory/fact_extractor.rs::FACT_EXTRACTION_PROMPT_TEMPLATE`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) |
| Change heuristic fallback | [`fact_extractor.rs::heuristic_extract_facts_from_conversation`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) |
| Add a new write entry | Create a new call site that calls `append_guarded(profile, request)`; do not call `append` directly |
| Change the frontend rendering | [`app/[locale]/memory/components/memory-card.tsx`](../deeting/app/[locale]/memory/components/memory-card.tsx) |

## 13. How to extend

### 13.1 Add a new decay profile (example: `ResearchNote`)

> Scenario: you want "research note memories" to decay more slowly, because they're often long-lived but don't qualify as wiki.

1. In [`lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs):
   ```rust
   const MEMORY_PROFILE_RESEARCH_NOTE_HALF_LIFE_DAYS: f32 = 60.0;
   const MEMORY_PROFILE_RESEARCH_NOTE_FLOOR: f32 = 0.40;
   ```
2. Add `MemoryDecayProfile::ResearchNote` variant.
3. Add a branch in `classify_memory_decay_profile`: check `category` contains `research_note` or `meta.research_marker == true`.
4. Add a branch in `memory_recency_multiplier` calling `exponential_half_life_multiplier`.
5. Add a test: construct a same-timestamp research note and a session episodic, assert research_note multiplier > episodic.

### 13.2 Add a new write entry (example: import from IM sync)

1. Create a call site (e.g. `im/sync.rs`).
2. Pick a `WriteGuardProfile`:
   - User chat in IM → `AutoExtractedFact`
   - Bot-recommended Wiki conclusion → `WikiPromotion`
   - Manual bulk import → `ManualMemory`
3. Build `CreateLocalMemoryRequest`, call `MemoryService::append_guarded(profile, request)`.
4. **Do not** add a new `WriteGuardProfile` variant unless this entry truly needs independent thresholds. Reusing existing profiles is the default.
5. Integration test: simulate an IM import; assert duplicate content gets Noop'd.

### 13.3 Change Fact Extractor prompt

Only edit [`fact_extractor.rs::FACT_EXTRACTION_PROMPT_TEMPLATE`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs). Notes:

- Must emphasize "user-specific facts," not conversation summarization.
- Must enforce "max N facts" — unbounded leads to over-extraction.
- Output must be a JSON array (else parsing fails → fallback heuristic).
- After changes, replay historical conversations to check that extraction quantity and quality don't drift.

## 14. Anti-patterns (reject in PR review)

- Calling `MemoryService::append` directly (bypassing Write Guard)
- Writing a "seems more accurate" similarity judgment to replace the Write Guard
- Implementing decay formulas outside `lifecycle.rs`
- Using vitality for anything other than rerank weight (e.g. display sort key, importance score)
- Stuffing raw text into the store when Fact Extractor fails to parse JSON
- Deleting memory without writing a Snapshot
- Changing `SUPERSEDED_RANK_MULTIPLIER` to 0.0 (effectively hiding old memory → loses traceability)
- Running `ManualMemory` through Supersession (auto-AI must not overwrite user-written content)
- Adding a background "active decay" task to vitality (violates "floor already expresses decay")
- Mixing `auto_extraction` source into the `manual_memory` profile (bypasses strict thresholds)

## 15. Recorded decisions and tradeoffs

| Decision | Why |
|---|---|
| Write and read algorithms fully separated | Changing one doesn't break the other; each is testable, each threshold is tunable independently |
| 6 decay profiles instead of one unified formula | Different memory categories need different forget speeds; one formula always miscalibrates some category |
| No 21-day-ish half-life | Task learning uses 21 days ([self-evolution](./self-evolution-architecture.en.md)); memories use 7–120 days by tier |
| Vitality only adds, never subtracts | Active decay needs background tasks + retention windows; the floor already expresses "long-unused = weakened" — no need to reinvent |
| Supersession marks instead of deletes | History traceability + rollback > clean simplicity |
| Write Guard uses three profiles, not dynamic params | Each entry's semantics is stable (manual / auto / wiki); dynamic params would make thresholds unreviewable |
| Fact Extractor skips on failure | Cost of polluting store with wrong facts > cost of no facts |
| Snapshot keeps full old + new | Per-memory snapshot count stays bounded; trading this storage for rollback is a great deal |

## 16. Verification checklist

PRs touching the memory system must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib memory --no-fail-fast`
- [ ] `cargo test --lib retrieval_kernel --no-fail-fast`
- [ ] Key invariant tests still green:
  - `write_guard_decision_uses_shared_thresholds`
  - `memory_recency_prefers_stable_profiles_over_session_ephemera`
  - `memory_recency_protects_pinned_items_from_time_decay`
  - `wiki_freshness_is_gentler_than_memory_decay_for_old_entries`
  - `touched_vitality_increments_and_caps`
- [ ] Desktop manual test:
  - Manually add the same content twice → second time should Noop with a UI explanation
  - Run Fact Extractor over two consecutive conversations → duplicate facts the second time should Update or Noop, not Add
  - A superseded memory remains visible in history but no longer ranks at the top
  - Pin a memory, wait a few days, retrieve — it should still be hit (not pushed down by decay)

> Known Windows caveat: `cargo test` may fail to launch due to DLL load failure (STATUS_ENTRYPOINT_NOT_FOUND). Distinguish compile failure (must fix) from run failure (host-env issue — rerun on CI/Linux).

## 17. FAQ

**Q: Why not use an existing vector DB (Qdrant / Weaviate / pgvector)?**
A: Deeting is local-first; the desktop cannot bring in extra process dependencies. SQLite + an in-house vector search is the only controllable choice. Performance-wise, a single user with <1M memories is fine. The tradeoff is scalability, which is not a desktop concern.

**Q: 6 decay profiles seems excessive — can we merge some?**
A: You can try. Each merge miscalibrates one category — for example, merging `CurrentFact` and `SessionEpisodic` means "today's current fact" and "today's chitchat" decay at the same speed, but the former is still useful tomorrow and the latter should be forgotten. To reduce profile count, first review the tradeoff table in §15.

**Q: If vitality doesn't actively decay, won't "a memory hit once years ago" resist decay forever?**
A: No. `recency_multiplier = floor + (1 - floor) * vitality * decay` — even with vitality = 1.0, once time passes `decay` approaches 0 and the multiplier approaches `floor`. Vitality scales above the floor; it **cannot let a memory exceed the floor's upper limit** when time is against it.

**Q: Write Guard Noop'd my manual note — what now?**
A: Check the UI's `decision_reason` and `score_ratio` — usually similarity ≥ 0.985 against an existing memory. Two paths: (1) reword for differentiation (add keywords or context); (2) explicitly call `update` to overwrite the existing entry.

**Q: Can Fact Extractor run incrementally during streaming, instead of only at conversation end?**
A: Technically yes, but the tradeoff is bad: (1) mid-stream extracts mid-state facts; (2) multiple LLM calls = multiple token costs. Triggering on conversation boundary is the best ROI.

**Q: Does Supersession use LLM or rules to parse claims?**
A: Rules. `parse_claim` is keyword + structural; no LLM. The LLM is used in the Fact Extractor stage; Supersession must be deterministic and replayable, so rules.

**Q: Can we add cross-user shared memories (e.g. org-level wiki)?**
A: Yes — treat it as a **new write entry** under the `WikiPromotion` profile (or a new `OrgSharedKnowledge` profile). The `ExternalIngress` concept from [self-evolution](./self-evolution-architecture.en.md) applies — cross-domain data goes through a boundary file that translates to `LocalMemoryItem`. Do not leak the external schema into core types.

## 18. References

- Data structures: [`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs)
- Write Guard: [`retrieval_kernel/write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs)
- Supersession: [`retrieval_kernel/supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs)
- Decay: [`retrieval_kernel/lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs)
- Public service: [`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs)
- Fact extraction: [`memory/fact_extractor.rs`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs)
- Snapshot: [`memory/snapshot_store.rs`](../deeting/src-tauri/src/modules/memory/snapshot_store.rs)
- Sibling docs: [`rag-architecture.en.md`](./rag-architecture.en.md), [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md), [`agent-dag-architecture.en.md`](./agent-dag-architecture.en.md), [`security-architecture.en.md`](./security-architecture.en.md)
