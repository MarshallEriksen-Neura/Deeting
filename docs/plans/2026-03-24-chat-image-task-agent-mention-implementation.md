# Chat Image Task Agent Mention Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add explicit `@agent` chat mention support so image-generation custom task agents can be invoked directly from the chat page and return `image.result` blocks into the active conversation.

**Architecture:** Parse an explicit task-agent mention on the chat input path, resolve it to a local custom task agent id, pass that explicit selection into the desktop local chat request, and give the control/execution plane a high-priority explicit-agent route that reuses the existing image task-agent runtime and `image.result` UI block rendering path.

**Tech Stack:** Next.js/React 19, TypeScript, Zustand chat state, Tauri desktop invoke bridge, Rust desktop runtime, serde_json, existing custom task agent runtime, existing chat message block renderer.

---

### Task 1: Add explicit task-agent mention parsing on the chat send path

**Files:**
- Modify: `deeting/hooks/chat/use-chat-messaging.ts`
- Modify: `deeting/hooks/chat/use-chat-messaging-service.ts`
- Modify: `deeting/store/chat-store.ts`
- Test: `deeting/hooks/chat/__tests__/use-chat-messaging*.test.ts` or closest existing send-path test file

**Step 1: Write the failing test**

- Add frontend tests asserting:
  - `@达芬奇 画一只猫` is split into explicit agent selection plus effective prompt
  - `@达芬奇` without prompt is rejected
  - messages without mention stay unchanged

**Step 2: Run test to verify it fails**

Run: `bun test deeting/hooks/chat --runInBand`

Expected: FAIL because the send path does not yet parse explicit task-agent mentions.

**Step 3: Write minimal implementation**

- Add a lightweight mention parser for the current message.
- Resolve mention metadata into chat send payload state.
- Keep parsing intentionally narrow: first mention only, explicit prefix usage only.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/hooks/chat --runInBand`

Expected: PASS

### Task 2: Surface custom task agents to the chat input as mentionable entities

**Files:**
- Modify: `deeting/components/chat/input/chat-input.tsx`
- Modify: `deeting/components/chat/console/controls-container.tsx` if mention UI is attached there
- Modify: `deeting/app/[locale]/chat/*` container files that load input props
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`

**Step 1: Write the failing test**

- Add UI tests asserting:
  - image-capable task agents appear in mention suggestions
  - suggestion selection inserts `@agent`
  - image task agents are visually labeled

**Step 2: Run test to verify it fails**

Run: `bun test deeting/components/chat --runInBand`

Expected: FAIL because the chat input does not yet support task-agent mention suggestions.

**Step 3: Write minimal implementation**

- Load local custom task agent catalog into the chat input path.
- Add mention suggestion UI with clear image-agent labeling.
- Ensure selected mention stores an id-backed explicit ref where possible.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/components/chat --runInBand`

Expected: PASS

### Task 3: Extend desktop local chat request payload with explicit task-agent selection

**Files:**
- Modify: `deeting/lib/platform/core/types.ts`
- Modify: `deeting/lib/platform/adapters/desktop/provider-service.ts` or relevant desktop chat adapter
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/local_gateway.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs` request structs

**Step 1: Write the failing test**

- Add Rust and/or TS adapter tests asserting that the local chat request can carry:
  - `explicit_task_agent_id`
  - effective prompt without the mention prefix

**Step 2: Run test to verify it fails**

Run: `cargo test desktop_runtime --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because no explicit task-agent field exists on the request contract.

**Step 3: Write minimal implementation**

- Thread explicit task-agent selection through the desktop local chat request shape.
- Preserve backward compatibility when the field is absent.

**Step 4: Run test to verify it passes**

Run: `cargo test desktop_runtime --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS for the targeted request-contract tests, subject to unrelated pre-existing workspace failures being called out.

### Task 4: Give control plane explicit-agent precedence over fuzzy task-agent selection

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - explicit image task-agent id forces worker routing
  - fuzzy `select_worker_custom_task_agent(...)` is skipped when explicit selection is present
  - invalid explicit ids return a stable error

**Step 2: Run test to verify it fails**

Run: `cargo test custom_task_agent --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because explicit task-agent precedence is not implemented.

**Step 3: Write minimal implementation**

- Add explicit task-agent lookup path.
- Give it higher priority than semantic/name-based candidate selection.
- Keep current fuzzy behavior untouched for messages without `@agent`.

**Step 4: Run test to verify it passes**

Run: `cargo test custom_task_agent --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS for the targeted routing tests, subject to unrelated workspace failures being called out.

### Task 5: Return image task-agent output as normal chat render blocks

**Files:**
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/runtime/tool_result_blocks.rs` if block append logic needs adjustment
- Modify: `deeting/lib/chat/message-protocol.ts` only if block typing changes
- Test: `deeting/lib/chat/__tests__/conversation-adapter.test.ts`

**Step 1: Write the failing test**

- Add tests asserting:
  - image task-agent execution yields a renderable `ui` block with `viewType = image.result`
  - history replay preserves that block
  - assistant content does not collapse to empty/opaque delegated payload only

**Step 2: Run test to verify it fails**

Run: `bun test deeting/lib/chat --runInBand`

Expected: FAIL because the current delegated-worker flow is optimized for generic delegated payloads rather than explicit chat-facing image agent results.

**Step 3: Write minimal implementation**

- Keep reusing `build_custom_task_agent_render_blocks(...)`.
- Adjust the execution path so explicit image task-agent invocation is represented as normal assistant output in the current conversation.
- Preserve debug/tool-trace information without making it the primary user-facing payload.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/lib/chat --runInBand`

Expected: PASS

### Task 6: Polish chat UX and fallback behavior

**Files:**
- Modify: `deeting/components/chat/messages/ai-response-bubble.tsx`
- Modify: `deeting/components/views/image-result-view.tsx` if title/metadata needs chat polish
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`

**Step 1: Write the failing test**

- Add UI tests for:
  - invalid mention target error
  - missing prompt after mention error
  - successful image block render following explicit `@agent`

**Step 2: Run test to verify it fails**

Run: `bun test deeting/components/chat/messages --runInBand`

Expected: FAIL because the UX and messaging do not yet describe explicit image task-agent invocation.

**Step 3: Write minimal implementation**

- Add clear validation/error messages for bad mentions.
- Ensure image result blocks look intentional inside chat, not like a leaked debug widget.
- Keep image history page reachable for deeper inspection.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/components/chat/messages --runInBand`

Expected: PASS

### Task 7: Verification

**Files:**
- Test: `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs`
- Test: `deeting/components/chat/*`
- Test: `deeting/lib/chat/__tests__/conversation-adapter.test.ts`

**Step 1: Run targeted frontend tests**

Run: `bun test deeting/components/chat deeting/lib/chat --runInBand`

Expected: PASS

**Step 2: Run targeted Rust tests**

Run: `cargo test custom_task_agent --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS for the added explicit-agent routing and image-render tests, or explicit evidence of unrelated existing failures.

**Step 3: Run formatting**

Run: `cargo fmt --manifest-path deeting/src-tauri/Cargo.toml`

Expected: PASS

**Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: chat input/send path, desktop runtime routing/execution files, message rendering, and plan docs only.
