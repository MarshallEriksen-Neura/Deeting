# Desktop Official Skill Capability Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish a desktop-only official-skill capability registry, route marker-mode official-skill host calls through it, and migrate the first wave of desktop-supported official wrappers to the new capability ids.

**Architecture:** Add a desktop capability registry plus bridge dispatcher under the desktop runtime, then update the official-skill marker bridge to resolve capability ids instead of ad hoc host tool names. Migrate only the wrappers that already have truthful desktop execution paths and leave runtime-native or backend-first wrappers out of the first wave.

**Tech Stack:** Rust (Tauri desktop runtime), Python official skill wrappers, serde_json, Tokio async runtime, existing Deeting SDK marker-mode protocol, Rust async tests.

---

### Task 1: Add failing tests for desktop official-skill capability resolution

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`

**Step 1: Write the failing test**

- Add async tests that assert:
  - `skill_registry.refresh` resolves through the official-skill bridge.
  - `memory.append` and `memory.search` resolve through the official-skill bridge.
  - unknown capability ids still return `None`.

**Step 2: Run test to verify it fails**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because the bridge only understands `register_local_skills`.

**Step 3: Write minimal implementation**

- Introduce a registry-backed bridge dispatcher and switch the official-skill bridge to use capability ids.

**Step 4: Run test to verify it passes**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

### Task 2: Add desktop capability registry and dispatch layer

**Files:**
- Create: `deeting/src-tauri/src/modules/mcp/desktop_capabilities.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`

**Step 1: Write the failing test**

- Add tests for registry lookup and supported capability ids.

**Step 2: Run test to verify it fails**

Run: `cargo test desktop_capabilities --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because the module and lookup APIs do not exist.

**Step 3: Write minimal implementation**

- Define capability ids, callable surface flags, and async dispatch.
- Reuse existing desktop commands/services rather than inventing new execution paths.

**Step 4: Run test to verify it passes**

Run: `cargo test desktop_capabilities --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

### Task 3: Migrate desktop-supported official wrappers to capability ids

**Files:**
- Modify: `packages/official-skills/skill_manager/main.py`
- Modify: `packages/official-skills/memory/main.py`
- Modify: `packages/official-skills/monitor/main.py`
- Modify: `packages/official-skills/database/main.py`
- Modify: `packages/official-skills/provider_probe/main.py`

**Step 1: Write the failing test**

- Add or update Rust tests that simulate marker tool requests using the new capability ids those wrappers will emit.

**Step 2: Run test to verify it fails**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL for the not-yet-implemented capability ids.

**Step 3: Write minimal implementation**

- Replace old host tool names with new desktop capability ids in the wrappers.
- Keep wrapper entrypoint names stable where possible; only change the host-call contract.

**Step 4: Run test to verify it passes**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

### Task 4: Tighten bridge error messaging and docs

**Files:**
- Modify: `docs/plans/2026-03-13-official-skills-host-bridge-gap-list.md`
- Modify: `packages/official-skills/*/SKILL.md` as needed for migrated wrappers

**Step 1: Write the failing test**

- Add a test for unsupported capability ids returning a stable desktop-capability error shape if needed.

**Step 2: Run test to verify it fails**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because the old bridge error is too generic or stale.

**Step 3: Write minimal implementation**

- Update docs to reflect the capability-contract cutover.
- Adjust bridge errors to mention unresolved desktop capability ids instead of generic host tool names.

**Step 4: Run test to verify it passes**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

### Task 5: Verification

**Files:**
- Test: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`

**Step 1: Run targeted tests**

Run: `cargo test capability_bridge --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

**Step 2: Run focused regression checks**

Run: `cargo test register_local_skills_materializes_skill_tool_bindings_and_assets --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS

**Step 3: Inspect git diff**

Run: `git diff --stat`

Expected: Bridge/runtime files, wrapper files, and plan docs only.
