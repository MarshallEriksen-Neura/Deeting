# System Asset Sync and Authorization Redesign

## Goal

Replace the current plugin/assistant/system sync patchwork with a single system asset model that cleanly separates memory from capability and lets cloud authorization, desktop sync, local discovery, and execution form a closed loop.

## Scope assumptions

- Project is still in development; we do **not** preserve legacy compatibility.
- Official skills remain a single source tree in `packages/official-skills`.
- Cloud becomes the only business source of truth for system assets and policy.
- Default visibility policy is mixed:
  - sensitive/admin assets => `hidden`
  - requestable but unavailable assets => `metadata_only`
  - allowed assets => `executable`

## Target model

We standardize all synced assets into four business quadrants:

- `user_memory`
- `user_capability`
- `system_memory`
- `system_capability`

Platform-only support collections such as semantic cache stay outside the business model.

## System asset registry

Backend introduces one normalized registry contract for both system memory and system capability.

Required fields:

- `asset_id`
- `asset_kind` = `memory | capability`
- `owner_scope` = `system | user`
- `source_kind` = `official | community | private | local_dev`
- `version`
- `status`
- `visibility_scope`
- `local_sync_policy`
- `execution_policy`
- `permission_grants`
- `artifact_ref`
- `checksum`
- `metadata_json`

`plugin_market`, `assistant market`, and future official bundles become projections over this registry instead of independent sync models.

## Qdrant target shape

Cloud Qdrant gets explicit business lanes:

- `user_memory`
- `user_capability`
- `system_memory`
- `system_capability`
- `semantic_cache` (infra)
- `candidates` (staging)

This removes the current ambiguous “system bucket” and lets memory recall and capability discovery evolve independently.

## Desktop sync contract

Desktop no longer treats sync as “download then register everything”.

Cloud returns a per-asset policy snapshot with user-resolved authorization. Desktop materializes each asset into exactly one local state:

- `hidden`: do not project into local discovery or executable stores
- `metadata_only`: store searchable metadata only; no executable registration
- `executable`: install or register locally and expose to runtime discovery

Install state becomes only one input into materialization; it is no longer the whole model.

## Desktop local projections

Desktop stores split by business role:

- local system asset catalog (`asset_id`, `version`, policy snapshot, materialization state)
- local capability installs (`installed`, `enabled`, `artifact_path`, granted permissions)
- local memory projections (`indexed`, `version`, recall metadata)

`search_sdk` reads only local projections. It never infers executability from raw cloud rows.

## Search and execution loop

`search_sdk` continues to produce three lanes, but now from explicit materialization state:

- `callable_now` => executable + installed/enabled + permission-allowed
- `installable` => metadata-only or not-yet-installed but allowed to install
- `advisory` => visible but not locally executable for current user

`execute_code_plan` remains the final gate:

- accepts only tools from the latest `callable_now` snapshot
- rechecks permission grants / role gates / risk policy
- returns explicit install or authorization errors on mismatch

## Authoring and release flow

- Official capability source of truth stays in `packages/official-skills`
- Backend owns artifact publishing, registry records, and policy
- Desktop may prebundle selected artifacts, but those are published outputs, not a second editable source tree

This keeps development easy without creating dual truth between backend and desktop.

## Writeback loop

Desktop reports back:

- install/uninstall
- enable/disable
- materialization failures
- execution success/failure
- permission denials
- last used timestamps

This closes the loop for policy debugging, ranking, auditing, and future org-level controls.

## Cutover strategy

Because compatibility is out of scope, we do a direct cutover:

1. add normalized backend asset registry + sync APIs
2. add desktop system asset catalog + materialization states
3. move `search_sdk` and execution to the new catalog
4. delete legacy plugin/assistant-specific sync paths once parity is reached

## Success criteria

- Cloud is the only source of truth for system asset policy
- Desktop sync never confuses visible assets with executable assets
- Unauthorized assets can be hidden or metadata-only without custom code paths
- `search_sdk` + `execute_code_plan` remain closed-loop for capability execution
- Qdrant naming and ownership map directly to the four business quadrants