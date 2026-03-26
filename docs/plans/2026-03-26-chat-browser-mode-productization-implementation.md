# Chat Browser Mode Productization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing desktop-local browser agent into a chat-first browser mode with a first-use confirmation bar, a right-side browser mode panel, risk-aware approvals, and connection recovery.

**Architecture:** Keep browser execution as direct desktop-local core tools and extension transport, but add a product layer in chat. The chat route remains the single entry, while a new browser-mode UI state opens a right workspace panel and reuses existing approval plumbing instead of treating Settings as the primary entry.

**Tech Stack:** Next.js App Router, React 19, Zustand, next-intl, Tauri desktop runtime, Rust browser-agent module, Manifest V3 Chrome extension

---

### Task 1: Define browser mode frontend state

**Files:**
- Create: `deeting/store/browser-mode-store.ts`
- Modify: `deeting/store/__tests__/chat-store.test.ts` or add a dedicated browser mode store test if a local pattern exists

**Step 1: Write the failing store test**

Create a focused store test that asserts:

- entering `pending_confirmation` records the originating chat intent
- confirming transitions to `connecting`
- successful activation stores current tab/page metadata and opens the panel
- disconnect transitions to `recovering` or `paused`
- ending browser mode clears state but preserves a summary object if needed

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- store/__tests__/browser-mode-store.test.ts`

Expected: FAIL because the store file and browser mode state machine do not exist yet.

**Step 3: Write the minimal implementation**

Create `deeting/store/browser-mode-store.ts` with:

- browser mode states: `idle`, `pending_confirmation`, `connecting`, `active`, `paused`, `recovering`, `ended`
- actions to request browser mode, confirm, decline, activate, pause, mark disconnected, recover, and end
- plain-language metadata for connection status, current page, and last action summary

Keep the store independent from the existing generic approval store.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- store/__tests__/browser-mode-store.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/store/browser-mode-store.ts deeting/store/__tests__/browser-mode-store.test.ts
git commit -m "feat: add chat browser mode state store"
```

### Task 2: Detect browser-mode intent and show the first-use confirmation bar

**Files:**
- Modify: `deeting/components/chat/console/controls-container.tsx`
- Create: `deeting/components/chat/browser-mode/browser-mode-confirmation-bar.tsx`
- Create: `deeting/components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx`
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`

**Step 1: Write the failing component test**

Cover:

- a browser-mode confirmation bar renders when browser mode state is `pending_confirmation`
- the bar shows `Enter Browser Mode` and `Not now`
- confirming calls the store transition
- dismissing returns to idle without opening browser mode

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx`

Expected: FAIL because the new confirmation component and strings do not exist.

**Step 3: Write the minimal implementation**

- add a lightweight browser-intent detector inside `controls-container.tsx`
- only trigger `pending_confirmation` when running in Tauri and the prompt clearly requests browser execution
- render `BrowserModeConfirmationBar` above the normal chat controls
- localize copy in `messages/en/chat.json` and `messages/zh-CN/chat.json`

Do not auto-enter browser mode yet; require explicit confirmation.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/components/chat/browser-mode/browser-mode-confirmation-bar.tsx deeting/components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx deeting/components/chat/console/controls-container.tsx deeting/messages/en/chat.json deeting/messages/zh-CN/chat.json
git commit -m "feat: add browser mode entry confirmation bar"
```

### Task 3: Add the right-side browser mode panel in chat workspace

**Files:**
- Create: `deeting/components/workspace/browser-mode-panel.tsx`
- Create: `deeting/components/workspace/browser-mode-panel-view.tsx`
- Create: `deeting/components/workspace/__tests__/browser-mode-panel.test.tsx`
- Modify: `deeting/store/workspace-store.ts`
- Modify: `deeting/components/workspace/workspace-view-renderer.tsx`
- Modify: `deeting/components/workspace/workspace-panel.tsx`
- Modify: `deeting/components/common/workspace/workspace-shell.tsx`

**Step 1: Write the failing workspace test**

Cover:

- confirming browser mode opens a dedicated workspace view
- the panel displays connection state, current page, and last action
- the panel exposes `Pause`, `Reconnect`, and `End`
- the panel does not expose raw debug controls like `tabId` or selector forms

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-panel.test.tsx`

Expected: FAIL because the browser mode panel and workspace view type are missing.

**Step 3: Write the minimal implementation**

