# System Asset Sync Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace legacy plugin/assistant/system sync with a unified system asset registry, permission-aware desktop materialization, and a four-quadrant memory/capability architecture.

**Architecture:** Backend becomes the single business source of truth for `system_memory` and `system_capability`, while desktop keeps only local projections and execution state. Sync returns a user-resolved policy snapshot, and desktop materializes each asset as `hidden`, `metadata_only`, or `executable` before discovery and execution.

**Tech Stack:** FastAPI, SQLAlchemy, Qdrant, Rust/Tauri, SQLite, existing desktop capability discovery/runtime.

---

### Task 1: Create the unified backend system asset registry
**Files:**
- Create: `backend/app/models/system_asset.py`
- Create: `backend/app/repositories/system_asset_repository.py`
- Create: `backend/app/schemas/system_asset.py`
- Create: `backend/app/services/system_assets/registry_service.py`
- Create: `backend/app/api/v1/system_assets_route.py`
- Modify: `backend/main.py`

Acceptance criteria:
- Backend has one normalized registry contract for system assets.
- Assets support `memory | capability` and policy fields (`visibility_scope`, `local_sync_policy`, `execution_policy`, `permission_grants`).
- Desktop can request a single sync feed instead of mixing plugin and assistant market endpoints.

### Task 2: Map official skills and system assistants into registry-backed projections
**Files:**
- Modify: `packages/official-skills/**/deeting.json` as needed for normalized policy fields
- Modify: `backend/app/services/plugin_market_service.py`
- Modify: `backend/app/services/assistant/assistant_market_service.py`
- Modify: `backend/app/api/v1/plugin_market_route.py`
- Modify: `backend/app/api/v1/assistants_route.py`
- Test: `backend/tests/api/test_assistant_market.py`
- Test: `backend/tests/services/test_skill_registry_service.py`

Acceptance criteria:
- Official skills and system assistants are published through the same registry concepts.
- Existing market endpoints become projections over registry data instead of owning authorization logic themselves.
- Builtin/offical policy is represented in one normalized place.

### Task 3: Split cloud Qdrant responsibilities by the four business quadrants
**Files:**
- Modify: `backend/app/storage/qdrant_kb_collections.py`
- Modify: `backend/app/services/memory/qdrant_service.py`
- Modify: `backend/app/services/tools/tool_sync_service.py`
- Modify: `backend/app/services/assistant/assistant_market_service.py`
- Test: `backend/tests/test_tool_sync_service.py`
- Test: `backend/tests/services/test_assistant_qdrant_indexing.py`

Acceptance criteria:
- Qdrant collection naming explicitly distinguishes `user_memory`, `user_capability`, `system_memory`, and `system_capability`.
- Tool and assistant indexing no longer land in an ambiguous shared system bucket.
- Semantic cache and candidate staging remain clearly infra-only.

### Task 4: Add a unified desktop system asset catalog and sync command
**Files:**
- Create: `deeting/src-tauri/src/modules/mcp/store/system_assets.rs`
- Create: `deeting/src-tauri/src/modules/mcp/commands_parts/system_asset_sync.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/mod.rs`
- Modify: `deeting/src-tauri/src/commands.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

Acceptance criteria:
- Desktop can pull one normalized system asset feed.
- Local storage records `asset_id`, version, policy snapshot, and materialization state.
- Legacy plugin install sync and assistant market sync are no longer the primary synchronization spine.

### Task 5: Replace ad-hoc skill and assistant sync with explicit materialization states
**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands_parts/skill_registry.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands_parts/source_management.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/assistants.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/mod.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

Acceptance criteria:
- System capabilities become `hidden`, `metadata_only`, or `executable` before local registration.
- Official skills are no longer auto-registered just because the directory exists.
- System assistants and skills follow the same local policy lifecycle.

### Task 6: Make discovery and execution consume only materialized local state
**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/capability_discovery.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

Acceptance criteria:
- `callable_now` contains only executable assets that are locally installed/enabled and permission-allowed.
- `installable` and `advisory` are derived from materialization state, not heuristics scattered across source types.
- Execution still refuses tools outside the last approved callable snapshot.

### Task 7: Add state writeback and policy diagnostics
**Files:**
- Create: `backend/app/api/v1/system_asset_feedback_route.py`
- Create: `backend/app/services/system_assets/feedback_service.py`
- Modify: `backend/main.py`
- Modify: `deeting/src-tauri/src/modules/mcp/commands_parts/system_asset_sync.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/system_assets.rs`
- Test: `backend/tests/api/test_plugin_market.py`
- Test: `backend/tests/services/test_assistant_market_flow.py`

Acceptance criteria:
- Desktop reports install/enable/materialization/execution outcomes back to cloud.
- Backend can inspect why an asset is visible but not executable.
- Future ranking, auditing, and approval workflows have stable state to build on.

### Task 8: Delete legacy sync paths and verify the new closed loop
**Files:**
- Modify: `docs/api/plugin-market.md`
- Modify: `docs/api/assistant-market.md`
- Modify: `docs/api/desktop-local-memory.md`
- Modify: `docs/api/skills.md`
- Test: `backend/tests/api/test_plugin_market.py`
- Test: `backend/tests/api/test_assistant_market.py`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

Acceptance criteria:
- Legacy sync APIs or tables that are now redundant are removed or dead-code-eliminated.
- Documentation reflects the new system asset model and desktop materialization states.
- End-to-end verification proves the loop: publish -> sync -> materialize -> discover -> execute -> write back.