# Search SDK Progressive Disclosure And Ranking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `search_sdk` context cost without regressing desktop-local route selection, capability snapshotting, or direct tool execution, then evolve ranking into a feedback-driven hybrid engine.

**Architecture:** Split `search_sdk` into two views of the same ranked result set: a model-visible `summary` payload and an internal `full` execution snapshot. Add a dedicated `get_tool_schema(tool_name)` path for on-demand contract expansion, then refactor ranking into recall, rerank, and feedback layers backed by lightweight local persistence.

**Tech Stack:** Rust, Tauri, serde_json, sqlx/sqlite, existing desktop runtime control-plane modules, existing `mcp-store` persistence, targeted Rust unit/integration tests.

---

### Task 1: Add `detail_level` and split model-visible serialization from internal full records

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs`
- Modify: `deeting/src-tauri/src/modules/capability_control_plane.rs`
- Modify: `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Write the failing tests for `summary` vs `full`**

Add focused tests near the existing `build_local_sdk_search_result_with_runtime(...)` assertions:

```rust
#[tokio::test]
async fn search_sdk_defaults_to_summary_payload() {
    let result = build_local_sdk_search_result_with_runtime(
        &store,
        &provider_state.embedding,
        memory_state.service.as_ref(),
        "search web tools",
        8,
    ).await;

    let capability = result["capabilities"][0].clone();
    assert!(capability.get("input_schema").is_none());
    assert!(capability.get("python_stub").is_none());
    assert_eq!(capability["schema_available"], serde_json::json!(true));
}

#[tokio::test]
async fn search_sdk_full_payload_preserves_tool_contract_fields() {
    let result = build_local_sdk_search_result_with_runtime_full(
        &store,
        &provider_state.embedding,
        memory_state.service.as_ref(),
        "search web tools",
        8,
    ).await;

    let capability = result["capabilities"][0].clone();
    assert!(capability.get("input_schema").is_some());
    assert!(capability.get("python_stub").is_some());
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test search_sdk_defaults_to_summary_payload search_sdk_full_payload_preserves_tool_contract_fields --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: FAIL because no `detail_level` split exists yet.

**Step 3: Add a serializable detail-level model**

Inside `capability_discovery.rs`, introduce:

```rust
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum SearchSdkDetailLevel {
    Summary,
    Full,
}
```

Then split the current builder into:

```rust
pub(crate) async fn build_capability_search_result(
    mcp_store: &McpStore,
    embedding_service: &EmbeddingService,
    memory_store: &MemoryService,
    query: &str,
    limit: usize,
    detail_level: SearchSdkDetailLevel,
) -> Value
```

Keep one ranking/materialization pass, then serialize the final payload differently for `Summary` vs `Full`.

**Step 4: Keep `summary` minimal but execution-safe**

For `summary`, retain only fields needed for discovery decisions:

```rust
{
    "capability_id": "...",
    "name": "...",
    "description": "...",
    "semantic_kind": "capability",
    "asset_namespace": "skill",
    "invocation_mode": "direct",
    "status": { "callable": true, "recommended_action": "execute", "reason": "..." },
    "mutating": false,
    "risk_level": "LOW",
    "schema_available": true
}
```

Do not include `input_schema`, `output_schema`, `parameters`, `required_parameters`, `signature`, `python_stub`, or `example_arguments` in `summary`.

**Step 5: Remove duplicated heavy clones from grouped fields**

For `summary`, replace:

```rust
"capability_groups": {
  "skill_tools": [full objects...]
}
```

with compact references, for example:

```rust
"capability_groups": {
  "skill_tools": ["skill.weather_lookup", "skill.fetch_weather"]
}
```

and do the same for `recipe_groups`.

**Step 6: Wire `detail_level` through the public tool contract**

Update `search_sdk` input schema in `core_tool_contracts.rs` to include:

```rust
"detail_level": {
  "type": "string",
  "enum": ["summary", "full"],
  "default": "summary",
  "description": "Controls whether search results include lightweight references or full tool contracts."
}
```

Update `dispatch_search_sdk(...)` in `capability_control_plane.rs` to parse `detail_level`, defaulting to `summary`.

**Step 7: Run tests to verify they pass**

Run:

```bash
cargo test search_sdk_defaults_to_summary_payload search_sdk_full_payload_preserves_tool_contract_fields --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 8: Commit**