- extend `WorkspaceViewType` with a dedicated browser mode panel view
- add a renderer branch for the browser mode panel
- open the browser mode panel from the browser mode store once the user confirms
- show:
  - connection state
  - current page title / host / URL
  - last action or execution timeline summary
  - primary controls for pause, reconnect, and end

Keep the panel product-focused; do not move the existing Settings debug panel into workspace.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-panel.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/components/workspace/browser-mode-panel.tsx deeting/components/workspace/browser-mode-panel-view.tsx deeting/components/workspace/__tests__/browser-mode-panel.test.tsx deeting/store/workspace-store.ts deeting/components/workspace/workspace-view-renderer.tsx deeting/components/workspace/workspace-panel.tsx deeting/components/common/workspace/workspace-shell.tsx
git commit -m "feat: add browser mode workspace panel"
```

### Task 4: Bridge browser mode UI state to real browser-agent status

**Files:**
- Modify: `deeting/lib/api/browser-agent.ts`
- Create: `deeting/hooks/chat/use-browser-mode-status.ts`
- Create: `deeting/hooks/chat/__tests__/use-browser-mode-status.test.tsx`
- Modify: `deeting/app/[locale]/settings/components/desktop-browser-agent-panel-card.tsx`

**Step 1: Write the failing hook test**

Cover:

- browser mode entering `connecting` requests current bridge status
- a `connected` bridge updates browser mode to `active`
- a listening bridge with zero sessions yields an actionable `extension_not_connected` product state
- status refreshes can be triggered from the workspace panel

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- hooks/chat/__tests__/use-browser-mode-status.test.tsx`

Expected: FAIL because the hook does not exist and the productized status mapping is missing.

**Step 3: Write the minimal implementation**

- add browser-mode-focused status helpers around `getLocalBrowserAgentBridgeStatus()`
- create `use-browser-mode-status.ts` to normalize:
  - bridge listening with zero sessions
  - active extension session
  - disconnected / recovering state
- keep the Settings debug panel intact, but do not let it remain the main product surface

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- hooks/chat/__tests__/use-browser-mode-status.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/lib/api/browser-agent.ts deeting/hooks/chat/use-browser-mode-status.ts deeting/hooks/chat/__tests__/use-browser-mode-status.test.tsx deeting/app/[locale]/settings/components/desktop-browser-agent-panel-card.tsx
git commit -m "feat: normalize browser mode status for chat UX"
```

### Task 5: Add browser-specific approval presentation on top of the existing approval pipeline

**Files:**
- Modify: `deeting/lib/chat/bridge-approval-store.ts`
- Modify: `deeting/lib/chat/tool-approval.ts`
- Modify: `deeting/components/bridge/tool-approval-dialog.tsx`
- Create: `deeting/lib/chat/__tests__/browser-tool-approval.test.ts`
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`

**Step 1: Write the failing approval test**

Cover:

- browser tool approvals preserve tool id and risk level
- browser actions render human-readable descriptions rather than raw selectors
- reconnecting after a disconnect does not auto-resume high-risk browser actions

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- lib/chat/__tests__/browser-tool-approval.test.ts`

Expected: FAIL because browser-specific formatting and revalidation rules do not exist.

**Step 3: Write the minimal implementation**

- enrich pending approval data with browser-action presentation helpers
- update `ToolApprovalDialog` to show browser action copy such as:
  - `Click the "Continue" button`
  - `Type into the "Email" field`
- keep the generic approval architecture, but add browser-specific formatting and reapproval rules

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- lib/chat/__tests__/browser-tool-approval.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/lib/chat/bridge-approval-store.ts deeting/lib/chat/tool-approval.ts deeting/components/bridge/tool-approval-dialog.tsx deeting/lib/chat/__tests__/browser-tool-approval.test.ts deeting/messages/en/chat.json deeting/messages/zh-CN/chat.json
git commit -m "feat: add browser-specific approval copy and gating"
```

### Task 6: Productize disconnect and recovery flows

**Files:**
- Modify: `deeting/store/browser-mode-store.ts`
- Modify: `deeting/components/workspace/browser-mode-panel.tsx`
- Modify: `deeting/hooks/chat/use-browser-mode-status.ts`
- Create: `deeting/components/workspace/__tests__/browser-mode-recovery.test.tsx`

**Step 1: Write the failing recovery test**

Cover:

