# Admin Provider Preset Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin-manageable provider preset editing surface with local test-key verification against the preset's current protocol profile skeleton request.

**Architecture:** Keep `/admin/provider-presets` as the discovery list, but add explicit management actions plus a dedicated `/admin/provider-presets/[slug]` editor page. Back the editor with new admin APIs for preset detail fetch, safe patch update, and verification that renders the current protocol profile into a real upstream request using a temporary admin-supplied API key.

**Tech Stack:** Next.js App Router, SWR, Zod, FastAPI, SQLAlchemy, protocol runtime service, Jest, pytest.

---

### Task 1: Add backend API coverage first

**Files:**
- Modify: `deeting_core/tests/api/test_provider_preset_route.py`

**Step 1: Write failing tests**

Add tests for:
- `GET /api/v1/admin/provider-presets/{slug}` returns full editable fields.
- `PATCH /api/v1/admin/provider-presets/{slug}` updates editable fields and preserves object fields when omitted.
- `POST /api/v1/admin/provider-presets/{slug}/verify` builds a skeleton request from the stored protocol profile and returns upstream preview metadata.

**Step 2: Run test to verify it fails**

Run: `cd /data/Deeting/deeting_core && .venv/bin/pytest tests/api/test_provider_preset_route.py -q`

**Step 3: Implement minimal API support**

Add the smallest backend code required for the tests to pass.

**Step 4: Re-run test to verify it passes**

Run: `cd /data/Deeting/deeting_core && .venv/bin/pytest tests/api/test_provider_preset_route.py -q`

### Task 2: Add admin preset detail/update/verify APIs

**Files:**
- Modify: `deeting_core/app/schemas/provider_preset.py`
- Modify: `deeting_core/app/api/v1/admin/provider_preset_route.py`

**Step 1: Add request/response schemas**

Create explicit admin editor schemas for:
- detail response
- patch update payload
- verify payload/response

**Step 2: Implement detail/update routes**

Add:
- `GET /admin/provider-presets/{slug}`
- `PATCH /admin/provider-presets/{slug}`

Use `exclude_unset=True` semantics so omitted JSON object fields do not get overwritten with `{}`.

**Step 3: Implement verify route**

Add:
- `POST /admin/provider-presets/{slug}/verify`

Use the stored protocol profile plus protocol runtime rendering to build a real upstream request from a skeleton canonical payload.

### Task 3: Add frontend admin API client support

**Files:**
- Modify: `deeting/lib/api/admin-dashboard.ts`

**Step 1: Add schemas/types**

Add typed client schemas for:
- preset detail
- preset update payload
- preset verify request/response

**Step 2: Add request helpers**

Add:
- `fetchAdminProviderPreset`
- `updateAdminProviderPreset`
- `verifyAdminProviderPreset`

### Task 4: Add preset management UI

**Files:**
- Modify: `deeting/app/[locale]/admin/provider-presets/page-content.tsx`
- Modify: `deeting/app/[locale]/admin/provider-presets/page-content.test.tsx`
- Create: `deeting/app/[locale]/admin/provider-presets/[slug]/page.tsx`
- Create: `deeting/app/[locale]/admin/provider-presets/[slug]/page-content.tsx`

**Step 1: Add failing frontend tests**

Cover:
- list page renders a management action
- detail page shows editable sections and verify panel states

**Step 2: Add list management affordance**

Keep the current list, but add search plus an explicit `Edit` action that navigates to the detail page.

**Step 3: Build detail editor**

Include:
- base fields
- auth section
- protocol profiles JSON editor
- verification panel for temporary API key, capability, model, and skeleton request preview/result

**Step 4: Add guardrails**

Client-side JSON parsing and validation:
- blank JSON -> `{}`
- invalid JSON -> inline error
- non-object JSON -> inline error

### Task 5: Verify end to end

**Files:**
- None

**Step 1: Run targeted frontend tests**

Run: `cd /data/Deeting/deeting && npm test -- --runInBand app/[locale]/admin/provider-presets/page-content.test.tsx`

**Step 2: Run targeted backend tests**

Run: `cd /data/Deeting/deeting_core && .venv/bin/pytest tests/api/test_provider_preset_route.py -q`

**Step 3: Run targeted TS/build health checks if needed**

Run: `cd /data/Deeting/deeting && npm test -- --runInBand app/[locale]/admin/users/page-content.test.tsx app/[locale]/admin/provider-presets/page-content.test.tsx`
