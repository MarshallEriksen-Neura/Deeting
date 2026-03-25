# Dashboard Agent Creation Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the desktop-local dashboard agent creation page so chat task agents and image agents have separate creation flows and dedicated editors.

**Architecture:** Keep `custom_task_agent` as the local persistence truth, but replace the current single mixed editor with a typed creation shell, grouped asset list, and two specialized editor workspaces. Shared helpers should be reused only for model selection, save/delete plumbing, and preview transport.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, SWR, shadcn/ui, Tauri desktop API

---

### Task 1: Add planning artifacts and identify exact rewrite seam

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Reference: `/data/Deeting/deeting/lib/api/custom-task-agents.ts`
- Reference: `/data/Deeting/docs/plans/2026-03-24-dashboard-agent-creation-redesign-design.md`

**Step 1: Inspect the current page shell and extract responsibilities**

Run:

```bash
sed -n '1,260p' /data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx
sed -n '260,1320p' /data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx
sed -n '1320,2360p' /data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx
```

Expected: identify which logic belongs to page shell, list rendering, draft state, bindings, preview, and debug.

**Step 2: Document the split before touching UI**

Record the target split:

- page shell
- type-selection starter
- grouped list
- chat editor
- image editor

Expected: one clear ownership map for the refactor.

### Task 2: Extract shared state and page-shell helpers

**Files:**
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-page-types.ts`
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-draft.ts`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`

**Step 1: Write the minimal shared types**

Add types for:

- starter selection state
- grouped list sections
- chat editor draft
- image editor draft

Expected: editor-specific props stop depending on one giant local type.

**Step 2: Move shared draft utilities into helper file**

Extract:

- empty draft factories
- profile-to-draft hydration
- payload normalization
- shared tag parsing

Expected: the main page file no longer owns all draft logic inline.

**Step 3: Keep image-specific helpers in their existing helper module**

Reference and reuse:

- `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-image-config.ts`

Expected: avoid duplicating image config parsing behavior.

### Task 3: Build the type-selection starter surface

**Files:**
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-type-starter.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Create the starter component**

Render two large type cards:

- chat task agent
- image agent

Include short capability labels and distinct visual treatment.

**Step 2: Wire `New` to starter mode**

Update the page so `handleCreateNew()` opens the starter surface instead of immediately hydrating a mixed draft form.

**Step 3: Add copy for the new creation flow**

Add translations for:

- create studio title/subtitle
- type card titles and descriptions
- enter-chat-editor CTA
- enter-image-editor CTA

Expected: the user sees creation as a typed decision first.

### Task 4: Group the asset list by agent type

**Files:**
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-library-section.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Replace the flat list rendering with grouped sections**

Render:

- chat task agents
- image agents

Keep search and filtering, but make grouping the default scan pattern.

**Step 2: Preserve current badges and status indicators**

Re-use current badges for:

- enabled/disabled
- discoverable/hidden
- image preferred if still relevant for chat-adjacent display

Expected: users scan by product type first, metadata second.

### Task 5: Build the dedicated chat task agent editor

**Files:**
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/chat-task-agent-editor.tsx`
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-preview-panel.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Move chat-focused fields into a dedicated editor component**

Keep:

- identity fields
- prompt
- model picker
- skills/tools bindings
- status controls

**Step 2: Reorder the workspace around product intent**

Use section order:

1. identity
2. capability bindings
3. preview
4. debug / advanced

**Step 3: Add a right-side summary panel**

Show:

- how the agent appears in chat
- selected skill count
- selected tool count
- preview launch summary

Expected: the chat editor feels like configuring a collaborator, not flipping low-level runtime knobs.

### Task 6: Build the dedicated image agent editor

**Files:**
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/image-task-agent-editor.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Move image-focused fields into a dedicated editor component**

Keep:

- identity
- image role prompt
- model
- image generation configuration
- preview
- image debug

Remove from this surface:

- skills
- MCP tools
- generic binding summaries

**Step 2: Make preview image-first**

Show the image grid as the main preview result state, with parameter summary nearby.

**Step 3: Keep advanced JSON access only as an advanced section**

Preserve raw extra params support for power users without making it the primary UX.

Expected: image agent creation feels like configuring a visual role, not a generic tool-calling agent.

### Task 7: Enforce immutable type semantics in the UI

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Remove the editable invocation-kind selector from existing-agent edit mode**

For existing agents, render type as read-only identity metadata.

**Step 2: Only set type when entering from starter flow**

The starter selection determines which editor draft is initialized:

- `chat`
- `image_generation`

Expected: users can no longer reinterpret an existing object by flipping one field.

### Task 8: Refine translation copy and visual polish

**Files:**
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/*.tsx`

**Step 1: Update utility copy to match the new mental model**

Use explicit product wording:

- create chat task agent
- create image agent
- configure skills and tools
- configure image style and output

**Step 2: Add restrained motion and differentiated visual accents**

Use lightweight transitions for:

- starter cards
- editor swap
- preview rail

Expected: the page reads as a creation studio with two distinct agent identities.

### Task 9: Verify behavior with focused checks

**Files:**
- Verify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/*.tsx`
- Verify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Verify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Run focused lint/type/build verification for the frontend app**

Run from `/data/Deeting/deeting`:

```bash
bun run build
```

Expected: build succeeds for the frontend app.

**Step 2: If full build is too expensive or already red elsewhere, run a focused TypeScript check**

Run:

```bash
cd /data/Deeting/deeting && bun run build
```

Expected: same command path the user prefers for this repo, with any unrelated failures called out explicitly.

**Step 3: Manually validate desktop-local UX**

Check:

- new action opens type-selection starter
- chat editor shows bindings
- image editor hides bindings
- existing agents open correct dedicated editor
- preview remains functional for both types

**Step 4: Commit**

Only if the user explicitly asks for a commit after review.
