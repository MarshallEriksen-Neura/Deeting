# Desktop IM Transport Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a unified desktop IM runtime that supports `auto | direct | relay` transport selection per connection profile, productize Feishu direct long-connection support, and keep relay as an optional fallback.

**Architecture:** Add profile-based IM config/state in the Tauri desktop layer, resolve each enabled profile to an effective transport at runtime, and route both direct and relay events through shared local handlers. Keep the first productized UI focused on Feishu while making the storage/runtime model generic enough for Telegram/DingTalk/WeChat follow-up work.

**Tech Stack:** Rust/Tauri 2, Tokio async runtime, existing desktop SQLite config store, Next.js settings UI, React Hook Form.

---

### Task 1: Lock resolution behavior with failing tests

**Files:**
- Modify: `deeting/src-tauri/src/modules/im/mod.rs`
- Create: `deeting/src-tauri/src/modules/im/profile.rs`
- Test: `deeting/src-tauri/src/modules/im/mod.rs`

**Step 1: Write failing tests**
- Add tests for `auto` preferring direct when platform direct config is complete.
- Add tests for `auto` falling back to relay when direct credentials are missing.
- Add tests for forced `direct` not silently falling back to relay.

**Step 2: Run tests to verify they fail**
- Run: `cargo test im:: --manifest-path deeting/src-tauri/Cargo.toml`

**Step 3: Implement minimal profile/resolver types**
- Add generic transport preference/effective transport/profile structs.
- Add `resolve_transport(...)` with explainable reason codes.

**Step 4: Run tests to verify they pass**
- Run: `cargo test im:: --manifest-path deeting/src-tauri/Cargo.toml`

### Task 2: Refactor shared IM runtime and handlers

**Files:**
- Modify: `deeting/src-tauri/src/modules/im/manager.rs`
- Create: `deeting/src-tauri/src/modules/im/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/im/types.rs`
- Modify: `deeting/src-tauri/src/modules/relay/mod.rs`

**Step 1: Write failing tests**
- Add tests for loading default profiles and runtime state transitions.

**Step 2: Run tests to verify they fail**
- Run: `cargo test im::runtime --manifest-path deeting/src-tauri/Cargo.toml`

**Step 3: Implement shared runtime**
- Load profiles from desktop config.
- Spawn direct or relay workers based on resolved transport.
- Extract shared chat-reply/card-action handling so direct and relay reuse the same logic.

**Step 4: Run tests to verify they pass**
- Run: `cargo test im::runtime --manifest-path deeting/src-tauri/Cargo.toml`

### Task 3: Wire startup and desktop commands

**Files:**
- Modify: `deeting/src-tauri/src/setup.rs`
- Modify: `deeting/src-tauri/src/commands.rs`
- Modify: `deeting/src-tauri/src/modules/mod.rs`

**Step 1: Write failing test or compile check target**
- Verify command exports/runtime symbol names are referenced by the desktop app.

**Step 2: Run targeted compile/test check**
- Run: `cargo test im:: --manifest-path deeting/src-tauri/Cargo.toml`

**Step 3: Implement startup command wiring**
- Replace relay-only worker startup/restart with unified IM runtime worker wiring.
- Preserve relay support through the new runtime.

**Step 4: Re-run targeted check**
- Run: `cargo test im:: --manifest-path deeting/src-tauri/Cargo.toml`

### Task 4: Productize desktop settings for IM connections

**Files:**
- Modify: `deeting/app/[locale]/settings/types.ts`
- Modify: `deeting/app/[locale]/settings/components/settings-form.tsx`
- Replace: `deeting/app/[locale]/settings/components/desktop-relay-settings-card.tsx`
- Replace: `deeting/lib/api/desktop-relay.ts`
- Modify: `deeting/messages/zh-CN/settings.json`
- Modify: `deeting/messages/en/settings.json`

**Step 1: Write failing UI/logic assertions where practical**
- Add lightweight TypeScript-level validation or local helper tests if present; otherwise use build verification.

**Step 2: Run targeted type/build check**
- Run: `npm test` or repo-appropriate targeted check if a local test entry exists.

**Step 3: Implement IM settings UI**
- Present Feishu profile fields with `auto/direct/relay`.
- Show effective transport and reason.
- Persist profile JSON instead of scattered relay-only keys.

**Step 4: Re-run targeted verification**
- Run the same targeted frontend check.

### Task 5: Verify end-to-end behavior and document gaps

**Files:**
- Modify: implementation files touched above

**Step 1: Run targeted Rust verification**
- Run: `cargo test im:: --manifest-path deeting/src-tauri/Cargo.toml`

**Step 2: Run targeted frontend verification**
- Run: targeted settings/type check used during Task 4.

**Step 3: Summarize residual gaps**
- Call out which platforms are framework-ready but not yet productized.
- Call out any missing runtime proof that still needs live Feishu credentials.
