# Desktop Advanced Memory Production Design

**Date:** 2026-03-08

**Scope:** Standard production landing for desktop advanced memory in the Tauri app.

## Goal

Stabilize and productionize the desktop memory system by unifying local memory CRUD/search semantics, fixing vitality behavior, and making the desktop memory dashboard consume the local memory model directly.

## In Scope

- Add a first-class local memory update flow for desktop/Tauri
- Extend semantic search filters with `category`, `source`, and `tags`
- Correct vitality rerank and recall-touch behavior
- Unify `/dashboard/memory` with the desktop local memory model
- Add targeted Rust and Jest regression tests

## Out of Scope

- Offline embedding models
- Desktop/cloud memory sync
- Broad knowledge system redesign
- Major unified-search product work beyond preserving current APIs

## Current State

The desktop memory backend already has a strong foundation:

- `MemoryService` exists and wraps `MemoryStore`
- `local_memories` schema already includes embedding, metadata, vitality, and access fields
- semantic memory search is available
- write guard, snapshots, rollback, and auto fact extraction already exist

The main remaining issues are product and behavior gaps rather than missing architecture.

## Problems to Fix

### 1. Desktop edit flow is not a real update

The dashboard currently emulates edit by append-then-delete. This breaks production semantics for identity, history, and consistent snapshots.

### 2. Search filters are incomplete

The backend stores `category`, `source`, and `tags`, but desktop semantic search does not expose full production filtering for them.

### 3. Vitality is only partially implemented

Search rerank currently uses stale timestamps and recall touch does not reliably increase vitality in a meaningful way.

### 4. Frontend model is split

The desktop dashboard mixes legacy cloud-style memory data and local desktop memory data, causing field loss and inconsistent behavior across list/search/edit/history flows.

## Design Decisions

### A. Keep the current architecture

Retain `MemoryStore -> MemoryService -> Tauri commands -> local-memory.ts -> dashboard` and close gaps instead of introducing a new subsystem.

### B. Add a formal update command

Introduce `update_local_memory` and route edits through service/store logic that:

- preserves the same memory id
- keeps stable metadata unless explicitly changed
- writes a snapshot before update
- re-embeds when embedding is available

### C. Expand desktop semantic search contract

Extend local search request/response types so filters and display fields flow end-to-end:

- request: `category`, `source`, `tags`
- response: `category`, `source`, `tags`, `vitality`, `last_accessed_at`

### D. Make vitality behavior explicit

Search rerank should prefer `last_accessed_at` for decay. Returned search hits should asynchronously update both `last_accessed_at` and vitality so recall changes future ranking.

### E. Unify the dashboard on the local model

The desktop memory page should use the local memory type directly for list/search/edit/history behavior. Compatibility conversion to the old cloud memory shape should not drive the desktop UI.

## Data Flow

### Write

append or auto extraction -> `MemoryService.append` -> embedding -> write guard -> add/update/noop -> snapshot if update -> LanceDB persist

### Edit

UI edit -> `update_local_memory` -> service update -> snapshot -> content update + optional re-embed -> same memory id returned

### Search

UI query + filters -> `MemoryService.search` -> embed query -> vector search -> rerank with vitality + decay -> final results -> async recall touch

## Acceptance Criteria

- Desktop memory edits no longer create a new id
- Dashboard list/search/history render consistent local-memory fields
- Semantic search accepts category/source/tags filters
- Search touch updates access metadata and vitality predictably
- Rust and Jest regression tests cover the new behavior

## Validation

- `cd deeting/src-tauri && cargo test memory::`
- `cd deeting && npm test -- --runTestsByPath lib/api/__tests__/local-memory.test.ts lib/api/__tests__/memory.test.ts`
- `cd deeting && npm run lint -- app/[locale]/dashboard/memory/components/memory-client.tsx app/[locale]/dashboard/memory/components/memory-card.tsx lib/api/local-memory.ts lib/api/memory.ts lib/swr/use-memory.ts types/memory.ts`

## Implementation Order

1. formal local update contract
2. search filter expansion
3. vitality/rerank/touch correction
4. dashboard data-flow unification
5. targeted regression tests

