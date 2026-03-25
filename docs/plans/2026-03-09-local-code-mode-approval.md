# Local Code Mode Approval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make desktop local chat pause on `execute_code_plan` execution requests, show a user approval UI, and continue the same assistant turn after approval.

**Architecture:** Reuse the existing approval dialog/store pattern, but add a dedicated pending local code-mode approval state in Tauri so the local chat orchestrator can pause and later resume from the interrupted tool-call round. Frontend keeps the same assistant message alive and appends continuation blocks after approval.

**Tech Stack:** Rust/Tauri, Next.js/React, Zustand, existing local gateway chat streaming.

---

### Task 1: Add pause/resume state for local code mode
**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/mod.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/code_mode/commands.rs`
- Modify: `deeting/src-tauri/src/commands.rs`

Acceptance criteria:
- Local chat `execute_code_plan(dry_run=false)` no longer hard-fails immediately.
- Tauri stores a pending approval token with enough context to resume the local chat loop.
- Tauri exposes approve/reject commands for the pending local code-mode execution.

### Task 2: Reuse frontend approval UI for local code mode
**Files:**
- Modify: `deeting/lib/chat/bridge-approval-store.ts`
- Modify: `deeting/components/bridge/tool-approval-dialog.tsx`
- Modify: `deeting/hooks/chat/use-chat-messaging-service.ts`
- Modify: any nearby tests if needed

Acceptance criteria:
- Incoming local chat pending-approval blocks populate the global approval store.
- Existing dialog can render and execute a local code-mode approval.
- On approval, continuation content is appended to the same assistant message.

### Task 3: Verify targeted behavior
**Files:**
- Modify: nearby Rust/TS tests only if needed

Acceptance criteria:
- Targeted Rust tests cover pending approval queue/resume behavior.
- Targeted frontend tests or diagnostics pass for modified files.
