# Chat Browser Mode Productization Design

Updated: 2026-03-26
Status: approved product direction
Scope: `desktop local + chat-first browser mode`

## 1. Positioning

This document defines how the existing desktop-local browser agent becomes a user-facing product surface.

It does not redefine:

- the browser extension as an independent product entry
- cloud-owned browser execution
- arbitrary JavaScript execution
- a second standalone "browser agent page" for end users

The product cut is chat-first: browser execution is a visible execution lane inside desktop chat, not a separate destination.

## 2. Core Product Decision

The browser experience keeps the existing split:

- chat is the primary entry
- desktop local runtime is the decision engine
- the Chrome extension is the bounded browser executor

But the product layer must stop exposing the current debug mental model:

- users should not manage `tabId`
- users should not manually type selectors
- users should not depend on the Settings debug panel to start browser work

## 3. Primary UX

The default entry remains `/chat`.

When the user asks for something that clearly needs browser execution, the desktop runtime should not silently take over the browser on first use. Instead it should show a lightweight confirmation bar in chat.

Suggested actions:

- `Enter Browser Mode`
- `Not now`

The confirmation bar should explain:

- the task needs browser assistance
- the desktop app will connect to the local Chrome extension
- actions remain bounded and approval-aware

This confirmation is only for entering browser mode for the current task flow. It should not re-ask on every low-level browser step.

## 4. Browser Mode Surface

Once the user confirms, chat should open a visible right-side browser mode panel instead of redirecting to a separate page.

The existing chat `WorkspaceShell` is the right host surface for this panel because it already supports an optional right workspace that expands only when a view is active.

The browser mode panel has four responsibilities only:

- connection state
- current page / current tab context
- execution timeline
- human control actions

The panel should not expose debug controls such as raw `tabId`, raw selector forms, or manual action buttons intended for developers.

## 5. State Model

Browser mode should behave as a small state machine:

- `idle`
  - no browser work is active
- `pending_confirmation`
  - chat identified browser work and is waiting for the user to enter browser mode
- `connecting`
  - desktop is checking bridge health and extension session availability
- `active`
  - browser work is executing and the right-side panel is visible
- `paused`
  - execution is intentionally paused by the user or blocked on approval
- `recovering`
  - connection dropped and the runtime is attempting to restore page context
- `ended`
  - browser task flow completed or was explicitly dismissed

These states should be visible to the user in plain language rather than as transport diagnostics.

## 6. Approval Model

Product behavior should use risk-tiered approvals instead of either silent execution or step-by-step prompts.

Recommended tiers:

- low risk
  - page snapshot
  - read visible text
  - list buttons/links
  - ordinary scroll
- medium risk
  - open a new page
  - navigate a page
  - type into an input without submission
- high risk
  - click submit/publish/send/delete/pay
  - perform credential-sensitive actions
  - trigger a download or upload

Low-risk actions run without interruption but remain visible in the browser mode timeline.

Medium-risk actions use a lightweight inline confirmation in the chat flow or browser mode panel.

High-risk actions require a hard approval gate and must be described in human-readable terms such as:

- `Click the "Continue" button`
- `Type your email into the "Email" field`

The product should avoid exposing raw selector syntax to ordinary users.

## 7. Recovery Model

Connection instability must be treated as a first-class product case, not an edge condition.

The browser mode experience must distinguish:

- bridge is listening but no extension session is connected
- extension disconnected during execution
- page changed and the old target can no longer be resumed safely

Recommended recovery behavior:

- if browser mode starts and the extension is not connected
  - show action-oriented recovery UI with `Retry connection`, `Open extension`, and installation help
- if the extension disconnects mid-task
  - pause further browser actions immediately
  - tell the user execution is paused
  - offer `Reconnect and continue` or `End browser task`
- after reconnection
  - refresh current tab and URL
  - fetch a fresh page snapshot
  - re-resolve the intended target before continuing
- after reconnection
  - never auto-resume a high-risk action without a fresh user approval

## 8. Settings And Diagnostics

The current `Browser Agent Debug Panel` in Settings should remain, but its role changes.

It becomes:

- a developer diagnostic surface
- a setup / troubleshooting fallback
- a place to inspect raw bridge state

It should no longer be treated as the intended user entry for browser-powered tasks.

## 9. Architecture Seams

The productized flow should reuse existing seams rather than inventing a separate browser product stack.

Primary seams:

- chat entry and controls
  - `deeting/app/[locale]/chat/*`
  - `deeting/components/chat/console/controls-container.tsx`
- right-side product surface
  - `deeting/components/common/workspace/workspace-shell.tsx`
  - `deeting/components/workspace/*`
  - `deeting/store/workspace-store.ts`
- browser transport and status
  - `deeting/lib/api/browser-agent.ts`
  - `deeting/src-tauri/src/modules/browser_agent/*`
  - `packages/deeting_chrome/src/background/*`
- approval plumbing
  - `deeting/components/bridge/tool-approval-dialog.tsx`
  - `deeting/lib/chat/tool-approval.ts`
  - `deeting/lib/chat/bridge-approval-store.ts`

This allows browser mode to be introduced as a visible chat execution lane without replacing the existing local-runtime tool architecture.

## 10. Rollout Plan

The safest product rollout is staged:

1. stabilize extension connection and reconnection behavior
2. add chat confirmation bar for first-time browser-mode entry
3. add browser mode panel in the right workspace
4. refine risk-tiered approvals for browser-specific actions
5. downgrade the Settings debug panel from pseudo-entry to diagnostics only

## 11. Out Of Scope

This design does not include:

- cloud browser sessions
- multi-browser support
- arbitrary browser scripting
- collaborative shared browser sessions
- replacing existing generic tool approval architecture across the whole app

## 12. Success Criteria

The feature is product-ready when:

1. a desktop user can trigger browser work directly from chat
2. first entry uses a clear confirmation bar rather than silent takeover
3. the right-side browser mode panel shows live connection, page, and execution state
4. unstable extension connectivity degrades into a clear recovery flow rather than opaque errors
5. high-risk browser actions require explicit approval in human-readable language
6. the Settings debug panel is no longer required for ordinary browser-task usage
