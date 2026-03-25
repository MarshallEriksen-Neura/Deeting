## BoxLite One-Click Install Design

### Scope
- Add one-click BoxLite install in `Settings -> Desktop Sandbox`
- Use official release URL
- Pin a fixed version for v1
- Verify SHA256 before install
- Do not automate WSL installation

### Product Constraints
- Show install action only when sandbox status is `needs_boxlite`
- Keep `needs_wsl` flow manual with install guide and copyable `wsl --install`
- Keep `repair_needed` flow on existing `Prepare` / `Repair`
- Do not add Code Mode modal in this phase

### Architecture
- Add `sandbox/installer.rs` for download, integrity verification, and atomic install
- Keep `sandbox/provisioner.rs` focused on process lifecycle and health checks
- Keep `sandbox/manager.rs` as orchestration layer for readiness, install, prepare, and repair
- Expose a new Tauri command `install_local_sandbox_boxlite`

### Install Flow
1. Validate platform support, WSL readiness, and WSL Python ABI support
2. Resolve the pinned official Linux wheel matching the detected ABI (for example `cp311`)
3. Download the wheel to the managed desktop sandbox directory
4. Compute SHA256 and compare with the embedded manifest value
5. Extract the wheel into a managed WSL site-packages directory
6. Start the Deeting thin bridge inside WSL with `PYTHONPATH` pointing at the installed wheel
7. Run `prepare()` to refresh the runtime backend and return the updated `SandboxReadinessReport`

### Security Boundaries
- Do not accept download URL or target path from the frontend
- Only write to the managed sandbox directory
- Remove temporary files on verification failure
- Start only the embedded Deeting bridge script with a pinned official wheel and pinned checksum

### UX
- Add `Install BoxLite` button to Desktop Sandbox settings card when `status === needs_boxlite`
- Show loading state while install runs
- Refresh readiness and guide on success
- Surface clear errors for download, checksum, file write, and prepare failures

### Error Handling
- `needs_wsl`: block install and return current readiness guidance
- download failure: preserve current binary and report install error
- checksum mismatch: delete temporary file and fail fast
- prepare failure after successful write: return refreshed readiness, usually `repair_needed`

### Testing
- Rust unit tests for release manifest selection, SHA256 verification, and install path logic
- Rust integration-oriented tests for manager install gating and post-install readiness transitions
- Frontend API/schema tests for install command response
- Settings card test for install button visibility and invocation