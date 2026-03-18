# MCP Core Slim Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove remaining non-core runtime pieces from MCP (onboarding, asset indexing, compat routing), update all call sites, and leave MCP with core-only responsibilities plus a compatibility layer.

**Architecture:** MCP remains the core tool/source runtime. Non-core flows move into their owning modules (`skills`, `knowledge`, etc.). MCP keeps a thin compatibility layer to forward legacy command/type paths. `system_asset` table initialization remains in MCP until the final cleanup phase.

**Tech Stack:** Rust (Tauri), module-layer refactor, `rg`, `cargo check`.

---

### Task 1: Add MCP compatibility layer skeleton

**Files:**
- Create: `deeting/src-tauri/src/modules/mcp/compat/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/mod.rs`

**Step 1: Write the failing test**
Create a temporary import in `deeting/src-tauri/src/modules/mcp/mod.rs` to ensure the new module must exist.

```rust
mod compat;
```

**Step 2: Run test to verify it fails**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: FAIL with missing file `mcp/compat/mod.rs`.

**Step 3: Write minimal implementation**
Create `deeting/src-tauri/src/modules/mcp/compat/mod.rs` and expose a placeholder re-export section.

```rust
// Thin compatibility layer for legacy MCP entrypoints.
// Keep adapters here until all call sites migrate.
```

Update `deeting/src-tauri/src/modules/mcp/mod.rs` to expose it.

```rust
pub(crate) mod compat;
```

**Step 4: Run test to verify it passes**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: PASS (or fail only for unrelated known issues).

**Step 5: Commit**

```bash
git add \
  deeting/src-tauri/src/modules/mcp/compat/mod.rs \
  deeting/src-tauri/src/modules/mcp/mod.rs

git commit -m "refactor: add MCP compat module skeleton"
```

---

### Task 2: Move skill onboarding runtime helpers to `skills`

**Files:**
- Create: `deeting/src-tauri/src/modules/skills/onboarding.rs`
- Modify: `deeting/src-tauri/src/modules/skills/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/mod.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`
- Delete: `deeting/src-tauri/src/modules/mcp/commands/runtime/onboarding.rs`

**Step 1: Write the failing test**
Temporarily keep the old import path to force a compile error after removing the MCP onboarding module.

```rust
use crate::modules::mcp::commands::runtime::install_local_skill_from_onboarding_request;
```

**Step 2: Run test to verify it fails**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: FAIL once the MCP onboarding module is removed.

**Step 3: Write minimal implementation**
Create `deeting/src-tauri/src/modules/skills/onboarding.rs` and move the onboarding helpers.

```rust
use crate::modules::skills::registry_impl::{install_skill_to_local, normalize_skill_dir_name};

pub(crate) fn derive_skill_name_from_repo_url(repo_url: &str) -> String { /* moved body */ }

pub(crate) fn parse_skill_onboarding_payload(
    payload: &serde_json::Value,
) -> Result<(String, String), String> { /* moved body */ }

pub(crate) async fn install_local_skill_from_onboarding_request(
    app: &AppHandle,
    app_state: &AppState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> { /* moved body */ }
```

Expose it in `deeting/src-tauri/src/modules/skills/mod.rs`.

```rust
pub(crate) mod onboarding;
```

Update call sites to import from `crate::modules::skills::onboarding::*`.

```rust
use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
```

**Step 4: Run test to verify it passes**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: PASS (or fail only for unrelated known issues).

**Step 5: Commit**

```bash
git add \
  deeting/src-tauri/src/modules/skills/onboarding.rs \
  deeting/src-tauri/src/modules/skills/mod.rs \
  deeting/src-tauri/src/modules/mcp/commands/runtime.rs \
  deeting/src-tauri/src/modules/desktop_runtime/runtime/mod.rs \
  deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs \
  deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs

git rm deeting/src-tauri/src/modules/mcp/commands/runtime/onboarding.rs

git commit -m "refactor: move onboarding helpers to skills"
```

---

### Task 3: Move local asset indexing to `knowledge`

**Files:**
- Create: `deeting/src-tauri/src/modules/knowledge/asset_indexing.rs`
- Modify: `deeting/src-tauri/src/modules/knowledge/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime.rs`
- Modify: `deeting/src-tauri/src/commands.rs`
- Modify: `deeting/src-tauri/src/setup.rs`
- Modify: `deeting/src-tauri/src/modules/admin/commands.rs`
- Delete: `deeting/src-tauri/src/modules/mcp/commands/runtime/asset_indexing.rs`

