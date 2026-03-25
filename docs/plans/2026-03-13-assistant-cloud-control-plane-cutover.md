# Assistant Cloud Control Plane Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the desktop assistant surfaces use the cloud control plane as the only source of truth, while keeping existing system-asset sync behavior elsewhere intact.

**Architecture:** Remove Tauri-only assistant inventory CRUD fallbacks from the frontend assistant APIs and UI flows. Desktop should behave like web for assistant market, owned assistants, installs, tags, and CRUD, while chat/runtime paths stop waiting on obsolete local assistant stores.

**Tech Stack:** Next.js 16, React 19, TypeScript, SWR, Jest, Tauri frontend bridge

---

### Task 1: Lock the new cloud-only API behavior with tests

**Files:**
- Modify: `deeting/lib/api/__tests__/assistants-market.test.ts`
- Modify: `deeting/lib/api/__tests__/assistants-installs.test.ts`
- Modify: `deeting/lib/api/__tests__/assistants-owned.test.ts`
- Modify: `deeting/lib/api/__tests__/assistants-crud.test.ts`
- Modify: `deeting/lib/api/__tests__/assistants-tags.test.ts`

**Step 1: Write failing tests**

- Update desktop/Tauri test cases so they expect assistant market, installs, owned, tags, and CRUD to use `request(...)` instead of Tauri `invoke(...)`.
- Keep each test focused on one API family.

**Step 2: Run tests to verify they fail**

Run: `npm test -- --runTestsByPath lib/api/__tests__/assistants-market.test.ts lib/api/__tests__/assistants-installs.test.ts lib/api/__tests__/assistants-owned.test.ts lib/api/__tests__/assistants-crud.test.ts lib/api/__tests__/assistants-tags.test.ts`

Expected: failures showing desktop/Tauri branches still calling local assistant commands or rejecting cloud operations.

**Step 3: Commit**

```bash
git add deeting/lib/api/__tests__/assistants-*.test.ts
git commit -m "test: lock assistant cloud control plane behavior"
```

### Task 2: Remove desktop-local assistant fallbacks from assistant APIs

**Files:**
- Modify: `deeting/lib/api/assistants.ts`

**Step 1: Write minimal implementation**

- Remove the Tauri-only branches for:
  - `fetchAssistantMarket`
  - `fetchAssistantInstalls`
  - `fetchOwnedAssistants`
  - `fetchAssistantTags`
  - `createAssistant`
  - `updateAssistant`
  - `deleteAssistant`
  - `submitAssistantForReview`
  - install-related mutations that previously errored in desktop mode
- Keep non-page/runtime-specific APIs that truly need Tauri untouched.
- Delete now-unused local assistant DTO/cache helpers if they become dead code.

**Step 2: Run focused tests**

Run: `npm test -- --runTestsByPath lib/api/__tests__/assistants-market.test.ts lib/api/__tests__/assistants-installs.test.ts lib/api/__tests__/assistants-owned.test.ts lib/api/__tests__/assistants-crud.test.ts lib/api/__tests__/assistants-tags.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add deeting/lib/api/assistants.ts deeting/lib/api/__tests__/assistants-*.test.ts
git commit -m "refactor: make assistant frontend APIs cloud-only"
```

### Task 3: Remove obsolete local assistant gating from desktop chat and assistant entry points

**Files:**
- Modify: `deeting/components/chat/core/chat-container.tsx`
- Modify: `deeting/components/common/agent-selection/select-agent-container.tsx`
- Modify: `deeting/components/layout/sidebar/glass-sidebar.tsx`
- Modify: `deeting/hooks/chat/use-chat-agent.ts`
- Modify: `deeting/store/market-store.ts`

**Step 1: Write failing tests or assertions where coverage exists**

- Prefer existing assistant/chat tests if available.
- If no direct test exists, add the smallest regression coverage for any changed helper that can be tested without UI overreach.

**Step 2: Write minimal implementation**

- Stop desktop chat initialization from waiting on `loadLocalAssistants()`.
- Stop desktop sidebar and selection overlays from loading or rendering local assistant lists.
- Either simplify `market-store` to an inert compatibility shell or remove desktop-local assistant reads that are no longer used by product surfaces.
- Keep changes minimal and avoid touching unrelated skill/system-asset sync behavior.

**Step 3: Run focused tests**

Run: `npm test -- --runTestsByPath lib/api/__tests__/assistants-market.test.ts lib/api/__tests__/assistants-installs.test.ts lib/api/__tests__/assistants-owned.test.ts lib/api/__tests__/assistants-crud.test.ts lib/api/__tests__/assistants-tags.test.ts`

Then, if affected tests exist:

Run: `npm test -- --runTestsByPath store/__tests__/chat-store.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add deeting/components/chat/core/chat-container.tsx deeting/components/common/agent-selection/select-agent-container.tsx deeting/components/layout/sidebar/glass-sidebar.tsx deeting/hooks/chat/use-chat-agent.ts deeting/store/market-store.ts
git commit -m "refactor: remove obsolete desktop local assistant UI gating"
```

### Task 4: Final verification and edge review

**Files:**
- Review only: `deeting/app/[locale]/assistants/page.tsx`

**Step 1: Re-read requirements**

- Desktop assistant page is cloud-only.
- No legacy/local banner.
- No local assistant list fallback.
- Sync behavior outside this page remains intact.

**Step 2: Run verification**

Run: `npm test -- --runTestsByPath lib/api/__tests__/assistants-market.test.ts lib/api/__tests__/assistants-installs.test.ts lib/api/__tests__/assistants-owned.test.ts lib/api/__tests__/assistants-crud.test.ts lib/api/__tests__/assistants-tags.test.ts store/__tests__/chat-store.test.ts`

Expected: PASS

**Step 3: Manual code review checklist**

- Confirm `assistants.ts` no longer branches on Tauri for assistant inventory/CRUD.
- Confirm desktop chat no longer blocks on local assistant loading.
- Confirm desktop sidebar and selection surfaces no longer expose local assistant inventory.
- Confirm no changes were made to unrelated skill/system-asset sync entry points.

