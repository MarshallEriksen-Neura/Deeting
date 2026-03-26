# Browser Runtime Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first reliability substrate for the browser runtime so backend page inspection and multi-step click flows feel dependable, visible, and recoverable.

**Architecture:** Extend the existing desktop-local browser tool lane with a small set of reliability primitives (`wait_for_element`, `wait_for_navigation`, `scroll_into_view`, `retry_with_relocate`) and expose their execution state in the browser mode panel. Keep the current split intact: desktop runtime decides, extension executes, chat/workspace presents state.

**Tech Stack:** Tauri desktop runtime, Rust browser-agent module, Chrome extension background/content scripts, Next.js App Router, React 19, Zustand, next-intl

---

### Task 1: Add `wait_for_element` contract and tests

**Files:**
- Modify: `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/types.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/service.rs`
- Create or modify tests under `deeting/src-tauri/src/modules/browser_agent/`

**Step 1: Write the failing test**

Add a Rust unit test that asserts a new browser action can wait for an element with:

- `tab_id`
- target locator fields
- timeout and polling hints

and returns a structured result with `ok`, `matched`, `visible`, and page metadata.

**Step 2: Run test to verify it fails**

Run the smallest Rust test command that exercises the touched browser-agent test module.

Expected: FAIL because `wait_for_element` does not exist in the contract or dispatcher.

**Step 3: Write minimal implementation**

- add the new tool contract
- add runtime dispatch resolution
- define the new browser action/result type
- add the service entrypoint

Do not implement recovery yet.

**Step 4: Run test to verify it passes**

Run the same targeted Rust test command.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs deeting/src-tauri/src/modules/browser_agent/types.rs deeting/src-tauri/src/modules/browser_agent/service.rs
git commit -m "feat: add browser wait_for_element runtime contract"
```

### Task 2: Implement extension-side `wait_for_element`

**Files:**
- Modify: `packages/deeting_chrome/src/shared/actions.ts`
- Modify: `packages/deeting_chrome/src/content/index.ts`
- Create or modify: `packages/deeting_chrome/src/content/wait.ts`
- Modify: `packages/deeting_chrome/src/background/router.ts`
- Create tests under `packages/deeting_chrome/src/content/` or `src/background/`

**Step 1: Write the failing extension test**

Cover:

- polling for an element until it appears
- returning the matched locator detail
- timing out cleanly when no target appears

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/packages/deeting_chrome && bun test`

Expected: FAIL because the action is not implemented.

**Step 3: Write minimal implementation**

- add action shape
- implement DOM polling in the content script
- route the action through background to content

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/packages/deeting_chrome && bun test`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/deeting_chrome/src/shared/actions.ts packages/deeting_chrome/src/content/index.ts packages/deeting_chrome/src/content/wait.ts packages/deeting_chrome/src/background/router.ts
git commit -m "feat: add browser wait_for_element extension support"
```

### Task 3: Add `wait_for_navigation` contract and implementation

**Files:**
- Modify: `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/types.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/service.rs`
- Modify: `packages/deeting_chrome/src/shared/actions.ts`
- Modify: `packages/deeting_chrome/src/background/router.ts`
- Add extension-side wait implementation/tests

**Step 1: Write the failing tests**

Cover:

- URL or title change detection
- timeout without change
- readyState waiting

**Step 2: Run tests to verify they fail**

Run targeted Rust and extension tests.

Expected: FAIL because navigation-wait logic does not exist.

**Step 3: Write minimal implementation**

- add tool and browser action contracts
- implement navigation observation on the extension side
- return structured state including `url`, `title`, `documentReadyState`, and `changed`

**Step 4: Run tests to verify they pass**

Run the same targeted test commands.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs deeting/src-tauri/src/modules/browser_agent/types.rs deeting/src-tauri/src/modules/browser_agent/service.rs packages/deeting_chrome/src/shared/actions.ts packages/deeting_chrome/src/background/router.ts
git commit -m "feat: add browser wait_for_navigation support"
```

### Task 4: Add `scroll_into_view`

**Files:**
- Modify: `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/types.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/service.rs`
- Modify: `packages/deeting_chrome/src/shared/actions.ts`
- Modify: `packages/deeting_chrome/src/content/index.ts`
- Create or modify scroll tests

**Step 1: Write the failing tests**

Cover:

- scrolling target into view before interaction
- reporting success and visibility

**Step 2: Run tests to verify they fail**

Run targeted Rust and extension tests.

Expected: FAIL because the action does not exist.

**Step 3: Write minimal implementation**

- add the new action/tool contract
- implement DOM `scrollIntoView` behavior in the content script
- return structured result

**Step 4: Run tests to verify they pass**

Run the same targeted test commands.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs deeting/src-tauri/src/modules/browser_agent/types.rs deeting/src-tauri/src/modules/browser_agent/service.rs packages/deeting_chrome/src/shared/actions.ts packages/deeting_chrome/src/content/index.ts
git commit -m "feat: add browser scroll_into_view action"
```

