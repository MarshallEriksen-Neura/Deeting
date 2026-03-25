# Desktop Advanced Memory Production Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote the desktop/Tauri advanced memory path from partial prototype to production-ready by shipping a first-class local update API, richer semantic filters, corrected vitality reranking/touch behavior, and a dashboard that consumes the desktop memory model directly.

**Architecture:** Keep LanceDB schema at V3 and extend the existing local-memory contract instead of adding a parallel system. Reuse `MemoryStore::update_memory_content`/snapshot plumbing for formal updates, widen search request/response types so filters and metadata flow end-to-end, and make `/dashboard/memory` use typed local-memory objects rather than collapsing them into the legacy cloud `MemoryItem` shape.

**Tech Stack:** Tauri commands + Rust (`src-tauri/src/modules/memory`), Next.js/React + SWR, Jest, Cargo tests.

---

## 1. Overview
- Included:
  - formal local desktop update flow
  - semantic search filters for `category`, `source`, `tags`
  - vitality/`last_accessed_at` rerank + touch fixes
  - `/dashboard/memory` frontend alignment to local desktop model
  - targeted Rust/Jest tests
- Excluded:
  - backend cloud memory API redesign
  - new dependencies or schema version bump unless implementation proves unavoidable
  - broad UI redesign outside `/dashboard/memory`

## 2. Prerequisites
- No package changes expected.
- Keep LanceDB memory schema at V3 (`deeting/src-tauri/src/modules/memory/migration.rs`) unless tests show a missing persisted field.
- Use an in-memory LanceDB + SQLite snapshot store for Rust tests via `MemoryState::with_options`.
- Desktop JS tests still require `NEXT_PUBLIC_IS_TAURI=true` + mocked `@tauri-apps/api/core`.

## 3. Implementation Steps

### Step 1: Add a first-class local update contract
- **Modify:** `deeting/src-tauri/src/modules/memory/types.rs`, `deeting/src-tauri/src/modules/memory/commands.rs`, `deeting/src-tauri/src/modules/memory/service.rs`, `deeting/src-tauri/src/modules/memory/store.rs`, `deeting/src-tauri/src/commands.rs`
- Add `UpdateLocalMemoryRequest` and a new Tauri command such as `update_local_memory`.
- Route command -> service -> store instead of the current append+delete emulation.
- Reuse `MemoryStore::update_memory_content` as the base, but make it safe for explicit user edits:
  - keep the same `id`/`created_at`
  - preserve `session_id`, `assistant_id`, `meta_info`, `category`, `source`, `tags`, `vitality`
  - re-embed when embedding is available
  - record an `update` snapshot through existing snapshot plumbing
- Validation: `cd deeting/src-tauri && cargo test memory::`

### Step 2: Extend local search request/response types for production filters
- **Modify:** `deeting/src-tauri/src/modules/memory/types.rs`, `deeting/src-tauri/src/modules/memory/service.rs`, `deeting/src-tauri/src/modules/memory/store.rs`, `deeting/lib/api/local-memory.ts`
- Extend `LocalMemorySearchQuery` to accept `category`, `source`, and `tags`.
- Extend `LocalMemorySearchItem`/Zod schema to return the fields the dashboard already wants to render consistently: `source`, `tags`, `last_accessed_at` (and keep `category`, `vitality`).
- Update `build_filter_sql` or add a memory-search-specific filter builder so search can compose session/assistant/category/source/tag constraints without breaking list/delete/clear behavior.
- Prefer exact-match filters for `category`/`source`, and a conservative JSON-string contains strategy for `tags_json` unless LanceDB supports something cleaner in the current stack.
- Validation: `cd deeting && npm test -- --runTestsByPath lib/api/__tests__/local-memory.test.ts`

### Step 3: Fix vitality rerank and search touch semantics
- **Modify:** `deeting/src-tauri/src/modules/memory/service.rs`, `deeting/src-tauri/src/modules/memory/store.rs`
- Change rerank decay to use `last_accessed_at` when present, not `updated_at`; fall back to `updated_at`/`created_at` only if needed.
- Keep search touch scoped to the final returned items after reranking/truncation.
- Review `update_memory_content` so explicit content edits do not accidentally masquerade as search recalls unless that is intentionally documented; the search path should own recall touches.
- Ensure the touch path updates both `vitality` and `last_accessed_at` consistently enough that the next search sees the new value.
- Validation: `cd deeting/src-tauri && cargo test memory::`

