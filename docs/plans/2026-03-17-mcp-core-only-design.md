# MCP Core-Only Refactor Design

**Goal:** Reduce desktop MCP to MCP-only responsibilities while moving all other business logic back to their owning modules, preserving existing functionality.

**Scope (In):**
- MCP core: source/tool config + sync, transport + process management, tool execution + approval/risk, MCP gateway + logs, MCP tool catalog and availability.
- New `desktop_runtime` module to own local orchestration and cross-domain capability routing.

**Scope (Out):**
- Admin, assistants, conversations, knowledge, skills/skill_runtime, memory, monitor, providers, scan, sandbox business logic.
- Any remaining MCP command wrappers or store parts that proxy business logic.

## Architecture

### Core Modules
- `modules/mcp/*`: MCP-only runtime, storage, transport, tool execution, approvals, logs.
- `modules/desktop_runtime/*`: local orchestration (route selection, code mode orchestration, capability discovery/consult, desktop capability dispatch, local chat routing).

### Business Modules (own their commands + stores)
- `modules/admin`, `assistants`, `conversations`, `knowledge`, `skills`, `skill_runtime`, `memory`, `monitor`, `providers`, `scan`, `sandbox`.

## Data Flow (High-Level)
- UI invokes `tauri::command` directly on the owning module.
- Local orchestration runs in `desktop_runtime` and calls into business modules via their public APIs.
- MCP core remains the execution/transport layer for MCP tools only.

## Error Handling
- Keep existing error payload shapes at command boundaries.
- Avoid introducing new compatibility shims; remove MCP wrappers once direct module commands are wired.
- If baseline tests fail, use targeted verification and document known blockers.

## Testing Strategy
- Use targeted `cargo check` / focused `cargo test` for affected modules.
- Fix duplicate `tauri::command` macro definitions as part of extraction.
- Treat pre-existing failing tests as baseline; note and isolate when verifying.

## Migration Strategy
- Create `desktop_runtime` module and move orchestration files unchanged first.
- Delete MCP command wrappers that duplicate module commands.
- Move non-core MCP store parts to module stores or remove if already migrated.
- Trim MCP public types and re-exports to MCP-only types.
- Keep incremental compile checks after each move.

## Non-Goals
- No product changes.
- No UI behavior changes.
- No new compatibility layers beyond the existing ones already split.
