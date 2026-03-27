# Chat Pending Takeover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight chat takeover bar so a new user message sent during an active AI run can be stopped immediately, deferred until the current step finishes, or canceled without disrupting the current run.

**Architecture:** Keep the current desktop-local chat runtime as a single active run, but add a frontend-managed pending takeover state. Store the deferred user draft separately from the active input, route the three bar actions through the chat messaging service, and use an explicit takeover policy helper so “step-after-send” behavior stays grounded in current request lifecycle and approval/tool activity instead of ad hoc UI booleans.

**Tech Stack:** Next.js App Router, React 19, Zustand, next-intl, Jest/Testing Library, Tauri desktop-local chat runtime

---

### Task 1: Define pending takeover state in the chat store

**Files:**
- Modify: `deeting/store/chat-store.ts`
- Create: `deeting/store/__tests__/chat-takeover-store.test.ts`

**Step 1: Write the failing store test**

Cover:

- setting a pending takeover draft stores the message text, attachments, selected knowledge ids, and creation time
- replacing a pending takeover draft overwrites the previous one instead of creating a queue
- clearing the pending takeover draft does not mutate the active chat messages
- resetting chat/session clears pending takeover state

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- store/__tests__/chat-takeover-store.test.ts`

Expected: FAIL because the pending takeover store state and actions do not exist yet.

**Step 3: Write the minimal implementation**

Extend `deeting/store/chat-store.ts` with:

- a `PendingChatTakeover` type holding `input`, `attachments`, `selectedKnowledgeFileIds`, and timestamps
- store fields for `pendingTakeover` and optional lightweight mode metadata such as `requestedAction`
- actions to set, replace, and clear the pending takeover draft
- reset behavior in `resetChat`, `resetSession`, and assistant/session switches so stale takeover drafts never leak across conversations

Keep this state independent from `messages` and `interruptedAssistantMessageId`.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- store/__tests__/chat-takeover-store.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/store/chat-store.ts deeting/store/__tests__/chat-takeover-store.test.ts
git commit -m "feat: add pending chat takeover store state"
```

### Task 2: Extract takeover policy and service orchestration

**Files:**
- Create: `deeting/lib/chat/takeover.ts`
- Create: `deeting/lib/chat/__tests__/takeover.test.ts`
- Modify: `deeting/hooks/chat/use-chat-messaging-service.ts`
- Modify: `deeting/hooks/chat/use-chat-messaging.ts`

**Step 1: Write the failing policy/service tests**

Cover:

- a new draft entered during `isLoading` is stored as pending takeover instead of being sent immediately
- `immediate_stop` cancels the active request and then sends the stored takeover draft
- `send_after_step` keeps the current run alive and auto-dispatches the stored takeover draft when a safe boundary is reached
- `cancel_pending_takeover` removes only the pending draft and leaves the active run untouched
- only one pending takeover exists at a time; a later draft replaces the earlier one

**Step 2: Run the tests to verify they fail**

Run: `cd /data/Deeting/deeting && bun run test -- lib/chat/__tests__/takeover.test.ts hooks/chat/__tests__/use-chat-messaging-service.test.ts`

Expected: FAIL because takeover policy helpers and deferred-send orchestration do not exist yet.

**Step 3: Write the minimal implementation**

Create `deeting/lib/chat/takeover.ts` with:

- takeover action types such as `immediate_stop`, `send_after_step`, and `cancel`
- a helper that decides whether the current state is at a safe takeover boundary using existing signals first:
  - request settled
  - approval-required pause
  - no unresolved running tool activity
- a helper that normalizes a pending draft into the existing send-message payload shape

Update `deeting/hooks/chat/use-chat-messaging-service.ts` to:

- expose methods to queue a pending takeover from the current input state
- expose methods for `stopAndSendPendingTakeover`, `markPendingTakeoverForDeferredSend`, and `cancelPendingTakeover`
- trigger deferred auto-send when the active request reaches a safe boundary or finishes naturally
- preserve the current interrupted-generation path for the active assistant message instead of conflating it with pending takeover

Update `deeting/hooks/chat/use-chat-messaging.ts` to surface the new takeover state and actions to the controls layer.

Do not add a true multi-message queue in this pass; keep it single pending takeover by design.

**Step 4: Run the tests to verify they pass**

Run: `cd /data/Deeting/deeting && bun run test -- lib/chat/__tests__/takeover.test.ts hooks/chat/__tests__/use-chat-messaging-service.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/lib/chat/takeover.ts deeting/lib/chat/__tests__/takeover.test.ts deeting/hooks/chat/use-chat-messaging-service.ts deeting/hooks/chat/use-chat-messaging.ts deeting/hooks/chat/__tests__/use-chat-messaging-service.test.ts
git commit -m "feat: add pending takeover messaging orchestration"
```

### Task 3: Add the lightweight pending takeover status bar

**Files:**
- Create: `deeting/components/chat/takeover/takeover-pending-bar.tsx`
- Create: `deeting/components/chat/takeover/__tests__/takeover-pending-bar.test.tsx`
- Modify: `deeting/messages/en/chat.json`
- Modify: `deeting/messages/zh-CN/chat.json`

**Step 1: Write the failing component test**

Cover:

- the bar renders only when a pending takeover draft exists
- the bar shows the pending draft preview text
- the bar exposes exactly three actions:
  - immediate stop
  - send after step
  - cancel
