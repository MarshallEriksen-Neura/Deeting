# Deeting Security Architecture

> Scope: desktop tool-call risk assessment, approval gates, session-level grants, sandbox execution boundaries, hard constraints on sensitive paths and networks.
> Out of scope: the DAG / Approval Gate node state machine ([agent-dag-architecture.en.md](./agent-dag-architecture.en.md)); the memory write gate ([memory-architecture.en.md](./memory-architecture.en.md)).

This document is for anyone who wants to understand Deeting's full mechanism for "is this tool call going to do something harmful / when do we ask the user / when do we just refuse." Three actors cooperate:

- **Risk Assessment**: produces a `ToolRiskAssessment` before every tool call.
- **Approval Gate**: high-risk calls enter an `ApprovalGate` node on the DAG and wait for the user.
- **Sandbox Runtime**: high-risk execution is confined to the BoxLite sandbox (host / native / WSL backends).

## 1. TL;DR

Deeting desktop does things that may be **destructive** — shell commands, browser automation, file writes, network access. The security policy must answer two questions:

1. **Should this call be intercepted and asked?** (Risk Assessment + Approval Gate)
2. **If we cannot intercept, can it run in a sandbox instead of directly on the host?** (Sandbox Runtime)

The core model behind these answers is **three-dimensional risk classification**:

```
ToolRiskAssessment {
    operation_class: NetworkRead | FilesystemRead | FilesystemWrite | ProcessExec | Unknown,
    target_class:    PublicInternet | PrivateNetwork | Localhost | SensitivePath | Host | Unknown,
    boundary_class:  None | SoftBoundary | HardBoundary,
}
```

Plus a `risk_level` tag (LOW / MEDIUM / HIGH / CRITICAL) and a `reasons` text array (so the UI can explain why).

Engineering discipline:
- **`boundary_class` is the actual switch.** `HardBoundary` always requires approval every time (no grant). `SoftBoundary` can be session-granted. `None` is direct-pass.
- **`operation_class × target_class` determines `grant_eligible`.** Only "SoftBoundary + non-ProcessExec + PublicInternet or Unknown" can be granted "this session, do not ask again."
- **The risk assessors are pure functions.** Given the same (tool_name, arguments), they always produce the same assessment. This is the prerequisite for audit, replay, and PR review.

Core code:

```
deeting/src-tauri/src/modules/
├── mcp/
│   ├── risk.rs                     // ToolRiskAssessment + three assess_* functions + URL/path classifiers
│   ├── commands/
│   │   └── runtime/
│   │       └── tool_execution.rs   // actual execution entry: assess first, then approval / direct
│   └── store/...                   // persistence of grant key / approval records
├── desktop_runtime/runtime/
│   ├── chat_tool_runtime/
│   │   ├── mod.rs                  // agentic loop hooks risk assessment
│   │   ├── approval_commands.rs    // Tauri approve / reject commands
│   │   └── inflight.rs             // PersistedPendingApproval carries risk_level / risk_reasons
│   └── capability_control_plane.rs // capability gate (which tools can be discovered)
├── capability_control_plane/
│   └── store.rs                    // capability grant / revoke persistence
└── sandbox/
    ├── mod.rs / manager.rs         // sandbox top entry (multi-backend switching)
    ├── backend_host.rs             // Host Python (in-host process)
    ├── backend_native.rs           // Native (in-process embedded)
    ├── backend_wsl.rs              // Windows WSL backend (Windows-only)
    ├── installer.rs                // BoxLite installer (first-time setup)
    ├── boxlite_sidecar_client.rs   // local HTTP/WS client to the BoxLite sidecar
    └── provisioner.rs              // backend selection / preparation
```

## 2. Why this way

Pitfalls of naive security models:

1. **"We'll ask anyway" trap.** Asking on every tool = user approval fatigue → user blindly clicks Approve → equivalent to no protection.
2. **"Whitelist" trap.** Maintain a whitelist of allowed tools — but tool `arguments` vary endlessly. The same `browser_open_tab` is wildly different risk for `https://example.com` vs `http://127.0.0.1:8080/admin`.
3. **"Risk scoring" trap.** Combine all dimensions into one 0-100 score → on PR review nobody can explain "why was 87 the cutoff."
4. **"Auto-learn approval" trap.** Let the model learn "what the user usually approves" — this gives an attacker a learnable interface; prompt injection can "teach" the model to auto-approve dangerous operations.