### Step 4: Unify `/dashboard/memory` to the local desktop memory model
- **Modify:** `deeting/app/[locale]/dashboard/memory/components/memory-client.tsx`, `deeting/app/[locale]/dashboard/memory/components/memory-card.tsx`, `deeting/lib/swr/use-memory.ts`, `deeting/lib/api/local-memory.ts`, `deeting/lib/api/memory.ts`, `deeting/types/memory.ts`, `deeting/messages/en/memory.json`, `deeting/messages/zh-CN/memory.json`
- Stop flattening desktop items into the legacy `{ id, content, payload }` cloud shape when the page is in Tauri mode.
- Make the dashboard consume typed local-memory fields directly (`category`, `source`, `tags`, `vitality`, `last_accessed_at`) for both list and search states, with a single normalization layer only if web compatibility must remain.
- Replace `updateMemory()`’s Tauri append+delete flow in `deeting/lib/api/memory.ts` with the new `updateLocalMemory()` command wrapper.
- Keep `MemoryCard` rendering logic aligned with the local model instead of mining metadata out of `payload`.
- Add UI controls only as needed for the scoped filters, but at minimum wire search call sites so future filter UI can pass `category`/`source`/`tags` without another reshape.
- Validation:
  - `cd deeting && npm test -- --runTestsByPath lib/api/__tests__/memory.test.ts lib/api/__tests__/local-memory.test.ts`
  - `cd deeting && npm run lint -- app/[locale]/dashboard/memory/components/memory-client.tsx app/[locale]/dashboard/memory/components/memory-card.tsx lib/api/local-memory.ts lib/api/memory.ts lib/swr/use-memory.ts types/memory.ts`

### Step 5: Add targeted regression tests
- **Create:** `deeting/src-tauri/src/modules/memory/tests.rs`
- **Modify:** `deeting/src-tauri/src/modules/memory/mod.rs`, `deeting/lib/api/__tests__/local-memory.test.ts`, `deeting/lib/api/__tests__/memory.test.ts`
- Rust tests should cover:
  - explicit local update keeps the same memory id and snapshot history
  - search filtering by `category`, `source`, and `tags`
  - rerank uses `last_accessed_at` and search touch updates recall metadata
- Jest tests should cover:
  - `searchLocalMemories()` passes new filter args and parses richer result fields
  - `updateMemory()` in Tauri uses `updateLocalMemory()` (not append+delete)
  - no cleanup/delete fallback path remains in desktop update tests
- Optional only if frontend regression shows risk: add `deeting/app/[locale]/dashboard/memory/components/__tests__/memory-client.test.tsx` for edit/search wiring.
- Validation:
  - `cd deeting/src-tauri && cargo test memory::`
  - `cd deeting && npm test -- --runTestsByPath lib/api/__tests__/local-memory.test.ts lib/api/__tests__/memory.test.ts`

## 4. File Changes Summary
- **Create**
  - `docs/plans/2026-03-08-desktop-advanced-memory-production-release.md`
  - `deeting/src-tauri/src/modules/memory/tests.rs`
  - optional: `deeting/app/[locale]/dashboard/memory/components/__tests__/memory-client.test.tsx`
- **Modify**
  - `deeting/src-tauri/src/modules/memory/types.rs`
  - `deeting/src-tauri/src/modules/memory/commands.rs`
  - `deeting/src-tauri/src/modules/memory/service.rs`
  - `deeting/src-tauri/src/modules/memory/store.rs`
  - `deeting/src-tauri/src/modules/memory/mod.rs`
  - `deeting/src-tauri/src/commands.rs`
  - `deeting/lib/api/local-memory.ts`
  - `deeting/lib/api/memory.ts`
  - `deeting/lib/swr/use-memory.ts`
  - `deeting/types/memory.ts`
  - `deeting/app/[locale]/dashboard/memory/components/memory-client.tsx`
  - `deeting/app/[locale]/dashboard/memory/components/memory-card.tsx`
  - `deeting/messages/en/memory.json`
  - `deeting/messages/zh-CN/memory.json`
  - `deeting/lib/api/__tests__/local-memory.test.ts`
  - `deeting/lib/api/__tests__/memory.test.ts`
- **Delete**
  - None planned

## 5. Testing Strategy
- Rust module tests around update/search/touch behavior.
- Jest API-wrapper tests for new Tauri command usage and filter propagation.
- Manual desktop smoke test:
  1. edit an existing memory and confirm the `id` is unchanged
  2. search by `category`/`source`/`tag`
  3. repeat the same search twice and confirm recall ordering improves based on `last_accessed_at`
  4. open snapshot history and confirm explicit edit created an update snapshot

## 6. Rollback Plan
- Revert the Tauri update command and frontend call sites together if desktop edits regress.
- If search filters/rerank cause unstable results, revert `service.rs` + `store.rs` search changes while keeping the formal update command.
- No data migration rollback is expected because the plan stays on schema V3.

## 7. Estimated Effort
- Rough time: 1.5-2.5 focused developer days
- Complexity: Medium
- Highest-risk areas:
  - LanceDB filter syntax for tags
  - preserving snapshot/update semantics without inflating `last_accessed_at`
  - keeping web/cloud memory consumers stable while the dashboard shifts to the desktop model