**Step 1: Write the failing test**
Keep the old MCP import path in `deeting/src-tauri/src/setup.rs` to force a compile error after the move.

```rust
crate::modules::mcp::commands::runtime::asset_indexing::rebuild_local_knowledge_vector_index(...)
```

**Step 2: Run test to verify it fails**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: FAIL when `asset_indexing` module no longer exists in MCP.

**Step 3: Write minimal implementation**
Create `deeting/src-tauri/src/modules/knowledge/asset_indexing.rs` and move the functions.

```rust
pub async fn rebuild_local_embedding_assets(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<LocalEmbeddingRebuildResponse, String> { /* moved body */ }

pub(crate) async fn rebuild_local_knowledge_vector_index(
    app_state: &AppState,
) -> Result<usize, String> { /* moved body */ }
```

Expose it in `deeting/src-tauri/src/modules/knowledge/mod.rs`.

```rust
pub(crate) mod asset_indexing;
```

Update call sites to use `crate::modules::knowledge::asset_indexing::*`.

```rust
crate::modules::knowledge::asset_indexing::rebuild_local_embedding_assets(...)
```

**Step 4: Run test to verify it passes**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: PASS (or fail only for unrelated known issues).

**Step 5: Commit**

```bash
git add \
  deeting/src-tauri/src/modules/knowledge/asset_indexing.rs \
  deeting/src-tauri/src/modules/knowledge/mod.rs \
  deeting/src-tauri/src/modules/mcp/commands/runtime.rs \
  deeting/src-tauri/src/commands.rs \
  deeting/src-tauri/src/setup.rs \
  deeting/src-tauri/src/modules/admin/commands.rs

git rm deeting/src-tauri/src/modules/mcp/commands/runtime/asset_indexing.rs

git commit -m "refactor: move asset indexing to knowledge"
```

---

### Task 4: Update MCP runtime exports and tool contracts after moves

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/core_tool_contracts.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Write the failing test**
Keep references to the old MCP onboarding helpers and asset indexing exports.

```rust
pub(crate) use onboarding::install_local_skill_from_onboarding_request;
```

**Step 2: Run test to verify it fails**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: FAIL when onboarding and asset indexing modules are removed.

**Step 3: Write minimal implementation**
Remove MCP re-exports and point runtime usage to the new module paths.

```rust
pub(crate) use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
pub(crate) use crate::modules::knowledge::asset_indexing::rebuild_local_knowledge_vector_index;
```

Update any tests to import from the new modules.

```rust
use crate::modules::skills::onboarding::parse_skill_onboarding_payload;
```

**Step 4: Run test to verify it passes**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: PASS (or fail only for unrelated known issues).

**Step 5: Commit**

```bash
git add \
  deeting/src-tauri/src/modules/mcp/commands/runtime.rs \
  deeting/src-tauri/src/modules/mcp/commands/runtime/core_tool_contracts.rs \
  deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs

git commit -m "refactor: reroute MCP runtime exports to owning modules"
```

---

### Task 5: Audit MCP for remaining non-core dependencies

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands.rs`
- Modify: `deeting/src-tauri/src/commands.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/mod.rs`

**Step 1: Write the failing test**
Prepare an audit list and ensure no MCP command registration points to moved modules.

```text
rg -n "modules::mcp::commands::runtime::(asset_indexing|onboarding)" deeting/src-tauri/src
```

**Step 2: Run test to verify it fails**

Run: `rg -n "modules::mcp::commands::runtime::(asset_indexing|onboarding)" deeting/src-tauri/src`
Expected: Zero matches after previous tasks.

**Step 3: Write minimal implementation**
- Remove any remaining MCP command registrations for moved functions.
- Keep `system_asset` table initialization in MCP `store/mod.rs` for now.

**Step 4: Run test to verify it passes**

Run: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`
Expected: PASS (or fail only for unrelated known issues).

**Step 5: Commit**

```bash
git add \
  deeting/src-tauri/src/modules/mcp/commands.rs \
  deeting/src-tauri/src/commands.rs \
  deeting/src-tauri/src/modules/mcp/store/mod.rs

git commit -m "refactor: finalize MCP command registrations"
```
