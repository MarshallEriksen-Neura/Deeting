# Browser Agent Extension Design

Updated: 2026-03-26
Status: approved architecture
Scope: `desktop local + browser extension`

## 1. Positioning

This document is intentionally narrowed to the browser-extension execution lane.

It does not define:

- user-configurable MCP servers for the browser agent
- user-configurable skills for the browser agent
- cloud-owned browser execution
- arbitrary JavaScript execution from AI output

The goal is to make the desktop app the decision engine while a browser extension acts as a bounded executor.

## 2. Core Decision

The browser agent must follow a strict split:

- desktop AI is the brain
- the browser extension is the hand
- the extension executes only a fixed action schema

The browser extension is not a generic tool runtime. Users configure browsing policy, not MCP or skill infrastructure.

## 3. Architecture

The extension uses Manifest V3 with three layers:

- `background service worker`
  - owns the localhost bridge to desktop
  - validates policy
  - maps actions to browser APIs or content-script execution
  - tracks session, request, and tab state
- `content script`
  - extracts structured page snapshots
  - performs page-local actions such as click, type, query, and scroll
  - never talks to desktop directly
- `popup/options`
  - shows connection state, domain allowlist, and pending approvals
  - does not participate in orchestration

## 4. Local Bridge

The first iteration uses a localhost bridge from the extension background worker to the desktop runtime.

Recommended transport:

- `background <-> desktop`: WebSocket
- `background <-> content script`: `chrome.runtime` messaging

This keeps the browser side event-friendly while reusing the existing desktop-local architecture.

## 5. Command Model

Desktop sends only structured browser actions. The extension returns only structured results or structured errors.

Initial action surface:

- `open_tab`
- `navigate_tab`
- `get_page_snapshot`
- `query_dom`
- `click`
- `type`
- `scroll`

The extension must reject:

- arbitrary JS execution
- raw tool text commands
- untyped payloads

## 6. Snapshot Model

`get_page_snapshot` returns a bounded, structured view of the page:

- `url`
- `title`
- `documentReadyState`
- `visibleText`
- `mainText`
- `headings`
- `links`
- `buttons`
- `inputs`
- `forms`

The extension should prefer visible and interactive information over raw DOM dumps.

## 7. Policy Model

Users configure browsing policy rather than execution infrastructure.

Allowed configuration categories:

- allowed domains
- action allowlist
- high-risk confirmation rules
- automatic versus manual execution mode

Disallowed configuration categories:

- MCP server binding
- skill binding
- arbitrary local command execution
- arbitrary remote tool registration

## 8. Risk Boundaries

Actions are classified into three levels:

- low: read/query/scroll
- medium: open page, ordinary click, ordinary typing
- high: submit, publish, send, delete, checkout, credential entry, file transfer

High-risk actions require explicit approval in the extension surface. The extension is responsible for enforcing this before execution.

## 9. Repo Layout

The browser agent lives in a dedicated Git repository under `packages/deeting_chrome` as a Git submodule.

Initial structure:

- `manifest.json`
- `package.json`
- `tsconfig.json`
- `README.md`
- `src/shared/*`
- `src/background/*`
- `src/content/*`
- `src/popup/*`
- `src/options/*`

## 10. MVP Closure

The MVP is complete when the following flow works:

1. desktop sends `open_tab`
2. extension opens a tab
3. desktop requests `get_page_snapshot`
4. extension returns structured page content
5. desktop sends `click` or `type`
6. extension executes the action or blocks it with policy
