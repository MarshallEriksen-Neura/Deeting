# Browser Mode Panel Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep Browser Mode card content contained inside the workspace side panel with an internal scroll region and a cleaner compact summary layout.

**Architecture:** Rework the existing `BrowserModePanel` into a vertical flex shell where the header is fixed and the detail body owns scrolling. Preserve current state/data wiring while regrouping the rendered sections into a responsive summary grid plus stacked detail blocks.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui card and button primitives, Jest + Testing Library

---

### Task 1: Restructure the panel shell

**Files:**
- Modify: `deeting/components/workspace/browser-mode-panel.tsx`

**Step 1: Update the outer wrapper and card container**

Change the panel root and card classes so the panel participates correctly in parent flex sizing:

- root uses `flex h-full min-h-0 w-full`
- card uses `flex h-full min-h-0 flex-col overflow-hidden`

**Step 2: Keep the header fixed and wrap actions**

Update the header/action layout so action buttons wrap instead of forcing extra width or height pressure.

**Step 3: Add a dedicated scroll body**

Make `CardContent` the only vertical scroll region with `min-h-0 flex-1 overflow-y-auto`.

### Task 2: Recompose the content layout

**Files:**
- Modify: `deeting/components/workspace/browser-mode-panel.tsx`

**Step 1: Build a compact summary grid**

Render connection, current page, last action, and execution state inside a `grid gap-3 md:grid-cols-2`.

**Step 2: Keep stacked detail sections below**

Leave recovery, request, and timeline as stacked blocks beneath the summary grid so long histories naturally scroll within the body.

**Step 3: Add a stable test hook**

Add a `data-testid` on the scroll body to verify the intended overflow owner.

### Task 3: Extend focused regression coverage

**Files:**
- Modify: `deeting/components/workspace/__tests__/browser-mode-panel.test.tsx`

**Step 1: Assert the new scroll body exists**

Check for the `data-testid` and verify it carries the expected scroll/layout classes.

**Step 2: Preserve existing interaction checks**

Ensure pause, reconnect/end labels, execution info, timeline rendering, and inspection flow continue to pass unchanged.

### Task 4: Verify the change

**Files:**
- Test: `deeting/components/workspace/__tests__/browser-mode-panel.test.tsx`

**Step 1: Run the focused Jest file**

Run:

```bash
cd /data/Deeting/deeting && npm test -- --runInBand --runTestsByPath components/workspace/__tests__/browser-mode-panel.test.tsx
```

Expected:

- all Browser Mode panel tests pass
- no regression in inspection-view opening

**Step 2: Review the panel file for layout sanity**

Confirm the final structure clearly follows:

- fixed header
- scrollable body
- compact summary grid
