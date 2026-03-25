## Overview
Add a one-click BoxLite installer to `Settings -> Desktop Sandbox` in the desktop app.

### Goals / success criteria
- Desktop Sandbox shows an **Install BoxLite** action only when readiness is `needs_boxlite`.
- Install uses an **official BoxLite release URL**, a **fixed pinned version**, and **SHA256 verification** before the matching Linux wheel is installed into WSL.
- The app starts a thin **Deeting WSL bridge** so the existing `/v1/boxes` backend can keep working.
- **No WSL auto-install** is added; `needs_wsl` stays manual/instructional only.

### Out of scope
- Auto-updating BoxLite after install
- Silent/background WSL install or enablement
- Broad sandbox architecture changes outside BoxLite install UX

## Prerequisites
- Reuse existing Rust deps in `deeting/src-tauri/Cargo.toml` (`reqwest`, `tokio`, `sha2` already exist).
- Pin the upstream `v0.6.0` Linux wheels and SHA256 values for supported WSL Python ABIs (`cp310`-`cp313`).
- Assume WSL already has a supported `python3`; if not, install should fail with a clear error.

## Implementation steps
### Step 1: Add backend installer flow
- **Modify:** `deeting/src-tauri/src/modules/sandbox/provisioner.rs`
- **Create (preferred):** `deeting/src-tauri/src/modules/sandbox/installer.rs`
- Add a small install pipeline:
  1. create sandbox dir,
  2. detect WSL Python ABI,
  3. download the matching pinned wheel from the official release URL to a temp file,
  4. compute SHA256 and compare to the pinned hash,
  5. extract the verified wheel into a managed WSL site-packages directory,
  6. write an install record plus the embedded bridge script path,
  7. clean up temp files on success/failure.
- Keep installer Windows-only and return `SandboxError` messages that are user-safe.
- Keep `resolve_binary()`/status semantics pointing at the managed bridge installation so existing readiness code keeps working.

### Step 2: Expose install from sandbox manager/commands
- **Modify:**
  - `deeting/src-tauri/src/modules/sandbox/types.rs`
  - `deeting/src-tauri/src/modules/sandbox/manager.rs`
  - `deeting/src-tauri/src/modules/sandbox/commands.rs`
  - `deeting/src-tauri/src/commands.rs`
  - `deeting/src-tauri/src/modules/sandbox/mod.rs` (if new installer module is added)
- Add `install_boxlite()` on `SandboxRuntimeManager` that:
  - refuses to run unless Windows readiness is `NeedsBoxLite`,
  - downloads + verifies + installs the pinned wheel into WSL,
  - refreshes backend state,
  - returns the updated `SandboxReadinessReport`.
- Add a Tauri command like `install_local_boxlite` and register it.
- Update `SandboxReadinessReport` / `SandboxInstallGuide` only if needed for richer UI copy (for example pinned version text); do **not** reintroduce WSL auto actions.
- Tighten `can_auto_prepare` so it remains for prepare/repair only; install is a separate explicit action.

### Step 3: Update readiness messaging and guide rules
- **Modify:** `deeting/src-tauri/src/modules/sandbox/manager.rs`
- Keep `NeedsWsl` guide manual-only (`wsl --install` copyable, but no install command/button).
- Update `NeedsBoxLite` guide text to describe the managed install path and the pinned release/version.
- Preserve `RepairNeeded` and `Ready` guide behavior.
- Ensure install CTA is conceptually gated by `status == NeedsBoxLite` only.

### Step 4: Wire frontend API + hooks
- **Modify:**
  - `deeting/lib/api/sandbox.ts`
  - `deeting/lib/swr/use-sandbox-status.ts` (only if a helper/mutation wrapper improves reuse)
- Add `installLocalBoxLite()` that invokes `install_local_boxlite` and parses the updated readiness report.
- If guide/report shape changes, extend the Zod schemas and exported types.
- Keep existing `prepareLocalSandbox()` and `repairLocalSandbox()` unchanged.

### Step 5: Update Settings UI
- **Modify:**
  - `deeting/app/[locale]/settings/components/desktop-sandbox-settings-card.tsx`
  - `deeting/messages/en/settings.json`
  - `deeting/messages/zh-CN/settings.json`
- Add an installing state + toast flow.
- Show the new install button only when `data?.status === "needs_boxlite"`.
- Continue showing:
  - Refresh always,
  - Prepare only for existing prepare-eligible states,
  - Repair only for `repair_needed`.
- For `needs_wsl`, keep the manual guide/copy-command UI and do not render the install CTA.
- Surface pinned version / verified-download wording in copy so the user understands the trust model.

## File changes summary
### Create
- `deeting/src-tauri/src/modules/sandbox/installer.rs` (preferred; keep download/verify logic isolated)
- `deeting/app/[locale]/settings/components/desktop-sandbox-settings-card.test.tsx` (if no existing card test exists)

### Modify
- `deeting/src-tauri/src/modules/sandbox/mod.rs`
- `deeting/src-tauri/src/modules/sandbox/provisioner.rs`
- `deeting/src-tauri/src/modules/sandbox/types.rs`
- `deeting/src-tauri/src/modules/sandbox/manager.rs`
- `deeting/src-tauri/src/modules/sandbox/commands.rs`
- `deeting/src-tauri/src/commands.rs`
- `deeting/lib/api/sandbox.ts`
- `deeting/lib/swr/use-sandbox-status.ts` (optional/minimal)
- `deeting/app/[locale]/settings/components/desktop-sandbox-settings-card.tsx`
- `deeting/messages/en/settings.json`
- `deeting/messages/zh-CN/settings.json`
- `deeting/lib/api/__tests__/sandbox.test.ts`

### Delete
- None

## Testing strategy
- **Rust unit tests**
  - `manager.rs`: install allowed only for `NeedsBoxLite`; `NeedsWsl` remains manual-only.
  - `provisioner.rs` / `installer.rs`: SHA mismatch fails; successful verify/install lands at managed binary path.
- **Frontend API tests**
  - `deeting/lib/api/__tests__/sandbox.test.ts`: assert new Tauri command invocation and schema parsing.
- **Frontend UI tests**
  - New card test: install button renders only for `needs_boxlite`; absent for `needs_wsl` / `repair_needed`; clicking install triggers refresh/toast flow.
- **Manual smoke**
  - Windows desktop: `needs_boxlite` -> install -> refresh -> prepare -> ready.
  - `needs_wsl`: no install button, only manual WSL instructions.

## Rollback plan
- Revert the new Tauri command and UI button.
- Remove pinned wheel metadata / bridge installer module.
- Sandbox falls back to current behavior: no managed BoxLite install, only existing prepare/repair and host fallback behavior.

## Estimated effort
- **Complexity:** Medium
- **Rough effort:** 0.5-1.5 days depending on upstream asset format (direct binary vs archive) and Windows smoke-test availability.

