# Chat Tool Block Sandbox Label Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Only show the "SANDBOX EXECUTION" label in chat tool execution console when the tool call is `execute_code_plan`; `search_sdk` should not display the sandbox label.

**Architecture:** Keep the backend unchanged. Compute a UI-only flag from message parts (`tool_call` / `tool_result`) and pass it into the execution console header to conditionally render the sandbox label. Use the execution section title as the non-sandbox header.

**Tech Stack:** Next.js (React), TypeScript, Jest/RTL tests.

---

### Task 1: Add UI-only sandbox label gating in chat console header

**Files:**
- Modify: `deeting/components/chat/messages/ai-response-bubble.tsx`

**Step 1: Write the failing test**

Add a test that renders an `execution_section` + `console_log` sequence plus a `tool_call` for `search_sdk`, and assert the header does NOT show "SANDBOX EXECUTION" (use the section title instead).

```tsx
it("does not show sandbox label for search_sdk console", () => {
  const parts: MessageBlock[] = [
    { id: "exec-title", type: "execution_section", title: "Local Tool Actions" },
    { id: "log-1", type: "console_log", stream: "stdout", content: "hello" },
    { id: "call-1", type: "tool_call", toolName: "search_sdk", status: "success" },
  ];

  render(<AIResponseBubble parts={parts} />);
  expect(screen.queryByText("SANDBOX EXECUTION")).not.toBeInTheDocument();
  expect(screen.getByText("Local Tool Actions")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- ai-response-bubble.test.tsx`
Expected: FAIL (header still says "SANDBOX EXECUTION").

**Step 3: Write minimal implementation**

In `AIResponseBubble`, compute a boolean like `hasExecuteCodePlan` by scanning `parts` for `tool_call` or `tool_result` with `toolName === "execute_code_plan"`. Also compute a `consoleTitle` from the first `execution_section` block. Pass `hasExecuteCodePlan` and `consoleTitle` into `ExecutionConsole` and render:
- `SANDBOX EXECUTION` only when `hasExecuteCodePlan`
- Otherwise render `consoleTitle` (fallback `"Local Tool Actions"`)

```tsx
const hasExecuteCodePlan = parts.some(
  (part) =>
    (part.type === "tool_call" || part.type === "tool_result") &&
    part.toolName === "execute_code_plan"
);
const consoleTitle = parts.find((p) => p.type === "execution_section")?.title ?? "Local Tool Actions";

<ExecutionConsole blocks={consoleSequence} isActive={isActive} showSandboxLabel={hasExecuteCodePlan} title={consoleTitle} />
```

In `ExecutionConsole` header, replace hard-coded "SANDBOX EXECUTION" with conditional rendering:

```tsx
{showSandboxLabel ? "SANDBOX EXECUTION" : title}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- ai-response-bubble.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add deeting/components/chat/messages/ai-response-bubble.tsx deeting/components/chat/messages/__tests__/ai-response-bubble.test.tsx
git commit -m "ui: gate sandbox label to execute_code_plan"
```

---

### Task 2: Add positive test for execute_code_plan

**Files:**
- Modify: `deeting/components/chat/messages/__tests__/ai-response-bubble.test.tsx`

**Step 1: Write the failing test**

Add a test that includes `execute_code_plan` and an execution console; assert the header shows "SANDBOX EXECUTION".

```tsx
it("shows sandbox label for execute_code_plan console", () => {
  const parts: MessageBlock[] = [
    { id: "exec-title", type: "execution_section", title: "Local Tool Actions" },
    { id: "log-1", type: "console_log", stream: "stdout", content: "hello" },
    { id: "call-1", type: "tool_call", toolName: "execute_code_plan", status: "success" },
  ];

  render(<AIResponseBubble parts={parts} />);
  expect(screen.getByText("SANDBOX EXECUTION")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- ai-response-bubble.test.tsx`
Expected: FAIL until implementation from Task 1 is complete.

**Step 3: Write minimal implementation**

Implementation is already in Task 1. No new code if Task 1 is done.

**Step 4: Run test to verify it passes**

Run: `npm test -- ai-response-bubble.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add deeting/components/chat/messages/__tests__/ai-response-bubble.test.tsx
git commit -m "test: gate sandbox label on execute_code_plan"
```

---

## Notes
- This change affects only the chat execution console header. Tool call blocks remain unchanged.
- No backend/Tauri schema changes required.
