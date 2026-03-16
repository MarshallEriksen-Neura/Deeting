# Canonical Capability Registry And Legacy Sunset Plan

## Context

Desktop capability discovery currently mixes several layers that do not share one source of truth:

- local install state lives in SQLite tables such as `local_skill_install` and `local_skill_tool_binding`
- semantic search reads from the memory asset catalog
- `search_sdk` ranks and groups from the memory-backed catalog plus runtime overlays
- refresh/install flows update database state synchronously but asset indexing asynchronously

This creates a recurring class of failures where a skill looks installed but is not yet discoverable or callable by the model.

## Current Pain Points

1. Install success and discoverability are not the same thing.
2. Refresh is an explicit scan, not a live control-plane update.
3. Official skills and user skills share most of the scan path, but their surfaced search behavior is still shaped indirectly through memory assets.
4. Old and new metadata layers can drift, which makes partial migrations especially confusing.
5. The current system can leave half-states where SQLite is updated but the search-facing catalog is stale.

## Refactor Goal

Introduce a canonical capability registry that becomes the only control-plane truth for:

- what capabilities exist
- where they came from
- whether they are enabled
- whether they are callable now
- whether search/indexing is fully caught up

Search, embeddings, and vector assets remain useful, but only as asynchronous ranking and recall enhancements.

## Target Architecture

### Control Plane

Canonical registry entries represent official skills, user skills, MCP tools, and core host capabilities with a common descriptor.

Each entry carries:

- `capability_id`
- `source_kind`
- `asset_kind`
- `package_id`
- `package_version`
- `execution_surface`
- `callable_name`
- `tool_name`
- `binding_kind`
- `activation_state`
- `runtime_state`
- `search_index_state`
- `generation`
- `descriptor_json`

### Search Plane

`search_sdk` should read registry entries first, then optionally use semantic/vector signals to rank or enrich the results.

Search no longer determines existence or callability.

### Execution Plane

Tool execution resolves from the canonical registry and runtime availability state, not from the memory asset catalog.

## Readiness Model

Readiness must be explicit and decomposed:

- `discovered`
- `registered`
- `callable`
- `runtime_ready`
- `search_index_ready`

The UI and diagnostics must show these as separate states.

## Sunset Rules

### Non-Negotiable Rule

Dual writes are acceptable during migration.

Dual reads that influence runtime decisions are not acceptable beyond the cutover window.

### Migration Stages

1. Build the canonical registry and populate it in parallel.
2. Keep legacy tables and memory assets alive only as compatibility outputs.
3. Switch discovery reads to canonical registry.
4. Verify parity and rollout diagnostics.
5. Disable legacy control-plane reads.
6. Stop legacy writes that are no longer needed.
7. Remove stale compatibility code.

## PR Plan

### PR 0

Design doc and rollout plan.

Deliverables:

- canonical registry model
- readiness model
- cutover rules
- rollback plan
- cleanup list

### PR 1

Canonical registry schema and store APIs.

Deliverables:

- new local registry table
- typed upsert/list/delete APIs
- registry generation primitive
- initial tests

Runtime decision paths remain unchanged.

### PR 2

Install/refresh flows populate canonical registry synchronously.

Deliverables:

- local skill registration writes registry entries before returning
- asset indexing remains asynchronous secondary work
- uninstall cleanup removes canonical entries

### PR 3

Switch `search_sdk` and capability discovery to canonical registry reads.

Deliverables:

- registry-first discovery path
- semantic ranking as augmentation only
- grouped outputs:
  - `direct_tools`
  - `recipes`
  - `system_actions`
  - `external_mcp_tools`

### PR 4

Unify all capability sources behind the registration contract.

Deliverables:

- official skills
- user skills
- MCP tools
- core host capabilities

### PR 5

Cutover tooling and diagnostics.

Deliverables:

- feature flags
- diagnostics page or endpoint
- parity report helpers
- repair scripts

### PR 6

Legacy sunset.

Deliverables:

- disable legacy control-plane reads
- stop obsolete legacy writes
- remove dead compatibility code

## Cutover Gates

All of the following must pass before legacy read paths are disabled:

- official skill manifests fully migrated to the unified contract
- user-installed skills become discoverable immediately after synchronous registration
- `search_sdk` works correctly with canonical registry as the only control-plane read source
- uninstall/enable/disable flows update canonical registry correctly
- diagnostics clearly show registry state and lagging async indexing state
- rollback flag is tested

## Rollback Strategy

During the migration window:

- keep dual writes
- keep a feature flag for registry-based discovery
- keep a fallback to the old read path only as an emergency rollback switch

After cutover:

- remove old reads quickly
- keep short-lived repair tooling, not permanent dual-decision logic

## First Implementation Slice

This rollout starts with:

- design doc
- canonical registry table and store APIs
- local skill dual-write into canonical registry
- uninstall cleanup for canonical registry rows

This slice intentionally does not yet switch `search_sdk` to read the new registry.