### Task 5: Add `retry_with_relocate` orchestration on the desktop side

**Files:**
- Modify: `deeting/src-tauri/src/modules/browser_agent/service.rs`
- Modify: `deeting/src-tauri/src/modules/browser_agent/types.rs`
- Add targeted tests under `deeting/src-tauri/src/modules/browser_agent/`

**Step 1: Write the failing test**

Cover:

- first attempt fails
- service requests a fresh snapshot or fresh target resolution path
- second bounded retry succeeds or returns a structured failure

**Step 2: Run the test to verify it fails**

Run the targeted Rust test module.

Expected: FAIL because retry/re-locate orchestration does not exist.

**Step 3: Write minimal implementation**

- keep retry orchestration on the desktop side
- re-snapshot and re-locate once within bounded attempts
- never auto-repeat a high-risk action silently

**Step 4: Run the test to verify it passes**

Run the same targeted Rust test command.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/browser_agent/service.rs deeting/src-tauri/src/modules/browser_agent/types.rs
git commit -m "feat: add browser retry with relocate flow"
```

### Task 6: Surface execution-state and recovery-state in browser mode UI

**Files:**
- Modify: `deeting/store/browser-mode-store.ts`
- Modify: `deeting/components/workspace/browser-mode-panel.tsx`
- Modify: `deeting/hooks/chat/use-browser-mode-status.ts`
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`
- Create or extend tests under `deeting/components/workspace/__tests__/`

**Step 1: Write the failing UI tests**

Cover:

- `waiting`
- `acting`
- `verifying`
- `recovering`
- retry count or recovery reason visibility

**Step 2: Run tests to verify they fail**

Run the targeted workspace/browser-mode tests.

Expected: FAIL because the panel does not yet present runtime execution phases.

**Step 3: Write minimal implementation**

- extend browser mode store state with execution-phase fields
- render concise runtime status in the panel
- show waiting and recovery reasons in plain language

**Step 4: Run tests to verify they pass**

Run the same targeted UI tests.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/store/browser-mode-store.ts deeting/components/workspace/browser-mode-panel.tsx deeting/hooks/chat/use-browser-mode-status.ts deeting/messages/en/chat.json deeting/messages/zh-CN/chat.json
git commit -m "feat: show browser runtime execution phases"
```

### Task 7: Re-approval protection after recovery for high-risk browser actions

**Files:**
- Modify: `deeting/lib/chat/tool-approval.ts`
- Modify: `deeting/components/bridge/tool-approval-dialog.tsx`
- Add tests under `deeting/lib/chat/__tests__/` and `deeting/components/bridge/__tests__/`

**Step 1: Write the failing tests**

Cover:

- a high-risk browser action that fails and enters recovery
- reconnect/retry path does not auto-run the same high-risk step
- the user gets a fresh approval boundary

**Step 2: Run tests to verify they fail**

Run the targeted approval tests.

Expected: FAIL because recovery-aware re-approval rules are not implemented.

**Step 3: Write minimal implementation**

- mark recovery-resumed browser approvals distinctly
- require a fresh approval boundary for high-risk actions after recovery

**Step 4: Run tests to verify they pass**

Run the same targeted approval tests.

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/lib/chat/tool-approval.ts deeting/components/bridge/tool-approval-dialog.tsx
git commit -m "feat: require fresh approval after browser recovery"
```

### Task 8: Final verification and docs

**Files:**
- Modify: `deeting/content/docs/en/desktop-features.mdx`
- Modify: `deeting/content/docs/zh-CN/desktop-features.mdx` or nearest browser-mode docs

**Step 1: Run targeted verification**

Run:

- targeted Rust browser-agent tests
- `cd /data/Deeting/packages/deeting_chrome && bun test`
- `cd /data/Deeting/packages/deeting_chrome && bun run typecheck`
- targeted frontend Jest tests for browser mode and approvals

**Step 2: Manual smoke**

Verify:

- backend page inspection waits for readiness
- next/confirm flow waits for target appearance
- click flow verifies navigation
- broken target triggers recover-and-retry once
- recovery of high-risk action asks again

**Step 3: Update docs**

Add concise user-facing explanation of:

- waiting behavior
- recovery behavior
- approval after recovery

**Step 4: Commit**

```bash
git add deeting/content/docs/en/desktop-features.mdx deeting/content/docs/zh-CN/desktop-features.mdx
git commit -m "docs: describe browser runtime reliability behaviors"
```