Deeting's choices:

| Naive pitfall | Deeting's approach |
|---|---|
| One-size approval | Three-dimensional classification: operation × target × boundary, **orthogonal semantics** |
| Combine dimensions into one score | Each dimension keeps its own enum; the score (risk_level) is just a UI tag; decisions go through `boundary_class` |
| Tool whitelist | Tool + arguments jointly assessed; the same tool with a different URL produces different assessment |
| Auto-learn approvals | Grants are only created by **explicit user action**; we don't learn, don't predict, don't autocomplete |
| Sandbox optional | High-risk execution **must** enter the sandbox; sandbox unavailable = operation unavailable |
| Single-window approval | Approval flows through the DAG's `ApprovalGate` node, persistent across processes |

## 3. Three-dimensional risk model

[`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs).

### 3.1 `RiskOperationClass`

```rust
pub enum RiskOperationClass {
    Unknown,            // cannot classify (usually LOW)
    NetworkRead,        // network read (HTTP GET / browser navigation / remote MCP)
    FilesystemRead,
    FilesystemWrite,
    ProcessExec,        // process execution (shell / browser automation / dangerous scripts)
}
```

`ProcessExec` is **the highest level** — combined with `Host` target it is always `HardBoundary`, never grantable.

### 3.2 `RiskTargetClass`

```rust
pub enum RiskTargetClass {
    Unknown,
    Host,               // the host itself (exec / write / sensitive read)
    PublicInternet,     // the public internet (example.com)
    PrivateNetwork,     // private networks (10.x / 192.168.x / .local / .internal)
    Localhost,          // loopback (127.0.0.1 / localhost)
    SensitivePath,      // /etc /root /home /usr /bin /sbin /boot
}
```

**`Localhost` and `PrivateNetwork` are deliberately treated as high-sensitivity** in Deeting, because:

- `127.0.0.1:8080/admin` is usually the user's own background/admin panel
- `192.168.x` is the user's home/office network
- Allowing "the model to operate freely on these" hands LAN admin to the AI

> This is the core anti-SSRF surface. Many generic agent frameworks treat localhost as "safe by default"; Deeting **explicitly treats it as HardBoundary**.

### 3.3 `ApprovalBoundaryClass`

```rust
pub enum ApprovalBoundaryClass {
    None,              // no approval needed
    SoftBoundary,      // approval needed, but can be granted at session level
    HardBoundary,      // approval needed every time, never granted
}
```

**`HardBoundary` is the discipline core**:
- Any `ProcessExec`
- Any write to `SensitivePath`
- Any access to `Localhost` / `PrivateNetwork`
- Any shell-like / destructive keyword

all forcibly upgrade to `HardBoundary`. This line **cannot be bypassed by business code**.

### 3.4 Example combinations

| Tool + context | operation_class | target_class | boundary_class | risk_level |
|---|---|---|---|---|
| `browser_agent_status` | Unknown | Unknown | None | LOW |
| `browser_get_active_page` | NetworkRead | Unknown | None | LOW |
| `browser_open_tab` (https://example.com) | NetworkRead | PublicInternet | SoftBoundary | MEDIUM |
| `browser_open_tab` (http://127.0.0.1:8080) | NetworkRead | Localhost | HardBoundary | HIGH |
| `browser_click` | ProcessExec | Host | HardBoundary | HIGH |
| `browser_storage_write` | ProcessExec | Host | HardBoundary | HIGH |
| `shell_execute` | ProcessExec | Host | HardBoundary | HIGH |
| MCP tool with `bash` runtime, args contain `rm -rf` | ProcessExec | Host | HardBoundary | CRITICAL |
| MCP tool with `https://example.com` only | NetworkRead | PublicInternet | SoftBoundary | MEDIUM |
| Skill binding python + sensitive path read | FilesystemRead | SensitivePath | HardBoundary | HIGH |

## 4. The three risk assessors

[`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs) provides three entry points for three tool sources:

### 4.1 `assess_core_tool_risk(tool_name, arguments)`

For: Deeting's built-in core tools (browser_* / shell_execute / ...).

Approach: **per-tool hardcoded match arms.** Reason: the core tool set is stable and semantically clear; explicit classification is the most readable and safest. **Does not** use heuristic scoring.

Example (excerpt):

```rust
"shell_execute" => ToolRiskAssessment {
    requires_approval: true,
    risk_level: "HIGH",
    reasons: vec!["shell execution can mutate host state".to_string()],
    operation_class: RiskOperationClass::ProcessExec,
    target_class: RiskTargetClass::Host,
    boundary_class: ApprovalBoundaryClass::HardBoundary,
},
"browser_open_tab" => match classify_url_target(url) {
    Some(Localhost)        => HardBoundary HIGH,
    Some(PrivateNetwork)   => HardBoundary HIGH,
    Some(PublicInternet)   => SoftBoundary MEDIUM,
    _                      => SoftBoundary MEDIUM,
},
```

Discipline:
- Adding a core tool = new match arm = explicit classification.
- **Do not** wrap a layer that "auto-fills defaults" — unclassified tools must be flagged.

### 4.2 `assess_mcp_tool_risk(tool, arguments)`

For: third-party MCP tools.

Approach: **heuristic + weighted scoring.** Reason: MCP tools are an open set; we cannot enumerate them. Score by metadata (`source_type` / `command` / `args` / `capabilities`) + dangerous keyword detection.

Scoring dimensions (each match: +1 to +3):

| Detected | Points |
|---|---|
| Remote SSE MCP | +1, operation=NetworkRead, boundary=Soft |
| Local process lifecycle tool | +3, operation=ProcessExec, target=Host, boundary=Hard |
| Non-Local source_type | +2 |
| Dangerous keywords (command / args / arguments): `powershell`, `bash`, `rm`, `del`, `format`, `shutdown`, ... | +3, operation=ProcessExec, boundary=Hard |
| High-risk name (contains `delete`, `write`, `shell`, `execute`, `terminal`, ...) | merges with above |
| `capabilities` contains `shell`/`terminal`/`write`/`network`/`filesystem` | +1, boundary escalates by specific capability |
| `arguments.path` matches `/etc /root /home /usr /bin /sbin /boot` | +2, target=SensitivePath, boundary=Hard |
| `arguments.url` localhost / private network | +1, boundary=Hard |
| `arguments.url` is `http://` (cleartext) | +1, boundary raised to at least Soft |

Final risk_level: score ≥ 3 → HIGH, ≥ 2 → MEDIUM, else LOW.

### 4.3 `assess_skill_binding_risk(binding, arguments)`

For: local skills (bash / python / node scripts under `skills/`).

Approach: similar to MCP but with **higher starting score** (skills run a local runtime by default):

```rust
score += 1;
reasons.push("skill binding executes local runtime");
```

Plus runtime detection:
- `bash` → +3, ProcessExec, Host, Hard
- `python` → +2
- `node` → +2
- other → +1

`critical_keywords` (any match: +3, force HardBoundary):

```
"rm -rf", "rm -fr", "del /", "format ", "dd if=", "mkfs", "fdisk",
"> /dev/", "curl | bash", "curl | sh", "wget |",
"eval (", "exec (", "/bin/sh -c", "/bin/bash -c"
```

`warning_keywords` (+2, force HardBoundary):

```
"powershell", "pwsh", "cmd.exe", "wscript", "cscript", "rundll32",
"mshta", "shutdown", "reboot", "sudo ", "chmod 777", "chown ",
">/etc/", ">/root/", ">/home/"
```

Skill binding uses stricter 4-tier thresholds: `(critical=6, high=4, medium=2)` — any single critical_keyword hit pushes to CRITICAL.

### 4.4 Shared classifiers

[`classify_url_target(url)`](../deeting/src-tauri/src/modules/mcp/risk.rs):

```text
URL → host
host == "localhost" or ends_with(".localhost")  → Localhost
host is IPv4/IPv6:
    loopback                                     → Localhost
    private (RFC1918) / link-local / unspecified → PrivateNetwork
    other                                        → PublicInternet
host is a domain:
    ends_with .local / .internal / .lan / .home  → PrivateNetwork
    other                                        → PublicInternet
```

[`is_sensitive_path(path)`](../deeting/src-tauri/src/modules/mcp/risk.rs):

```text
sensitive_paths = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"]
any prefix match → true
```

> Note: these classifiers are Unix-friendly today. Windows paths like `C:\Windows`, `C:\Users\<u>\AppData` are **not** in the sensitive list — future extensions should add per-platform coverage (see §10.2).

## 5. Approval Grant (session-level)

### 5.1 grant_eligible conditions

[`ToolRiskAssessment::grant_eligible`](../deeting/src-tauri/src/modules/mcp/risk.rs):

```rust
pub fn grant_eligible(&self) -> bool {
    self.boundary_class == ApprovalBoundaryClass::SoftBoundary
        && !matches!(self.operation_class, RiskOperationClass::ProcessExec)
        && matches!(
            self.target_class,
            RiskTargetClass::PublicInternet | RiskTargetClass::Unknown
        )
}
```

Grantable **only when**:
- `SoftBoundary`
- not `ProcessExec`
- target is `PublicInternet` or `Unknown`

Meaning:
- Browser scraping the public internet can be granted "do not ask again this session"
- Any "open the localhost admin panel" is always asked
- Any shell execution is always asked

### 5.2 Grant key structure

```rust
pub fn policy_rule_key(&self, tool_fingerprint: &str) -> Option<String> {
    Some(format!(
        "{}|{}|{}|{}",
        tool_fingerprint,
        operation_class.as_str(),
        target_class.as_str(),
        boundary_class.as_str(),
    ))
}
```

Example: `fingerprint-1|network_read|public_internet|soft_boundary`

The key is the **primary key** of grants — the same `(fingerprint, op, target, boundary)` tuple is direct-pass within the session. Changed url to localhost? `target_class` flips → no match → asks again.

### 5.3 `SessionApprovalGrant`

```rust
pub struct SessionApprovalGrant {
    pub key: String,
    pub tool_fingerprint: String,
    pub operation_class: RiskOperationClass,
    pub target_class: RiskTargetClass,
    pub boundary_class: ApprovalBoundaryClass,
    pub created_at_unix_ms: i128,
}
```

`SessionApprovalGrant::from_key(key, now)` reverse-parses — storage persists only the key string; runtime parses dimensions on demand.

### 5.4 Historical compatibility (`approval_classes_from_key`)

[`approval_classes_from_key`](../deeting/src-tauri/src/modules/mcp/risk.rs) reads **only the last 3 segments** of a key — historical keys split tool fingerprints into more segments; today we care only about `operation|target|boundary` at the tail. The test `approval_classes_from_key_ignores_legacy_prefix_segments` guards this invariant.

## 6. Coordination with the DAG / Approval Gate

The full approval lifecycle is detailed in [agent-dag-architecture.en.md §9](./agent-dag-architecture.en.md#9-full-approval-gate-lifecycle). Here are the security-relevant integration points:

```text
chat_tool_runtime calls a tool
        ↓
mcp/commands/runtime/tool_execution.rs
        ↓
1. Pick assessor by source:
     core tool      → assess_core_tool_risk
     MCP tool       → assess_mcp_tool_risk
     skill binding  → assess_skill_binding_risk
2. Get ToolRiskAssessment
3. Check grant store: existing unexpired grant for this key?
     yes → direct pass (only if boundary != HardBoundary)
4. boundary_class:
     None          → execute directly
     SoftBoundary  → emit approval gate, wait for user
     HardBoundary  → emit approval gate, wait for user (no grant created)
5. After user approval:
     SoftBoundary + grant_eligible → write SessionApprovalGrant
     HardBoundary                  → no grant
6. PersistedPendingApproval carries:
     - risk_level / risk_reasons
     - policy_rule_key
     - approval_grant_key (if grantable)
     - tool_fingerprint
     → frontend display + persistence to the DAG
```

Full `PersistedPendingApproval` structure: see [agent-dag-architecture.en.md §9.1](./agent-dag-architecture.en.md#91-full-fields-of-persistedpendingapproval).

## 7. Sandbox Runtime

[`modules/sandbox/`](../deeting/src-tauri/src/modules/sandbox/) is the isolation layer for high-risk execution.

### 7.1 Three backends

```rust
pub enum SandboxRuntimeMode {
    Host,    // backend_host.rs — in-host child process (Python)
    Native,  // backend_native.rs — in-process embedded (light, limited)
    Wsl,     // backend_wsl.rs — Windows WSL Linux subsystem (Windows-only)
}
```

[`SandboxRuntimeManager`](../deeting/src-tauri/src/modules/sandbox/manager.rs) is the unified entry, picking the best backend per platform:

- **Windows**: prefer `Wsl` (real Linux isolation), fall back to `Host`.
- **macOS / Linux**: default `Host` (host Python process; `Native` can be added later).

Switching is done through `Arc<RwLock<Arc<dyn SandboxProvider>>>` for hot updates — supports runtime degradation.

### 7.2 BoxLite Sidecar

The actual isolation environment is **BoxLite** — an independently packaged sidecar process communicating via local HTTP/WebSocket bridge.

- [`installer.rs`](../deeting/src-tauri/src/modules/sandbox/installer.rs): installs BoxLite automatically on first launch (on WSL).
- [`boxlite_sidecar_client.rs`](../deeting/src-tauri/src/modules/sandbox/boxlite_sidecar_client.rs): local communication client to BoxLite.
- Default bridge discovery URL: `http://127.0.0.1:9090` ([`DEFAULT_BRIDGE_DISCOVERY_URLS`](../deeting/src-tauri/src/modules/sandbox/manager.rs)).

### 7.3 Security properties

Boundaries the sandbox provides:

- **Filesystem**: restricted mount points; does not see host `/` directly
- **Network**: can be policy-restricted
- **Process**: execution confined to the sandbox namespace
- **Persistence**: writes inside the sandbox do not auto-sync to host (requires explicit tools like `save_asset` — currently **experimentally disabled**, see risk.rs comments)

### 7.4 Status report

[`SandboxReadinessReport`](../deeting/src-tauri/src/modules/sandbox/manager.rs) gives the frontend a current-state view:

```text
{
  "runtime_mode": "wsl" | "host" | "native",
  "wsl": { ... WSL diagnostics },
  "boxlite": { ... installation state },
  "readiness": "ready" | "needs_setup" | "unavailable"
}
```

The "environment check" card in the UI reads this report.

### 7.5 Unavailable degradation

If the sandbox is unavailable (user has no WSL / BoxLite not installed / process dead):

- Default behavior: **the operation is disabled**, with the UI prompting the user to fix it on the setup page.
- **Never** silently fall back to "run directly on the host" — that would silently defeat the sandbox layer.
- This discipline is enforced by `sandbox manager`'s `is_available` check + the upper-layer `capability_control_plane` gate.

## 8. Capability Control Plane

[`capability_control_plane.rs`](../deeting/src-tauri/src/modules/capability_control_plane.rs) + [`capability_control_plane/store.rs`](../deeting/src-tauri/src/modules/capability_control_plane/store.rs) gate the tool **discovery** layer — not approval, but **visibility**:

```text
OfficialSkillHostToolRoute {
    DesktopCapability,   // built-in capability (e.g. deeting-* tools)
    SearchSdk,           // search_sdk tool
    GetToolSchema,       // meta-tool
    Unsupported,         // not supported → invisible
}
```

`resolve_official_skill_host_tool_route(tool_name)` decides whether a tool name is accepted by the runtime. **Unregistered tool names** (not a capability, not an SDK meta-tool, not search) are rejected upfront — an early gate before risk assessment.

Additionally, [`current_user_can_access_restricted_asset`](../deeting/src-tauri/src/modules/capability_control_plane.rs) implements role-based gating for **restricted assets** — some desktop capabilities are only available to specific user roles (admin / developer / default user).

## 9. Defense in Depth

Putting all layers together, a request like "the model decides to call shell_execute to delete /etc/passwd" gets intercepted like this:

```text
1. Capability Control Plane check
   - shell_execute is a registered core capability ✓ pass
   - User role permission ✓ pass

2. Risk Assessment (assess_core_tool_risk)
   - tool_name = shell_execute → HardBoundary, HIGH, ProcessExec, Host

3. Grant Store check
   - HardBoundary never matches a grant → must ask

4. DAG: create an ApprovalGate node
   - PersistedPendingApproval written to SQLite
   - inflight.stage = WaitingApproval
   - main loop returns, UI shows approval card

5. User sees the approval card
   - tool: shell_execute
   - risk_level: HIGH
   - reasons: ["shell execution can mutate host state"]
   - User clicks Reject

6. graph.approval_gate.status = Rejected
   - tool does not run, no grant created
   - next LLM round receives a tool_result that says "user rejected"

7. Even if user is fooled by prompt injection to click Approve:
   - HardBoundary creates no grant → next shell_execute still asks
   - The command (if Deeting is configured to sandbox the path) goes into the sandbox runtime
   - Sandbox's /etc is not the host /etc → host is not actually damaged

Every layer is independent, testable, and refusable. Any single layer failing does not mean overall security fails.
```

## 10. File map

By "what do I want to change":

| I want to… | Look here |
|---|---|
| Change a core tool's risk level | [`mcp/risk.rs::assess_core_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) — the corresponding match arm |
| Change MCP tool heuristic scoring | [`mcp/risk.rs::assess_mcp_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| Change skill binding keyword lists | [`mcp/risk.rs::assess_skill_binding_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs) (`critical_keywords` / `warning_keywords`) |
| Change URL classification | [`mcp/risk.rs::classify_url_target`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| Change sensitive-path list | [`mcp/risk.rs::is_sensitive_path`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| Change grant_eligible rule | [`mcp/risk.rs::ToolRiskAssessment::grant_eligible`](../deeting/src-tauri/src/modules/mcp/risk.rs) |
| Change grant key encoding | [`mcp/risk.rs::policy_rule_key`](../deeting/src-tauri/src/modules/mcp/risk.rs) + sync `approval_classes_from_key` + `SessionApprovalGrant::from_key` + tests |
| Add a new sandbox backend | [`sandbox/manager.rs::SandboxRuntimeManager::build_provider`](../deeting/src-tauri/src/modules/sandbox/manager.rs) + new backend_*.rs |
| Change default sandbox bridge URL | [`sandbox/manager.rs::DEFAULT_BRIDGE_DISCOVERY_URLS`](../deeting/src-tauri/src/modules/sandbox/manager.rs) |
| Change capability gate routing | [`capability_control_plane.rs::resolve_official_skill_host_tool_route`](../deeting/src-tauri/src/modules/capability_control_plane.rs) |
| Change approval command handling | [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs) |
| Change approval persistence fields | [`chat_tool_runtime/inflight.rs::PersistedPendingApproval`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs) |

## 11. How to extend

### 11.1 Classify a new core tool (example: `fs_write_file`)

1. Add a match arm in [`assess_core_tool_risk`](../deeting/src-tauri/src/modules/mcp/risk.rs):
   ```rust
   "fs_write_file" => {
       let path = arguments.get("path").and_then(Value::as_str).unwrap_or_default();
       if is_sensitive_path(path) {
           ToolRiskAssessment {
               requires_approval: true,
               risk_level: "HIGH",
               reasons: vec!["writing to a sensitive path".to_string()],
               operation_class: RiskOperationClass::FilesystemWrite,
               target_class: RiskTargetClass::SensitivePath,
               boundary_class: ApprovalBoundaryClass::HardBoundary,
           }
       } else {
           ToolRiskAssessment {
               requires_approval: true,
               risk_level: "MEDIUM",
               reasons: vec!["filesystem write".to_string()],
               operation_class: RiskOperationClass::FilesystemWrite,
               target_class: RiskTargetClass::Host,
               boundary_class: ApprovalBoundaryClass::HardBoundary,
           }
       }
   }
   ```

2. Tests: construct (sensitive_path, normal_path) cases, assert boundary_class, risk_level, operation_class, target_class.

3. **Don't forget**: this is FilesystemWrite, so it's HardBoundary by default — unless you can explain why it should be granted, don't make it grant_eligible.

### 11.2 Add Windows-friendly sensitive paths

1. Modify [`is_sensitive_path`](../deeting/src-tauri/src/modules/mcp/risk.rs):
   ```rust
   fn is_sensitive_path(path: &str) -> bool {
       let normalized = path.to_lowercase();
       let unix_sensitive = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"];
       let windows_sensitive = [
           r"c:\windows",
           r"c:\program files",
           r"c:\users\",
           r"c:\programdata",
       ];
       unix_sensitive.iter().any(|p| path.starts_with(p))
           || windows_sensitive.iter().any(|p| normalized.starts_with(p))
   }
   ```

2. Cross-platform tests:
   - Linux: `/etc/passwd` ✓
   - Windows: `C:\Windows\System32\config\SAM` ✓
   - Windows: `C:\Users\Alice\Documents\note.md` ✗ (user's own docs aren't sensitive)

3. Consider: should `C:\Users\<u>\.ssh` also be included? Usually yes — write a per-platform detection function.

### 11.3 Add a new sandbox backend (example: Docker on macOS)

1. Create `backend_docker.rs` implementing the [`SandboxProvider`](../deeting/src-tauri/src/modules/sandbox/provider.rs) trait.
2. Add a branch in [`manager.rs::build_provider`](../deeting/src-tauri/src/modules/sandbox/manager.rs): detect Docker availability → prefer it.
3. Add a diagnostic function: `diagnose_docker_availability()` (cf. `diagnose_wsl_availability`).
4. Wire into `SandboxReadinessReport` so the UI shows Docker status.
5. **Do not** silently fall back to the Host backend when the sandbox is unavailable — make it explicit.

## 12. Anti-patterns (reject in PR review)

- Deciding `requires_approval` outside the risk assessor (bypassing risk.rs)
- Adding exceptions to `HardBoundary` (unless the user **explicitly** configures it)
- Making `ProcessExec` grant_eligible
- Writing a "if anything was approved this session, skip approval for everything" global escape
- Letting the model decide "do I need approval this time" (self-approving agent = security hole)
- Changing `approval_classes_from_key` without maintaining legacy key compatibility (user's existing grants invalidate en masse)
- Changing fingerprint segment to tool_name in grant key (fingerprint = tool + args hash; tool_name is not unique)
- Modifying `is_sensitive_path` but only testing Unix (Windows paths must be covered)
- Silent fallback to host execution when sandbox is unavailable
- Hardcoding the BoxLite install path (must be configurable + auto-discover)
- Approval card not showing `risk_reasons` (user doesn't know what they're approving)
- Logging full `arguments` (may contain sensitive data)

## 13. Recorded decisions and tradeoffs

| Decision | Why |
|---|---|
| Three-dim enums instead of numeric risk score | Enums are PR-reviewable, testable, explainable; numeric scores make "why 87 is the line" mystical |
| `risk_level` strings are UI-only | Decisions go through `boundary_class`; UI labels are not security gates |
| `Localhost` / `PrivateNetwork` default to HardBoundary | Anti-SSRF; users' LAN devices should not be free to the AI |
| `ProcessExec` is always HardBoundary | Shell / browser automation / scripted host mutation are all irreversible |
| Grants only for SoftBoundary + non-ProcessExec + PublicInternet | "Crawl the same site repeatedly" stops being asked; "internal network" and "execution" never |
| Assessors are pure functions | Same input → same output → replayable, reviewable, testable |
| Three assessors (core / MCP / skill) | Each tool class has fundamentally different trust; one shared algorithm would over- or under-score one class |
| Sandbox unavailable = operation unavailable (no silent fallback) | Silent fallback = sandbox defeated; explicit failure = user can fix |
| Approval lives on the DAG's ApprovalGate node | Cross-process persistent, recoverable; do not build an independent approval cache |
| `approval_classes_from_key` reads tail 3 segments | Legacy key compatibility; changes need migration + compat tests |

## 14. Verification checklist

PRs touching security must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib mcp::risk --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `cargo test --lib sandbox --no-fail-fast`
- [ ] Key invariant tests still green:
  - `assess_skill_binding_risk_escalates_localhost_to_hard_boundary`
  - `assess_mcp_tool_risk_marks_remote_network_tool_as_soft_boundary`
  - `soft_boundary_public_network_reads_are_grant_eligible`
  - `localhost_requests_do_not_produce_session_grants`
  - `session_approval_grant_round_trips_from_key`
  - `approval_classes_from_key_ignores_legacy_prefix_segments`
- [ ] Grant key format changes: migration written + legacy key parsing still produces usable grants
- [ ] Desktop manual test:
  - `shell_execute` always prompts approval, regardless of past approvals
  - `browser_open_tab https://example.com` does not ask again after one approve
  - `browser_open_tab http://127.0.0.1:8080` asks every time
  - With sandbox killed (manually stop BoxLite), related tools cannot be called (UI shows reason)

> Known Windows caveat: `cargo test` may fail to launch due to DLL load failure (STATUS_ENTRYPOINT_NOT_FOUND). Distinguish compile failure from run failure; rerun on CI/Linux for the latter.

## 15. FAQ

**Q: Why not just use OS sandboxes (macOS Seatbelt / Linux seccomp / Windows AppContainer)?**
A: (1) Deeting is cross-platform; depending on any one platform's feature would make the other two less safe. (2) BoxLite's userspace Linux sandbox is uniformly semantic across all three platforms — observable, debuggable, reviewable in PRs. (3) OS-level hardening can be layered later; today's baseline is uniform.

**Q: If HardBoundary can never be granted, won't `shell_execute` cause approval fatigue in workflows that need it often?**
A: Yes — by design. shell_execute is the most dangerous; the user must consciously approve every time. If a user truly needs "repeated continuous shell" (e.g. iterating commands), the right answer is **let the model submit all commands at once** (one approval, many commands). This is exactly why `execute_code_plan` runs on the worker plane — one big task, one decision, not countless small ones.

**Q: Allowing `Unknown` target in `grant_eligible` — isn't that too loose?**
A: Deliberate. `Unknown` usually means the tool didn't declare what it accesses — most are "generic network fetchers" targeting the public internet. To avoid misclassification, tool authors should fill `target_class` clearly. If you design a new tool that is `Unknown` but actually accesses sensitive things, add a branch in the risk assessor to classify it explicitly.

**Q: What does the user do when BoxLite install fails?**
A: The UI shows an "environment check" card in dashboard/settings with a red sandbox state and a "retry install" button. The model's available tool list **dynamically shrinks** — sandbox-dependent tools disappear from capabilities. After the user fixes it, the next launch auto-recovers.

**Q: If a prompt injection makes the model produce a "looks harmless" URL that actually points to localhost/internal, can the security model defend?**
A: Yes — because `classify_url_target` is rule-based and pure. `http://127.0.0.1:80/very_innocent_looking_page` is still classified as `Localhost` → `HardBoundary` → approval card → user sees the actual URL and reasons.

**Q: Can a user configure "all shell commands I've approved before should auto-allow"?**
A: **Not** by modifying boundary — HardBoundary is discipline. But you can take a different route: use `execute_code_plan` instead of direct `shell_execute`, packing multiple commands as one worker delegation — one approval for an entire plan, far better UX than per-command. This is the product-level answer.

**Q: What happens when the risk assessor returns `Unknown` operation or target?**
A: Default risk_level = LOW, boundary = None. This is to avoid disturbing the user. If you see lots of "Unknown / Unknown" assessments in production, that means the risk assessor needs more branches — not that the fallback should be stricter.

**Q: Can code running in the sandbox call back into Deeting's host tools (e.g. memory)?**
A: Not directly. BoxLite is isolated; if "in-sandbox calls to host capability" is truly needed, it must go through an explicit RPC interface (e.g. a sidecar-exposed API), and **that RPC also goes through risk assessment** — do not give in-sandbox processes a fast lane that bypasses approval.

## 16. References

- Risk assessment: [`mcp/risk.rs`](../deeting/src-tauri/src/modules/mcp/risk.rs)
- Tool execution entry: [`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs)
- Approval commands: [`chat_tool_runtime/approval_commands.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/approval_commands.rs)
- Persisted fields: [`chat_tool_runtime/inflight.rs::PersistedPendingApproval`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/inflight.rs)
- Capability gate: [`capability_control_plane.rs`](../deeting/src-tauri/src/modules/capability_control_plane.rs)
- Sandbox manager: [`sandbox/manager.rs`](../deeting/src-tauri/src/modules/sandbox/manager.rs)
- Sibling docs: [`rag-architecture.en.md`](./rag-architecture.en.md), [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md), [`agent-dag-architecture.en.md`](./agent-dag-architecture.en.md), [`memory-architecture.en.md`](./memory-architecture.en.md)