- clicking each action invokes the injected callback

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/takeover/__tests__/takeover-pending-bar.test.tsx`

Expected: FAIL because the takeover bar component and copy do not exist.

**Step 3: Write the minimal implementation**

Create `deeting/components/chat/takeover/takeover-pending-bar.tsx` as a lightweight top bar modeled after the existing browser-mode confirmation bar:

- compact copy such as “已收到新消息，将在当前步骤后接管”
- optional one-line preview of the pending draft
- three explicit actions:
  - `立即停止`
  - `步骤后发送`
  - `取消`

Add matching localization keys to `messages/en/chat.json` and `messages/zh-CN/chat.json`.

Keep the component stateless; it should receive pending draft data and callbacks via props.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/takeover/__tests__/takeover-pending-bar.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/components/chat/takeover/takeover-pending-bar.tsx deeting/components/chat/takeover/__tests__/takeover-pending-bar.test.tsx deeting/messages/en/chat.json deeting/messages/zh-CN/chat.json
git commit -m "feat: add pending takeover status bar"
```

### Task 4: Wire the controls layer to create and manage pending takeover drafts

**Files:**
- Modify: `deeting/components/chat/console/controls-container.tsx`
- Modify: `deeting/components/chat/console/__tests__/controls-container.test.tsx`

**Step 1: Write the failing controls test**

Cover:

- when the user sends while a run is active, the draft becomes a pending takeover instead of being dropped
- the pending takeover bar appears above the controls
- `立即停止` calls the stop-and-send path
- `步骤后发送` keeps the request alive and marks the pending draft for deferred dispatch
- `取消` removes the pending takeover bar and leaves the active request running

**Step 2: Run the test to verify it fails**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/console/__tests__/controls-container.test.tsx`

Expected: FAIL because the controls currently map the main action button to send/stop/continue only and do not surface pending takeover state.

**Step 3: Write the minimal implementation**

Update `deeting/components/chat/console/controls-container.tsx` to:

- render `TakeoverPendingBar` above the main input controls
- when `isGenerating` and the user presses Enter or send with non-empty draft content, store that content as pending takeover instead of calling the normal send path
- keep the current stop button semantics for the active run itself
- preserve the pending draft even if the user edits the visible input afterward, unless they replace or cancel it

Do not turn the whole chat into a general-purpose queue UI.

**Step 4: Run the test to verify it passes**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/console/__tests__/controls-container.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/components/chat/console/controls-container.tsx deeting/components/chat/console/__tests__/controls-container.test.tsx
git commit -m "feat: wire chat controls to pending takeover bar"
```

### Task 5: Verify deferred-send boundaries and reset behavior end-to-end

**Files:**
- Modify: `deeting/hooks/chat/__tests__/use-chat-messaging-service.test.ts`
- Modify: `deeting/store/__tests__/chat-store.test.ts` if an existing reset pattern is a better fit than a new dedicated assertion file

**Step 1: Write the failing regression tests**

Cover:

- a pending takeover auto-sends when the active run completes normally
- a pending takeover does not auto-send after the user cancels it
- resetting the session while a pending takeover exists clears the draft and prevents ghost sends
- approval-required pauses are treated as safe deferred boundaries only when the active run is no longer progressing

**Step 2: Run the tests to verify they fail**

Run: `cd /data/Deeting/deeting && bun run test -- hooks/chat/__tests__/use-chat-messaging-service.test.ts store/__tests__/chat-takeover-store.test.ts`

Expected: FAIL because the boundary detection and reset regressions are not covered yet.

**Step 3: Write the minimal implementation**

Tighten the messaging-service orchestration so:

- deferred auto-send happens once, not repeatedly across rerenders
- pending takeover is cleared only after successful dispatch or explicit cancel
- reset/session-switch paths invalidate any scheduled deferred send
- approval/tool activity cannot leave the bar stuck forever without a terminal or safe-boundary transition

Prefer small helper functions over adding more branching directly inside the hook body.

**Step 4: Run the tests to verify they pass**

Run: `cd /data/Deeting/deeting && bun run test -- hooks/chat/__tests__/use-chat-messaging-service.test.ts store/__tests__/chat-takeover-store.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add deeting/hooks/chat/__tests__/use-chat-messaging-service.test.ts deeting/hooks/chat/use-chat-messaging-service.ts deeting/store/__tests__/chat-takeover-store.test.ts deeting/store/chat-store.ts
git commit -m "fix: harden deferred chat takeover boundaries"
```

### Task 6: Final verification

**Files:**
- No code changes expected

**Step 1: Run targeted frontend tests**

Run: `cd /data/Deeting/deeting && bun run test -- store/__tests__/chat-takeover-store.test.ts lib/chat/__tests__/takeover.test.ts components/chat/takeover/__tests__/takeover-pending-bar.test.tsx components/chat/console/__tests__/controls-container.test.tsx hooks/chat/__tests__/use-chat-messaging-service.test.ts`

Expected: PASS for all targeted takeover-related tests.

**Step 2: Run the chat-adjacent regression suite**

Run: `cd /data/Deeting/deeting && bun run test -- components/chat/browser-mode/__tests__/browser-mode-confirmation-bar.test.tsx lib/chat/__tests__/assistant-activity.test.ts hooks/chat/__tests__/use-hydrate-pending-tool-approval.test.tsx`

Expected: PASS, proving the new takeover state does not break nearby chat top-bar and activity flows.

**Step 3: Run a production-safety build**

Run: `cd /data/Deeting/deeting && bun run build`

Expected: PASS with no new type or App Router build regressions.

**Step 4: Manual desktop verification**

Verify in Tauri desktop:

- send a message that keeps the assistant running
- type a new message while the run is active
- confirm the takeover bar appears
- test `立即停止`, `步骤后发送`, and `取消`
- verify only one pending takeover exists at a time
- verify no deferred send leaks into a new chat/session

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify pending takeover chat flow"
```
