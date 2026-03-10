# Chat Tool Block Sandbox Label Design

Date: 2026-03-10

## Summary
Only show the "sandbox execution" label in chat tool-call blocks when the tool is `execute_code_plan`. The label should not appear for `search_sdk` tool calls. This is a front-end-only change that filters label rendering by tool name.

## Goals
- In chat tool-call blocks, show the sandbox label only for `execute_code_plan`.
- Keep `search_sdk` tool calls visible, but without sandbox labeling.
- Avoid changing backend or Tauri persistence.

## Non-Goals
- Changing execution history (Code Mode execution list/detail) badges.
- Changing backend/Tauri execution records or runtime_mode semantics.
- Introducing new block types or schema changes.

## Scope
- Frontend chat tool-call block rendering logic only.
- Uses tool name in the tool-call block payload to decide whether to show the label.

## Proposed Behavior
- If tool-call block `toolName === "execute_code_plan"`, show "sandbox execution".
- Otherwise, do not show the sandbox label.
- If toolName is missing, default to not showing the label.

## Data Flow
- Tool-call blocks are streamed in chat; the UI already receives `toolName`.
- The UI label decision is computed at render time based on the tool name.

## Edge Cases
- toolName missing or unexpected casing: treat as not eligible.
- Future execution tools can be added by extending the allowlist.

## Testing
- Add/extend one UI test or snapshot:
  - tool-call with `search_sdk` => no sandbox label
  - tool-call with `execute_code_plan` => sandbox label

## Rollout
- Frontend-only change; no migration required.
- If label is missing in production, verify toolName payload first.
