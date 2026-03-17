# MCP Refactoring Plan V2

## Goal

Start a real MCP migration without breaking the desktop runtime in one shot.

This plan treats the current `registry-first` architecture as the source of truth:

- SQLite capability registry is the desktop control plane.
- LanceDB and memory assets stay in the search plane.
- `control_plane`, `execution_plane`, and `desktop_capabilities` are first-class runtime domains.
- Migration should favor compatibility shims and narrow, verifiable slices over a one-time big bang split.

## Current Baseline

The active MCP implementation still lives under:

- `deeting/src-tauri/src/modules/mcp/`
- `deeting/src-tauri/src/modules/mcp/commands/runtime/`
- `deeting/src-tauri/src/modules/mcp/store/`

Current pressure points:

- `McpRuntimeState` is still a heavy aggregation point.
- `types.rs` is too broad and mixes core MCP primitives with app-local session/admin payloads.
- `commands/runtime` contains multiple distinct runtime concerns that should not migrate as a single unit.
- Capability registry and diagnostics are already central to runtime truth, so they must not be treated as optional add-ons.

## Migration Rules

Each phase must follow these rules:

1. Prefer additive extraction plus compatibility re-exports.
2. Do not mass-update imports unless the phase explicitly targets call-site cleanup.
3. Keep runtime behavior unchanged before and after each slice.
4. End every phase with formatting plus targeted `cargo check`.
5. Do not move `control_plane`, `execution_plane`, or capability-registry code until their storage/runtime contracts are explicit.

## Target Structure

The end state is still multi-crate, but the order is updated to reflect the current codebase:

1. `mcp-core`
2. `mcp-registry`
3. `mcp-runtime`
4. `mcp-storage`
5. `mcp-transport`
6. `mcp-session`
7. `mcp-facade`

Notes:

- `mcp-core` holds shared error, types, and contracts only.
- `mcp-registry` becomes the home for capability-registry truth and diagnostics helpers.
- `mcp-runtime` owns control-plane and execution-plane policy/orchestration.
- `mcp-storage` stays below registry/runtime, but its split must preserve SQLite schema and write semantics.

## Phases

### Phase 0: Workspace Scaffolding

Outcome:

- Turn `deeting/src-tauri` into a workspace root while keeping the `app` package intact.
- Add the first extracted crate: `crates/mcp-core`.

Verification:

- `cargo fmt --all`
- `cargo check -p mcp-core`

Status:

- Started in this changeset.

### Phase 1: Core Primitive Extraction

Outcome:

- Move low-risk MCP primitives into `mcp-core`.
- Keep existing app imports working via re-exports from `modules/mcp/types.rs` and `modules/mcp/error.rs`.

First extraction set:

- `McpError`
- source enums and structs
- tool enums and structs
- transport-kind helpers
- config payloads and source/tool config requests
- MCP log entry types

Non-goals:

- No assistant/session/admin payload moves yet.
- No runtime trait abstraction yet.

Verification:

- `cargo check -p mcp-core`
- `cargo check -p app`

Status:

- Started in this changeset.

### Phase 2: Registry Domain Extraction

Outcome:

- Pull capability-registry storage models and registry read/write helpers into `mcp-registry`.
- Keep current diagnostics parity behavior intact.

Scope:

- `store/capability_registry.rs`
- runtime capability-registry helpers
- maintenance diagnostics helpers

Exit criteria:

- Registry-first runtime behavior is unchanged.
- Diagnostics still expose migration gaps correctly.

Status:

- Completed with a dedicated `mcp-registry` crate for registry data models plus asset/diagnostics helpers.
- `McpStore`-owned registry methods remain as compatibility wrappers because Rust requires inherent methods to stay with `McpStore`'s defining crate.

### Phase 3: Runtime Policy Extraction

Outcome:

- Extract `control_plane`, `execution_plane`, route selection, and prompt planning into `mcp-runtime`.

Scope:

- `commands/runtime/control_plane.rs`
- `commands/runtime/execution_plane.rs`
- `commands/runtime/route_selector.rs`
- `commands/runtime/prompt_*`
- code-mode orchestration helpers that are purely runtime policy

Exit criteria:

- Direct, worker, and code-mode routing decisions are stable.
- Approval and suspended execution flows still work.

Status:

- Completed with a dedicated `mcp-runtime` crate for route selection, execution-policy types, and prompt-plan data/rendering helpers.
- App-local runtime wrappers remain for desktop-specific concerns such as capability discovery, tray language preference, code-mode prompt injection, and custom task agent selection.

### Phase 4: Storage Extraction

Outcome:

- Move `McpStore` and storage submodules into `mcp-storage`.

Constraints:

- Preserve SQLite schema.
- Preserve dedicated write-pool locking behavior.
- Do not silently change migration/init sequencing.

Status:

- Completed with a dedicated `mcp-storage` crate for storage-domain value objects and generic storage helpers.
- `McpStore` and its inherent methods remain in the app crate as compatibility wrappers and query owners, while shared storage structs and helper utilities now live outside the app crate.

### Phase 5: Transport Extraction

Outcome:

- Move bridge, gateway, and remote transport pieces into `mcp-transport`.

Constraints:

- Preserve stream behavior and tracing surfaces.
- Keep local gateway and cloud bridge contracts stable.

Status:

- Completed with a dedicated `mcp-transport` crate for remote transport clients, bridge stream helpers, and gateway transport request/response models.
- App-local bridge and gateway files now act as thin wrappers around the new crate while keeping Tauri command wiring and orchestrator bindings in the app crate.

### Phase 6: Session and Admin Extraction

Outcome:

- Move assistant, session, and admin command payloads and related managers into `mcp-session`.

Notes:

- This phase intentionally happens after runtime/storage because current session flows depend on both heavily.

Status:

- Completed with a dedicated `mcp-session` crate for assistant, conversation, admin, and session-context types.
- `mcp/types.rs` is now primarily a domain aggregation layer, while `store/mod.rs` re-exports session-context structs for compatibility with existing `McpStore` call sites.

### Phase 7: Facade and Cleanup

Outcome:

- Introduce a thinner facade over the extracted crates.
- Shrink `McpRuntimeState` into a composition root rather than a god object.
- Remove compatibility shims only after downstream imports are migrated.

Status:

- Completed with a dedicated `mcp-facade` crate for pending-tool and approval context types plus transport/approval facade sub-structures.
- `McpRuntimeState` now acts as a composition root over `store`, `process_manager`, `transport`, and `approvals` instead of carrying all transport/approval fields flat at the top level.
- Remaining compatibility wrappers are limited to app-local command wiring and module re-exports; the main migration stages are complete.

## Working Status

Completed now:

- V2 migration roadmap written.
- Workspace scaffolding introduced.
- `mcp-core` crate created.
- Phase 1 completed with compatibility-first re-exports.
- `mcp-registry` crate created and Phase 2 completed for registry data, asset shaping, and diagnostics helpers.
- `mcp-runtime` crate created and Phase 3 completed for runtime policy, route, and prompt helper extraction.
- `mcp-storage` crate created and Phase 4 completed for storage-domain structs and shared helper extraction.
- `mcp-transport` crate created and Phase 5 completed for bridge, gateway transport models, and remote transport client extraction.
- `mcp-session` crate created and Phase 6 completed for assistant, conversation, admin, and session-context extraction.
- `mcp-facade` crate created and Phase 7 completed for runtime facade/composition-root cleanup.

Next recommended slice:

1. Finish with a full compile and test verification pass once the Windows linker blocker is resolved.
2. Prune compatibility wrappers opportunistically after successful verification.
3. Commit the staged migration once the repo is in a clean verified state.
