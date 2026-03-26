# Browser Agent Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the browser-agent extension as a dedicated Git submodule under `packages/` with a localhost-bridge-ready MV3 scaffold.

**Architecture:** Keep desktop as the decision surface and create a dedicated browser-extension repository that exposes only a bounded browser action protocol. The extension is split into background bridge/policy/router code, page-level content execution code, and minimal popup/options placeholders for user approvals and configuration.

**Tech Stack:** Chrome Extension Manifest V3, TypeScript, WebSocket, Chrome runtime messaging, Git submodule layout.

---

### Task 1: Land the approved design artifacts

**Files:**
- Create: `docs/plans/2026-03-26-browser-agent-extension-design.md`
- Create: `docs/plans/2026-03-26-browser-agent-extension-implementation.md`

**Step 1: Write the design document**

Capture:
- desktop-local scope
- extension-only execution responsibility
- localhost bridge decision
- action schema and policy boundaries

**Step 2: Write the implementation plan**

Break the extension bootstrap into scaffold, protocol, policy, bridge, and verification tasks.

**Step 3: Verify documents exist**

Run: `ls docs/plans/2026-03-26-browser-agent-extension-*.md`
Expected: both files are listed.

### Task 2: Bootstrap the extension repository as a nested Git repo

**Files:**
- Create: `packages/deeting_chrome/.gitignore`
- Create: `packages/deeting_chrome/README.md`
- Create: `packages/deeting_chrome/package.json`
- Create: `packages/deeting_chrome/tsconfig.json`
- Create: `packages/deeting_chrome/manifest.json`

**Step 1: Initialize the nested repo**

Run: `git -C packages/deeting_chrome init -b main`

**Step 2: Attach the remote**

Run: `git -C packages/deeting_chrome remote add origin https://github.com/MarshallEriksen-Neura/deeting_chrome.git`

**Step 3: Add the basic repo files**

Create:
- repo README
- minimal TypeScript package metadata
- extension manifest
- ignore rules for `dist` and dependencies

**Step 4: Make the initial nested-repo commit**

Run: `git -C packages/deeting_chrome add . && git -C packages/deeting_chrome commit -m "chore: initialize browser agent extension scaffold"`

### Task 3: Add the shared protocol and policy-facing types

**Files:**
- Create: `packages/deeting_chrome/src/shared/actions.ts`
- Create: `packages/deeting_chrome/src/shared/protocol.ts`

**Step 1: Define action types**

Add:
- `BrowserAction`
- `ElementLocator`
- `PageSnapshot`

**Step 2: Define bridge messages**

Add:
- `hello`
- `command`
- `result`
- `event`
- `error`

**Step 3: Keep the protocol narrow**

Do not add:
- arbitrary code execution
- MCP abstractions
- skill abstractions

### Task 4: Add the background bridge shell

**Files:**
- Create: `packages/deeting_chrome/src/background/index.ts`
- Create: `packages/deeting_chrome/src/background/bridge.ts`
- Create: `packages/deeting_chrome/src/background/router.ts`
- Create: `packages/deeting_chrome/src/background/policy.ts`
- Create: `packages/deeting_chrome/src/background/store.ts`

**Step 1: Add bridge connection shell**

Implement:
- localhost WebSocket connect
- hello handshake
- reconnect timer

**Step 2: Add router shell**

Route:
- tab-level actions to Chrome APIs
- page-level actions to the content script

**Step 3: Add policy shell**

Model:
- allowed domains
- risk levels
- placeholder approval requirement

### Task 5: Add the content execution shell

**Files:**
- Create: `packages/deeting_chrome/src/content/index.ts`
- Create: `packages/deeting_chrome/src/content/extract.ts`
- Create: `packages/deeting_chrome/src/content/execute.ts`

**Step 1: Add snapshot extraction**

Return:
- title
- URL
- visible text
- interactive element summaries

**Step 2: Add basic action handlers**

Handle:
- `query_dom`
- `click`
- `type`
- `scroll`

**Step 3: Keep execution bounded**

Reject unknown actions and avoid arbitrary selector execution patterns beyond the typed locator contract.

### Task 6: Add minimal popup and options placeholders

**Files:**
- Create: `packages/deeting_chrome/src/popup/index.ts`
- Create: `packages/deeting_chrome/src/options/index.ts`

**Step 1: Add placeholder entry files**

These files only establish the intended surfaces for:
- connection state
- policy state
- pending approvals

### Task 7: Register the nested repo as a parent-repo submodule

**Files:**
- Modify: `.gitmodules`

**Step 1: Add the new submodule entry**

Add:
- path `packages/deeting_chrome`
- URL `https://github.com/MarshallEriksen-Neura/deeting_chrome.git`
- branch `main`

**Step 2: Stage the gitlink**

Run: `git add .gitmodules packages/deeting_chrome`
Expected: parent repo records `packages/deeting_chrome` as mode `160000`.

### Task 8: Verify bootstrap state

**Files:**
- None

**Step 1: Verify nested repo status**

Run: `git -C packages/deeting_chrome status --short`
Expected: clean working tree after the initial commit.

**Step 2: Verify parent repo submodule state**

Run: `git status --short`
Expected: `.gitmodules` modified and `packages/deeting_chrome` staged as a gitlink without disturbing unrelated user changes.

**Step 3: Optional remote publish**

Run: `git -C packages/deeting_chrome push -u origin main`
Expected: success if local credentials are available; if not, report that the nested repo is initialized locally but not yet published remotely.