- disconnect during active browser mode pauses execution
- reconnect attempts move state to `recovering`
- recovery refreshes page context before continuing
- high-risk actions require a new approval after recovery

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-recovery.test.tsx`

Expected: FAIL because recovery state transitions and recovery UI do not exist.

**Step 3: Write the minimal implementation**

- add recovery actions to the browser mode store
- update the browser mode panel to expose `Reconnect and continue` and `End browser task`
- when reconnecting:
  - refresh bridge state
  - fetch current tab/page snapshot if available
  - only resume non-high-risk actions automatically

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-recovery.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/store/browser-mode-store.ts deeting/components/workspace/browser-mode-panel.tsx deeting/hooks/chat/use-browser-mode-status.ts deeting/components/workspace/__tests__/browser-mode-recovery.test.tsx
git commit -m "feat: add browser mode recovery flow"
```

### Task 7: Stabilize the Chrome extension connection lifecycle for product use

**Files:**
- Modify: `packages/deeting_chrome/src/background/bridge.ts`
- Modify: `packages/deeting_chrome/src/background/index.ts`
- Modify: `packages/deeting_chrome/src/popup/index.ts`
- Modify: `packages/deeting_chrome/src/options/index.ts`
- Create: `packages/deeting_chrome/src/background/bridge.test.ts`

**Step 1: Write the failing extension test**

Cover:

- popup or options page can request an explicit `ensureConnected`
- background reports `connecting`, `connected`, `idle`, and `error` transitions consistently
- background reconnects after socket close
- product surfaces do not depend on stale popup-rendered state alone

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/packages/deeting_chrome && bun test`

Expected: FAIL because the current background bridge only connects opportunistically during service-worker startup and does not expose an explicit wake/reconnect path.

**Step 3: Write the minimal implementation**

- refactor the extension bridge into an explicit connection manager with:
  - `ensureConnected`
  - duplicate-connection protection
  - consistent state writes
- let popup/options send a message that wakes the background and requests connection
- preserve the localhost WebSocket model; do not redesign transport in this step

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/packages/deeting_chrome && bun test`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/deeting_chrome/src/background/bridge.ts packages/deeting_chrome/src/background/index.ts packages/deeting_chrome/src/popup/index.ts packages/deeting_chrome/src/options/index.ts packages/deeting_chrome/src/background/bridge.test.ts
git commit -m "feat: stabilize browser agent extension reconnect flow"
```

### Task 8: Validate the integrated chat-first browser mode flow

**Files:**
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`
- Modify: `deeting/content/docs/en/desktop-features.mdx`
- Modify: `deeting/content/docs/zh-CN/desktop-features.mdx` (if present; otherwise update the nearest desktop/browser docs)

**Step 1: Write the failing integration checklist**

Document the manual acceptance path in the plan task notes:

- open desktop chat
- trigger a browser-needed task
- confirm browser mode
- verify the workspace panel opens
- verify status transitions for connected vs disconnected extension
- verify a medium-risk and a high-risk approval
- verify reconnect and recovery

**Step 2: Run the targeted verifications**

Run:

- `cd /data/Deeting/deeting && bun run test -- components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx`
- `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-panel.test.tsx`
- `cd /data/Deeting/deeting && bun run test -- components/workspace/__tests__/browser-mode-recovery.test.tsx`
- `cd /data/Deeting/deeting && bun run test -- lib/chat/__tests__/browser-tool-approval.test.ts`
- `cd /data/Deeting/packages/deeting_chrome && bun test`

Expected: PASS on all touched tests

**Step 3: Update product-facing docs**

- explain that browser work starts from chat
- describe first-use confirmation, workspace panel, approvals, and recovery
- position Settings browser-agent UI as diagnostics/setup, not as the main user flow

**Step 4: Run a final desktop smoke**

Manual smoke:

1. open desktop app
2. load the unpacked Chrome extension
3. ask chat to open a page
4. confirm browser mode
5. verify panel opens and status is visible
6. disconnect extension and verify recovery flow

Expected: end-to-end browser mode works from chat without depending on the Settings debug panel.

**Step 5: Commit**

```bash
git add deeting/messages/en/chat.json deeting/messages/zh-CN/chat.json deeting/content/docs/en/desktop-features.mdx deeting/content/docs/zh-CN/desktop-features.mdx
git commit -m "docs: describe chat-first browser mode"
```