```bash
git add \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs \
  /data/Deeting/deeting/src-tauri/src/modules/capability_control_plane.rs \
  /data/Deeting/deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs
git commit -m "feat: add search_sdk detail level serialization split"
```

### Task 2: Keep runtime discovery and direct tool generation on a full internal snapshot

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_catalog.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- Modify: `deeting/src-tauri/crates/mcp-runtime/src/policy.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_toolset.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/tests.rs`

**Step 1: Write the failing tests for internal full snapshot retention**

Add tests proving:
- model-visible `search_sdk` defaults to `summary`
- runtime discovery still builds dynamic direct tools from full `input_schema`
- route evidence still sees callable direct capabilities

Example:

```rust
#[test]
fn runtime_discovery_keeps_full_snapshot_for_dynamic_tools() {
    let discovery = RuntimeDiscoveryBundle::from_search_result(summary_payload);
    assert!(build_dynamic_direct_capability_tools(
        discovery.execution_snapshot(),
        &allowlist,
        &HashSet::new(),
        &HashSet::new(),
    ).is_empty());
}
```

Then replace that expectation once the internal full snapshot exists.

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test build_local_code_mode_entry_tools_with_allowlist_includes_direct_capability_tools --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: FAIL after Task 1 if runtime starts consuming summary only.

**Step 3: Split external payload from execution snapshot**

Refactor the runtime-facing builders so they can return both:

```rust
pub(crate) struct SearchSdkResultBundle {
    pub visible_payload: Value,
    pub execution_snapshot: Value,
}
```

Rules:
- `visible_payload` is `summary` by default for model/tool replay
- `execution_snapshot` is always `full` for runtime discovery, allowlist enrichment, and dynamic tool generation

**Step 4: Update runtime discovery callers**

In `control_plane.rs` and `code_mode_catalog.rs`, ensure:
- `RuntimeDiscoveryBundle::from_search_result(...)` receives the full execution snapshot
- the actual user-facing `search_sdk` tool result still emits `summary`

In `code_mode_orchestration.rs`, update the `search_sdk` branch so:
- `last_capability_snapshot` stores the full snapshot
- streamed/search result blocks emit the summary payload

**Step 5: Update `RuntimeDiscoveryBundle` naming**

In `policy.rs`, stop implying that the raw visible payload is the only source of truth. Add accessor naming that makes the internal snapshot explicit, for example:

```rust
pub fn execution_snapshot(&self) -> &Value
```

**Step 6: Run tests to verify they pass**

Run:

```bash
cargo test \
  build_local_code_mode_entry_tools_with_allowlist_includes_direct_capability_tools \
  render_skill_recipe_prompt_defers_execution_truth_to_search_sdk \
  --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 7: Commit**

```bash
git add \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_catalog.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs \
  /data/Deeting/deeting/src-tauri/crates/mcp-runtime/src/policy.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_toolset.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/tests.rs
