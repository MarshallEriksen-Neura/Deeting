# Browser Runtime Reliability Design

Updated: 2026-03-26
Status: approved design
Scope: `desktop local + browser runtime substrate`

## 1. Goal

This design defines the next stage after browser mode productization.

The objective is not to add a large number of new browser actions immediately.

The objective is to make the existing browser lane feel dependable enough that users trust it for:

- backend page inspection and extraction
- multi-step click flows such as next, confirm, and submit

## 2. Core Decision

The next phase should prioritize shared runtime primitives rather than isolated feature additions.

Instead of first adding many new browser commands, the runtime should gain a small reliability substrate that makes both read-heavy and action-heavy workflows stronger.

The first batch is:

- `wait_for_element`
- `wait_for_navigation`
- `scroll_into_view`
- `retry_with_relocate`

This is the highest-leverage cut because it improves:

- page inspection stability
- action sequencing reliability
- reconnect and recovery behavior
- user trust in the browser lane

## 3. Product Outcome

When this phase is complete, the product should feel different in three user-visible ways.

### 3.1 It waits instead of guessing

The browser lane should no longer jump immediately from intent to click.

The user should see status such as:

- waiting for page load
- waiting for target button
- confirming page transition

### 3.2 It retries in a bounded, explainable way

When an action fails because the page changed or the target moved, the system should:

1. pause the step
2. refresh its page understanding
3. re-locate the target
4. retry once within bounded rules

The user should see that recovery is happening rather than receiving a generic failure.

### 3.3 It shows execution state, not only final state

The browser mode panel should show:

- current step
- current runtime state
- retry count
- recovery reason when applicable

This is the behavioral shift from "a tool was called" to "a task is being executed."

## 4. First-Batch Runtime Contracts

### 4.1 `wait_for_element`

Purpose:

- ensure a target exists before click or type

Input:

- `tab_id`
- `target`
- `timeout_ms`
- `poll_interval_ms`

Target fields:

- `selector`
- `text`
- `role`
- `tag_name`
- `placeholder`

Output:

- `ok`
- `matched`
- `locator`
- `visible`
- `url`
- `title`

### 4.2 `wait_for_navigation`

Purpose:

- confirm a post-click or post-navigation state change instead of assuming success

Input:

- `tab_id`
- `timeout_ms`
- optional `expected_url_contains`
- optional `expected_title_contains`
- optional `wait_for_ready_state`

Output:

- `ok`
- `url`
- `title`
- `documentReadyState`
- `changed`

### 4.3 `scroll_into_view`

Purpose:

- make the target interactable before click or type

Input:

- `tab_id`
- `target`
- optional `align`

Output:

- `ok`
- `locator`
- `visible`

### 4.4 `retry_with_relocate`

Purpose:

- recover from stale or shifted targets without silently looping forever

Input:

- `tab_id`
- `action`
- `target`
- `max_attempts`

Internal flow:

1. action fails
2. re-snapshot the page
3. re-locate the target
4. retry within bounded attempts

Output:

- `ok`
- `attempts`
- `recovered`
- `final_error`
- `last_snapshot_summary`

## 5. Product State Additions

The browser mode panel should gain four execution states:

- `waiting`
- `acting`
- `verifying`
- `recovering`

These are runtime presentation states, not transport states.

Examples:

- waiting: waiting for target button to appear
- acting: clicking Continue
- verifying: confirming page transition
- recovering: re-snapshotting page and re-locating target

## 6. Recovery Rules

Recovery must be bounded and understandable.

### 6.1 Safe automatic recovery

Allowed:

- re-snapshot page
- re-locate target
- retry a low- or medium-risk action once within configured bounds

### 6.2 Forbidden silent recovery

Not allowed:

- silently repeat a high-risk action after recovery
- continue an approval-gated action without a fresh user confirmation

If recovery reaches a high-risk action boundary again, the approval step must reappear.

## 7. Architecture Seams

This phase should continue using the existing split:

- desktop runtime decides
- extension executes
- chat and browser mode panel show product state

Primary seams:

- browser runtime API layer
  - `deeting/lib/api/browser-agent.ts`
- browser mode panel / chat product surface
  - `deeting/components/workspace/browser-mode-panel.tsx`
  - `deeting/hooks/chat/use-browser-mode-status.ts`
  - `deeting/store/browser-mode-store.ts`
- extension execution lane
  - `packages/deeting_chrome/src/background/router.ts`
  - `packages/deeting_chrome/src/content/*`
- desktop browser-agent service and tool contracts
  - `deeting/src-tauri/src/modules/browser_agent/*`
  - `deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs`
  - `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`

## 8. Rollout Order

Recommended implementation order:

1. `wait_for_element`
2. `wait_for_navigation`
3. `scroll_into_view`
4. `retry_with_relocate`
5. browser mode panel execution-state and retry-state presentation

This order minimizes surface area while producing visible user benefit early.

## 9. Out Of Scope

This phase does not yet include:

- multi-tab orchestration
- file upload
- select/dropdown automation
- screenshot and visual verification
- arbitrary browser scripting
- cloud browser sessions

Those may come later, but should not block the shared reliability substrate.

## 10. Success Criteria

This phase is successful when:

1. the browser lane visibly waits for unstable page state instead of acting immediately
2. click flows verify navigation rather than assuming success
3. failed target interactions can recover through re-snapshot plus re-location
4. the browser mode panel shows waiting, acting, verifying, and recovering states
5. high-risk actions never resume silently after recovery
