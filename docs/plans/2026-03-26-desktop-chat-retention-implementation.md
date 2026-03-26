# Desktop Chat Retention Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a desktop-only chat history retention setting that deletes expired local conversation sessions by last activity time to control SQLite disk growth.

**Architecture:** The UI persists one new desktop config key from the existing desktop agent settings card. The Tauri local periodic worker reads that key and deletes expired `conversation_session` rows so related child tables are removed via cascading foreign keys.

**Tech Stack:** Next.js App Router, React, Jest, Tauri, Rust, SQLx, SQLite

---

### Task 1: Document the chosen desktop-local retention design

**Files:**
- Create: `docs/plans/2026-03-26-desktop-chat-retention-design.md`
- Create: `docs/plans/2026-03-26-desktop-chat-retention-implementation.md`

**Step 1: Write the design doc**

Capture the lane, selected retention semantics, config key, worker hook, and verification plan.

**Step 2: Save the implementation plan**

Describe the TDD sequence, exact files, and commands.

### Task 2: Write the failing frontend test for retention settings

**Files:**
- Create: `deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx`
- Modify: `deeting/app/[locale]/settings/components/agent-settings-card.tsx`
- Modify: `deeting/lib/api/desktop-config.ts`
- Modify: `deeting/messages/zh-CN/settings.json`
- Modify: `deeting/messages/en/settings.json`

**Step 1: Write the failing test**

Add a Jest test that renders `AgentSettingsCard`, mocks desktop config reads, shows the saved retention option, changes the select, saves, and expects `setDesktopConfig("chat.history_retention_days", "...")`.

**Step 2: Run test to verify it fails**

Run: `bun test deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx`

Expected: FAIL because the retention field/config key does not exist yet.

**Step 3: Write minimal implementation**

Add the new config key, local select state, save behavior, and i18n copy.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx`

Expected: PASS

### Task 3: Write the failing Rust test for expired session cleanup

**Files:**
- Modify: `deeting/src-tauri/src/modules/conversations/store.rs`
- Modify: `deeting/src-tauri/src/modules/conversations/summary_workers.rs`

**Step 1: Write the failing test**

Add a Rust async test that:
- creates a temp `McpStore`
- seeds two `conversation_session` rows with different `last_active_at`
- writes retention config `chat.history_retention_days = 7`
- runs the cleanup helper
- asserts the old session is deleted and the recent session remains

**Step 2: Run test to verify it fails**

Run: `cd deeting/src-tauri && cargo test chat_retention -- --nocapture`

Expected: FAIL because no retention cleanup helper exists yet.

**Step 3: Write minimal implementation**

Add retention config parsing, expired-session deletion SQL, and periodic worker dispatch.

**Step 4: Run test to verify it passes**

Run: `cd deeting/src-tauri && cargo test chat_retention -- --nocapture`

Expected: PASS

### Task 4: Run focused regression checks

**Files:**
- Test: `deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx`
- Test: `deeting/app/[locale]/settings/components/__tests__/settings-form.desktop-config.test.tsx`
- Test: `deeting/src-tauri/src/modules/conversations/store.rs`

**Step 1: Run focused frontend tests**

Run: `bun test deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx deeting/app/[locale]/settings/components/__tests__/settings-form.desktop-config.test.tsx`

Expected: PASS

**Step 2: Run focused Rust tests**

Run: `cd deeting/src-tauri && cargo test chat_retention -- --nocapture`

Expected: PASS

**Step 3: Run diagnostics/build as needed**

Run file diagnostics on changed files and a focused build/test command if the changed surfaces require it.

### Task 5: Commit

**Step 1: Commit when verification is green**

```bash
git add docs/plans/2026-03-26-desktop-chat-retention-design.md \
  docs/plans/2026-03-26-desktop-chat-retention-implementation.md \
  deeting/app/[locale]/settings/components/__tests__/agent-settings-card.test.tsx \
  deeting/app/[locale]/settings/components/agent-settings-card.tsx \
  deeting/lib/api/desktop-config.ts \
  deeting/messages/en/settings.json \
  deeting/messages/zh-CN/settings.json \
  deeting/src-tauri/src/modules/conversations/store.rs \
  deeting/src-tauri/src/modules/conversations/summary_workers.rs
git commit -m "feat: add desktop local chat retention"
```