git commit -m "refactor: keep full search_sdk snapshot for runtime execution"
```

### Task 3: Add `get_tool_schema(tool_name)` for on-demand contract expansion

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs`
- Modify: `deeting/src-tauri/src/modules/capability_control_plane.rs`
- Modify: `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_catalog.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Write failing tests for schema lookup**

Add tests like:

```rust
#[tokio::test]
async fn get_tool_schema_returns_full_contract_for_direct_capability() {
    let result = dispatch_get_tool_schema(&store, &serde_json::json!({
        "tool_name": "search_web"
    })).await.expect("schema");

    assert_eq!(result["tool_name"], serde_json::json!("search_web"));
    assert!(result.get("input_schema").is_some());
    assert!(result.get("required_parameters").is_some());
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test get_tool_schema_returns_full_contract_for_direct_capability --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: FAIL because no lookup tool exists.

**Step 3: Add a reusable contract lookup helper**

In `capability_discovery.rs`, extract the contract-building path behind a helper that resolves one capability by name and returns:

```rust
{
  "tool_name": "...",
  "capability_id": "...",
  "description": "...",
  "input_schema": {...},
  "output_schema": {...},
  "parameters": [...],
  "required_parameters": [...],
  "signature": "...",
  "python_stub": "...",
  "example_arguments": {...},
  "permission_scope": [...],
  "risk_level": "LOW"
}
```

**Step 4: Register a new core tool**

Add `get_tool_schema` to `core_tool_contracts.rs` and `code_mode_catalog.rs` with input:

```rust
{
  "type": "object",
  "properties": {
    "tool_name": { "type": "string" }
  },
  "required": ["tool_name"]
}
```

**Step 5: Dispatch the tool**

In `capability_control_plane.rs`, add:

```rust
pub(crate) async fn dispatch_get_tool_schema(...)
```

and route the internal host tool name alongside `search_sdk`.

**Step 6: Update execution guidance**

Adjust the `search_sdk` description so it teaches:
- search with `detail_level=summary`
- call `get_tool_schema(tool_name)` before constructing arguments when a selected capability needs detailed contract information

**Step 7: Run tests to verify they pass**

Run:

```bash
cargo test get_tool_schema_returns_full_contract_for_direct_capability --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 8: Commit**

```bash
git add \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs \
  /data/Deeting/deeting/src-tauri/src/modules/capability_control_plane.rs \
  /data/Deeting/deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_catalog.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs
git commit -m "feat: add on-demand get_tool_schema for search_sdk results"
```

### Task 4: Refactor ranking into recall, rerank, and serialization stages

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/search_ranking.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs`
- Create: `deeting/src-tauri/src/modules/desktop_runtime/runtime/search_feedback.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/mod.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Write failing ranking tests**

Add unit tests for:
- exact lexical terms still win
- historical affinity can lift a slightly weaker lexical match
- session affinity boosts sibling tools in the same namespace

Example:

```rust
#[test]
fn historical_boost_can_raise_recent_successful_tool() {
    let reranked = rerank_candidates(
        base_candidates,
        SearchFeedbackContext {
            recent_tools: vec!["skill.github.search_code".into()],
            historical_affinity: vec![...],
        },
    );
    assert_eq!(reranked[0].name, "skill.github.search_code");
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test historical_boost_can_raise_recent_successful_tool --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: FAIL because no feedback-aware reranker exists.

**Step 3: Keep the current lexical matcher as the first recall stage**

Do not replace everything in one step. Move current lexical logic out of the monolithic rank flow so `search_ranking.rs` becomes:
- lexical recall
- structured recall
- future semantic recall hook
- RRF fusion helper
- rerank helper

**Step 4: Add explicit recall/rerank data types**

Create lightweight types in `search_feedback.rs`, for example:

```rust
pub(crate) struct SearchFeedbackContext {
    pub recent_tools: Vec<String>,
    pub namespace_recent_tools: Vec<String>,
    pub historical_affinity: Vec<ToolAffinityScore>,
}
```

and:

```rust
pub(crate) struct ToolAffinityScore {
    pub tool_name: String,
    pub score: f64,
}
```

**Step 5: Replace hardcoded linear bonus accretion with staged reranking**

Target formula:

```text
score_total = score_base + boost_session + boost_historical
```

Implementation notes:
- keep `score_base` from the recall/fusion stage
- compute `boost_session` from current-session recent success and namespace siblings
- compute `boost_historical` from decayed successful executions

Do not ship semantic retrieval yet if embeddings are not wired. Ship the scaffolding with a no-op semantic source first, because `EmbeddingService` is currently not used in `build_capability_search_result(...)`.

**Step 6: Run tests to verify they pass**

Run:

```bash
cargo test search_ranking --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS with new ranking tests and existing lexical tests.

**Step 7: Commit**

```bash
git add \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/search_ranking.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/search_feedback.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/mod.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs
git commit -m "refactor: stage search_sdk recall and feedback-aware reranking"
```

### Task 5: Add execution tracking, decayed historical affinity, and query enrichment

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/store/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/search_feedback.rs`
- Test: `deeting/src-tauri/src/modules/mcp/store/tests.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Write failing persistence tests**

Add store-level tests for:
- inserting an execution tracking row
- reading recent session tool successes
- computing decayed historical affinity
- recording virtual keywords for repeated query-to-tool success pairs

Example:

```rust
#[tokio::test]
async fn tool_affinity_decay_reduces_old_success_weight() {
    let score = store.compute_tool_affinity("read_file").await.expect("score");
    assert!(score < fresh_score);
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test tool_affinity_decay_reduces_old_success_weight --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: FAIL because no persistence tables or affinity logic exist.

**Step 3: Add persistence tables to `mcp-store`**

In `mcp/store/mod.rs`, add tables such as:

```sql
CREATE TABLE IF NOT EXISTS tool_execution_history (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  search_query TEXT NOT NULL,
  normalized_query TEXT,
  tool_name TEXT NOT NULL,
  tool_namespace TEXT,
  success INTEGER NOT NULL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_query_affinity (
  id TEXT PRIMARY KEY,
  query_term TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  weight REAL NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Step 4: Record successful tool executions at the real success seam**

Hook the actual success path in:
- `tool_execution.rs` for MCP/skill binding calls
- `code_mode_orchestration.rs` for `search_sdk`, `execute_code_plan`, and local direct-tool replay loops when they finish with success metadata

Persist:
- original query when available
- normalized query when available
- `session_id`
- `tool_name`
- `tool_namespace`
- `success`
- optional `latency_ms`

**Step 5: Reuse the existing decay pattern**

Model the historical decay after the memory vitality rerank pattern already used in `memory/service.rs`:

```rust
let decay = (-DECAY_RATE * days_since_last_success).exp();
score *= BASE_WEIGHT + DECAY_WEIGHT * frequency * decay;
```

Keep constants local to `search_feedback.rs`.

**Step 6: Add virtual keyword enrichment as a bounded background derivation**

Implement a lightweight aggregation that:
- groups successful `query -> tool_name` pairs
- promotes repeated query fragments into `tool_query_affinity`
- clamps per-tool enrichment volume
- expires or decays stale entries over time

Do not mutate original tool descriptions.

**Step 7: Run tests to verify they pass**

Run:

```bash
cargo test \
  tool_affinity_decay_reduces_old_success_weight \
  --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Then run a broader regression slice:

```bash
cargo test search_sdk --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 8: Commit**

```bash
git add \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/store/mod.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs \
  /data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/search_feedback.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/store/tests.rs \
  /data/Deeting/deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs
git commit -m "feat: add search_sdk execution feedback and decayed affinity"
```

### Task 6: Run end-to-end regression verification for discovery, routing, and execution closure

**Files:**
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/tests.rs`
- Test: `deeting/src-tauri/src/modules/mcp/store/tests.rs`

**Step 1: Run focused search-sdk regressions**

```bash
cargo test \
  search_sdk \
  --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 2: Run orchestrator/runtime regressions**

```bash
cargo test \
  render_skill_recipe_prompt \
  build_local_code_mode_entry_tools_with_allowlist \
  --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 3: Run store regressions for new tracking tables**

```bash
cargo test \
  tool_affinity \
  --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 4: Run one final broad verification slice**

```bash
cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml search_sdk
```

Expected: PASS with no regressions in discovery, routing evidence, or direct capability tool synthesis.

**Step 5: Commit**

```bash
git status --short
```

Verify only intended files changed, then commit any final fixups with a focused message.

## Notes for the implementer

- Do not let model-visible `summary` become the only runtime source of truth.
- Do not move schema expansion into `RouteEvidence` or route-selection code.
- Do not mutate original tool descriptions when adding historical query enrichment.
- Ship disclosure/snapshot split before ranking changes.
- Ship ranking scaffolding before semantic retrieval if embeddings are still not wired.
