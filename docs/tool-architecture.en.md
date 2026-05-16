# Deeting Tool Architecture (Tool Surface · Capability Registry · Execution Routing)

> Scope: in the current Deeting system, "what tools the model can see, how those tools are packaged, how they are discovered, how they execute, how they are gated by approval, and how they wire up with skills / MCP / local execution."
> Out of scope: full agent DAG recovery and suspend mechanics (see [agent-dag-architecture.en.md](./agent-dag-architecture.en.md)); RAG / context orchestration (see [rag-architecture.en.md](./rag-architecture.en.md)); long-term memory (see [memory-architecture.en.md](./memory-architecture.en.md)); Direct / Worker dual plane and tool allowlist switching (see [dual-plane-architecture.en.md](./dual-plane-architecture.en.md)).

This document is not about the abstract concept of "tool calling." It is about a more practical question: *what does Deeting actually treat as a tool today, at which layer is each kind packaged, and through which boundary does the model finally invoke them?* If you are reviewing code, understanding the architecture, or about to add a new capability — this should save you more time than grepping for `tool_call`.

## 1. TL;DR

Deeting's current tool surface is **5 layers stacked**:

```text
┌─────────────────────────────────────────────────────────┐
│  L1 · Model-visible tool surface (tool_catalog.rs)      │
│  - Filtered by allowlist, rendered as provider-safe     │
│    tools[] array                                        │
│  - Assembled from core / lane aux / dynamic direct      │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  L2 · Static core tools (~49, Rust built-in)            │
│  - 9 groups per §5: meta / skill lifecycle /            │
│    context retrieval / terminal / sandbox execution /   │
│    delegation / document generation / monitor /         │
│    browser                                              │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  L3 · Dynamic tool surface (open set)                   │
│  - MCP tools / Skill actions / official desktop         │
│    capabilities                                         │
│  - Injected via capability snapshot                     │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  L4 · Capability registry / search_sdk                  │
│  - Not a tools[] array — a capability catalogue +       │
│    ranked candidates                                    │
│  - Contains recipes / orchestration primitives /        │
│    delegation targets / local assistants                │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  L5 · Unified execution layer (tool_execution.rs)       │
│  - Funnels core / skill / MCP / shell / sandbox into    │
│    the same policy + approval + risk + audit boundary   │
└─────────────────────────────────────────────────────────┘
```

**4 tool sources + 2 non-business kinds**:

1. **Core tools** — Rust runtime built-in, ~49 in total; contracts in [`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs).
2. **Dynamic direct capability tools** — capabilities promoted out of the capability registry into top-level function tools (MCP / Skill action / official desktop capability).
3. **Skill tools** — installable capability packages assembled from `SKILL.md + deeting.json + llm-tool.yaml + main.py`; one skill package can export multiple callable tools.
4. **MCP / remote tools** — external capabilities reached over stdio / SSE / remote MCP server.

Two kinds that are not business capabilities but matter to the runtime:

- **Orchestration primitives**: `search_sdk` / `get_tool_schema` / `attach_capability` / `detach_capability` / `diting_think` / `query_task_policy` — capability control plane, not knowledge-typed capabilities.
- **Execution backends**: `shell_execute` / `execute_code_plan` / `run_local_code_snippet` — high-side-effect execution hosts.

## 2. Why so many layers?

For a simple chat assistant, tools would just be a fixed set of JSON schemas. Deeting has to satisfy more constraints at the same time:

- **Provider-safe**: OpenAI-compatible providers are strict about tool names (`^[a-zA-Z0-9_-]+$`, with length limits); `monitor.create` must be aliased or the provider rejects it.
- **Dynamic visibility**: skills and MCP servers that the user has installed or enabled must enter the surface dynamically — not hard-coded.
- **Discoverable vs directly callable**: not every registry entry should be a function tool. Heavy capabilities go through `search_sdk` first, then `attach_capability` or `delegate_task`.
- **Unified approval boundary**: browser writes / stdio MCP / local skill host / shell — all eventually pass through the same Approval Gate.
- **Explainable source**: UI cards must tell users "this tool came from core / skill / MCP / assistant."
- **Plane isolation**: Direct plane (one-shot) only sees the resident allowlist; Worker plane sees the full surface — and the tool set is aligned with the prior / bandit learning target.

So today's tool system answers **three independent questions**:

1. What can the model call this round → L1 + L2
2. What capabilities does the system know about overall → L3 + L4
3. At execution time, which route and approval flow → L5

## 3. Layer 1: model-visible tool surface (`tool_catalog`)

Entry: [`deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs).

### 3.1 Three-part assembly

```rust
build_local_runtime_tools_with_allowlist(allowed_tool_names, capability_snapshot)
  │
  ├─ build_core_tool_function_entries()
  │   └─ Source: code_mode/core_tool_contracts.rs::build_core_tool_function_entries
  │      Returns ~45 static contract entries
  │
  ├─ build_local_execution_lane_aux_tools()
  │   └─ attach_capability / detach_capability and other request-scope control tools
  │
  └─ build_dynamic_direct_capability_tools(capability_snapshot)
      └─ Filter snapshot returned by search_sdk for entries with
         invocation_mode == "direct" && status.callable == true
         → promote to top-level function tools
```

Afterwards, `policy.effective_allowed_tool_names(snapshot)` filters down to whitelist hits.

### 3.2 Allowlist double-track (paired with dual plane)

[`crates/mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) defines two constant sets:

| Set | Used in | Contains |
|---|---|---|
| `resident_capability_control_tool_names()` | **Direct plane** (`ResponseOnly`) | `search_sdk`, `activate_skill`, `read_skill_resource`, `terminal_context_peek/read/pack`, `context_search/open/expand/summarize_evidence` |
| `full_execution_tool_names()` | **Worker plane** (`WorkerReasoning`) | resident set + `diting_think` (round 1 only) / `delegate_task` / `execute_code_plan` / `run_local_code_snippet` / `attach_capability` / `detach_capability` / `query_task_policy` / `sys_submit_onboarding_request` / `refresh_skill_index` / `monitor.*` / all `browser_*` / all document-generation tools |

**Key invariant**: in Direct mode, "subtask-spawning" tools like `delegate_task` **are not in the tools[] array at all** — enforced physically by policy, not by prompt. See [dual-plane-architecture.en.md §6.1](./dual-plane-architecture.en.md#61-tool-surface-the-critical-difference).

### 3.3 Alias mechanism (provider-safe naming)

Source: `tool_catalog.rs::dynamic_capability_alias` + `provider_safe_tool_name_for_callable` + `alias_tool_definition_for_provider` + `resolve_provider_tool_name_for_execution`.

```text
Canonical name          contains dot / slash / unsafe character
   │
   ▼
dynamic_capability_alias(name) = "cap_" + sanitized + "_" + hex_hash(name)[:8]
   │
   ▼
Provider-visible name   e.g. monitor.create → cap_monitorcreate_a1b2c3d4

Model emits tool_call("cap_monitorcreate_a1b2c3d4")
   │
   ▼
resolve_provider_tool_name_for_execution(emit_name) → reverse-lookup to canonical "monitor.create"
   │
   ▼
Dispatched in the dispatcher match by canonical name
```

**Why not just change the canonical**: the canonical name is the stable identifier across processes, across the Python implementation, across persistence; aliasing happens only at the provider boundary and does not pollute anywhere else.

## 4. Layer 2: complete static core tool catalogue (~49 tools)

Contracts in [`code_mode/core_tool_contracts.rs::build_core_tool_function_entries`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs). Dispatch in the big match in [`chat_tool_runtime/mod.rs::process_chat_tool_calls`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs).

### 4.1 Meta · capability discovery and control (6)

| Tool | File | What it does | allowlist |
|---|---|---|---|
| `search_sdk` | `core_tool_contracts.rs` | Semantic search across the local capability surface (direct caps / skills / recipes / orchestration primitives); injects the returned capability snapshot into the next round | resident + full |
| `get_tool_schema` | `core_tool_contracts.rs` | Fetch a specific tool's full schema / examples / risk level | full |
| `query_task_policy` | `core_tool_contracts.rs` | Read-only query of task_learning priors at a given decision point (route / discovery / capability_attach / execution / verification) | full |
| `attach_capability` | `tool_catalog.rs::build_local_execution_lane_aux_tools` | Request-scope attach of an expert capability to the current agent loop | full |
| `detach_capability` | Same | Detach the active expert capability and return to neutral context | full |
| `diting_think` | `core_tool_contracts.rs` + `chat_tool_runtime/mod.rs::inject_diting_think_tool` | Structured deep-reasoning gate; **visible only in round 1**, permanently removed from tools[] after consumption (see §10) | full (round 1 only) |

### 4.2 Skill lifecycle (4)

| Tool | What it does |
|---|---|
| `activate_skill` | Activate an installed skill package; load full `SKILL.md` + resource index into `state.active_skill_context` |
| `read_skill_resource` | Read a text resource inside an activated skill (references / templates / scripts) |
| `refresh_skill_index` | Rescan local skill directories, rebuild registry (after external skill install, let runtime see it) |
| `sys_submit_onboarding_request` | Model can create local assets: `asset_type='skill' / 'assistant' / 'custom_task_agent'`; **HIGH risk, Approval Gate** |

### 4.3 Local context retrieval (4 · Context Orchestrator)

Defined in [`desktop_runtime/context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs); schemas exported by `core_tool_contracts.rs::context_*_contract`.

**Memory / LLM Wiki / Knowledge are reachable only through these 4 tools** — there is no standalone `memory_*` / `wiki_*` / `knowledge_*` tool.

| Tool | What it does |
|---|---|
| `context_search` | Cross-source retrieval (auto / memory / llm_wiki / knowledge); returns evidence envelopes |
| `context_open` | Open one entry by id (knowledge id is `file_id:chunk_index`) |
| `context_expand` | Neighborhood expansion for knowledge chunks |
| `context_summarize_evidence` | Deterministic compression preserving source_refs |

See [rag-architecture.en.md](./rag-architecture.en.md).

### 4.4 Terminal context (4)

Defined in [`chat_tool_runtime/terminal_context.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/terminal_context.rs). **Read-only + bounded input** — cannot execute commands directly.

| Tool | What it does |
|---|---|
| `terminal_context_peek` | Lightweight index of terminal sessions / commands / cwd / selection |
| `terminal_context_read` | Read command output / selection / target with a byte budget |
| `terminal_context_pack` | Goal-driven packed bundle (most-relevant command output) |
| `terminal_write_input` | Write into the embedded terminal stdin — **physically rejects newlines** (cannot actually execute commands) |

### 4.5 Sandbox & code execution (3 · execution backends)

| Tool | File | What it does | Approval |
|---|---|---|---|
| `execute_code_plan` | `core_tool_contracts.rs` + `chat_tool_runtime/mod.rs::execute_code_plan` | Run bounded Python codemode in the sandbox; runtime exposes `deeting.log/section/call_tool` + SDK stubs; passes the `DecisionLocus::Execution` policy gate | full + risk assessment |
| `run_local_code_snippet` | `core_tool_contracts.rs` + `app_state.sandbox.manager.run_local_code_snippet_with_prepare_config` | Run a single snippet in the BoxLite sandbox (python / go / rust / java) | full + risk assessment |
| `shell_execute` | [`execution/core_tool.rs::ShellExecuteCoreTool`](../deeting/src-tauri/src/modules/execution/core_tool.rs) | Execute commands in the background host runtime (process / shell / script modes); auto-decodes terminal encodings | **HIGH risk / hard Approval** |

### 4.6 Delegation (1)

| Tool | File | What it does |
|---|---|---|
| `delegate_task` | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` | Delegate one subtask to a Custom Task Agent; the child runs its own agentic loop; the result returns as a canonical `delegated_result` envelope |

See [dual-plane-architecture.en.md §7](./dual-plane-architecture.en.md#7-worker-plane-in-detail).

### 4.7 Document generation (4)

Defined in [`generated_files/`](../deeting/src-tauri/src/modules/generated_files/).

| Tool | What it does |
|---|---|
| `write_docx` | Generate / rewrite a DOCX with section / paragraph / bullet / table |
| `write_pptx` | Generate / rewrite a PPTX with cover / two-column / etc. layouts |
| `inspect_generated_artifact` | Read artifact metadata + editable outline |
| `patch_generated_artifact` | Structured patches (`replace_section` / `append_slide` / `replace_slide_title` …) |

### 4.8 Monitor tasks (2)

| Tool | What it does |
|---|---|
| `monitor.create` | Create a cron-driven monitor task (**HIGH risk**; contains `.`, must be aliased to `cap_*`) |
| `monitor.list` | List existing monitor tasks; supports pagination / status filter |

### 4.9 Browser execution surface (29 `browser_*`)

Routed through the local Chrome extension ([`packages/deeting_chrome/`](../packages/deeting_chrome/)) via a localhost WebSocket bridge; specific action handlers in [`content/execute.ts`](../packages/deeting_chrome/src/content/execute.ts) and `background/router.ts`.

**Bridge & discovery (5)**: `browser_agent_status`, `browser_open_tab`, `browser_get_page_snapshot`, `browser_get_active_page`, `browser_tabs`

**Navigation / wait / scroll / screenshot / find (11)**: `browser_navigate_tab`, `browser_wait`, `browser_wait_for_element`, `browser_wait_for_navigation`, `browser_scroll`, `browser_scroll_into_view`, `browser_region_screenshot`, `browser_full_page_screenshot`, `browser_find_element`, `browser_extract`, `browser_highlight`

**Interaction (8)**: `browser_click`, `browser_type`, `browser_fill`★, `browser_key`★, `browser_select`★, `browser_upload_file`★, `browser_dialog`★, `browser_retry_with_relocate`

**Inspection / DevTools (7)**: `browser_console_log`, `browser_network_log`, `browser_storage_read`, `browser_storage_write`★★, `browser_eval`★★, `browser_downloads`, `browser_accessibility_audit`

> ★ = triggers hard Approval; ★★ = arbitrary JS or persisted write — always requires approval.

## 5. Layer 3: dynamic tool surface (open set)

Not fixed at compile time. Each `search_sdk` call returns a `capability_snapshot` that the runtime caches in `state.last_capability_snapshot`; the next round injects it via `build_dynamic_direct_capability_tools`.

### 5.1 MCP server tools

Every callable tool from any MCP server the user has connected (stdio / SSE / remote) is filtered by `invocation_mode == "direct" && status.callable == true` and promoted to a top-level function tool. Naming / resources / persistence are managed in [`mcp/store/tool_registry.rs`](../deeting/src-tauri/src/modules/mcp/store/tool_registry.rs); call resolution in [`mcp/commands/runtime/tool_resolution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_resolution.rs).

Names with unsafe characters (`. / :` …) always go through `dynamic_capability_alias()` → `cap_*`.

### 5.2 Skill actions

Callable actions inside installed skill packages, exposed under the action's `callable_name`. Binding resolution via `resolve_skill_binding_by_ref(...)`.

### 5.3 Official desktop capabilities (allowlist)

[`desktop_runtime/desktop_capabilities.rs::OFFICIAL_SKILL_CAPABILITIES`](../deeting/src-tauri/src/modules/desktop_runtime/desktop_capabilities.rs) — desktop capabilities **visible to the model only when an official skill is active** (12 entries):

```
skill_registry.refresh    skill_registry.diagnostics
monitor.create            monitor.list
provider_preset.list      provider_preset.upsert
provider.verify           provider.template.verify
web.fetch                 assistant.onboarding.submit
cloud.provider_preset.list   ← admin-only
cloud.provider_preset.upsert ← admin-only
```

`cloud.*` entries are gated by a second `ensure_desktop_admin_role` check.

### 5.4 Custom Task Agent built-ins

Visible only inside children spawned via `delegate_task` (not in the main assistant's tool surface):

- `llm_wiki_search_corpus` ([`custom_task_agents/runtime.rs`](../deeting/src-tauri/src/modules/custom_task_agents/runtime.rs)) — LLM Wiki maintainer agents only
- `diting_think` — child's round-0 reasoning gate
- The child profile's bound `callable_mcp_tool_ids` + `callable_skill_action_refs`

Binding construction: [`custom_task_agents/bound_callables.rs::BoundCallablePayload::build`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs).

## 6. Layer 4: capability registry · `search_sdk` control plane

If `tool_catalog.rs` decides "what the model can see this round," then the capability catalogue lives in [`capability_discovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs).

### 6.1 It does not return tools[]

`search_sdk` returns a `CapabilitySearchResult` — a **capability control-plane snapshot**:

```text
CapabilitySearchResult {
    callable_capabilities: [...]      // MCP / skill action, with status, risk, last_used
    recipes: [...]                    // multi-step composition recipes
    orchestration_primitives: [...]   // attach / detach / search / delegate etc.
    delegation_targets: [...]         // custom task agent profiles
    local_assistants: [...]           // installed assistant packages
    score_explanations: { ... }       // per-candidate relevance + feedback score
}
```

Key functions:
- `build_capability_search_result(...)`
- `build_local_sdk_search_result_bundle_with_feedback_runtime(...)`

### 6.2 Ranking, not a flat list

`capability_discovery.rs` fuses multiple retrieval paths internally:

- **Lexical**: keyword matching
- **Structured**: tag / capability-class / risk-tag filters
- **Semantic**: query embedding × capability embedding
- **Reciprocal Rank Fusion (RRF)**: fuse the three rankings
- **Feedback affinity**: weighted by past user accept / reject rates
- **Query profile inference**: infer intent from query shape

So the same capability ranks differently depending on the query — this is "capability recommendation", not "capability list".

### 6.3 Why not expose every capability directly

If every capability were a function tool:

- The provider `tools[]` array would explode (many models cap at 128 tools)
- The model's choice quality drops when the surface is too wide (empirical fact)
- High-side-effect tools get invoked impulsively

So **heavy / long-tail capabilities first live in the registry, and only become visible after the model actively calls `search_sdk`** — engineering discipline. The threshold for direct exposure is `invocation_mode == "direct"`.

## 7. Layer 5: skill package format (docs-first + callable contract)

### 7.1 File structure of a standard skill package

Reference [`packages/README.md`](../packages/README.md) and [`packages/official-skills/crawler/`](../packages/official-skills/crawler/):

```text
my-skill/
├── SKILL.md             # human/model-readable capability docs (NOT a callable schema)
├── deeting.json         # runtime and packaging meta: id, version, entry, deps, ui
├── llm-tool.yaml        # host-registered tool contract (callable schema) — the real tool definition
├── main.py              # actual execution body (Python host)
├── ui/                  # optional: custom frontend panel
└── references/          # optional: supporting materials, prompt templates, scripts
```

**Each of the 4 files has a distinct role**:

| File | Does | Does NOT do |
|---|---|---|
| `SKILL.md` | Docs / context injection / handed to model on activate_skill | Is not a callable schema |
| `deeting.json` | Package meta, runtime config | Does not define tools |
| `llm-tool.yaml` | Callable tool schema (host-registered contract) | Is not the execution body |
| `main.py` | Real execution body | Does not expose schema |

### 7.2 One skill can export multiple tools

`llm-tool.yaml` is a list. For example, [`packages/official-skills/crawler/llm-tool.yaml`](../packages/official-skills/crawler/llm-tool.yaml) exports both `fetch_web_content` and `crawl_website`. **Skill package ≠ tool name**.

### 7.3 What the skill registry does

[`skills/registry_impl.rs`](../deeting/src-tauri/src/modules/skills/registry_impl.rs) turns disk bundles into runtime capabilities:

- Normalizes skill id (case / naming conflicts)
- Identifies locally installed skills
- Parses manifests and runtime config
- Handles version migration / conflict
- Writes install state into the local store + capability registry

## 8. Layer 6: unified execution layer (`tool_execution.rs`)

[`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs) pulls every executable tool source **onto the same dispatch + policy + approval pipeline**.

### 8.1 Unified dispatch table

Whether the source is stdio MCP / SSE MCP / local skill / shell:

| Source | Dispatch function |
|---|---|
| stdio MCP server | `call_local_stdio_tool(...)` |
| Remote SSE MCP server | `call_remote_sse_tool(...)` |
| Local skill runtime | `execute_local_mcp_tool(...)` / `execute_skill_binding(...)` |
| `shell_execute` | `ShellExecuteCoreTool::execute(...)` |
| Generic wrapper entry | `execute_or_queue_mcp_tool_call_with_tool_ref(...)` |

### 8.2 Binding resolution

- `resolve_skill_binding_by_ref(...)`: reverse-lookup from a tool ref to a skill / MCP instance
- `resolve_local_tool_env(...)`: resolves the env vars, binary path, and host the tool needs to run

### 8.3 Policy + Approval + Risk (unified boundary)

Regardless of source, every call passes through:

| Function | What it does |
|---|---|
| `assess_policy_risk(...)` | Assigns `risk_level` + `risk_reasons` to one call |
| `resolve_approval_decision(...)` | Outputs `ApprovalDecision::{Allow, Deny, RequireApproval}` |
| `ApprovalPolicyLevel` | Combines rule-set + per-binding override + per-session grant |
| `persist_pending_approval(...)` | When `RequireApproval` — write to SQLite, suspend chat_tool_runtime |
| `SessionApprovalGrant` | "Allow for this session only" — short-term approval bypass |

`tool_result.status == "REQUIRES_APPROVAL"` is the unified signal — chat_tool_runtime suspends the main loop on receipt. See [agent-dag-architecture.en.md](./agent-dag-architecture.en.md) and [security-architecture.en.md](./security-architecture.en.md).

### 8.4 Risk tiers (excerpt)

| Risk | Examples |
|---|---|
| **LOW** (default Allow) | `terminal_context_*`, `context_*`, `search_sdk`, `browser_*` read-only |
| **MEDIUM** (rule-decided) | Most MCP read tools, `browser_extract`, `browser_click`, `write_docx` |
| **HIGH** (default RequireApproval) | `shell_execute`, `browser_storage_write`, `browser_eval` (write), `browser_dialog`, `delegate_task`, `monitor.create`, `sys_submit_onboarding_request`, all mutating MCP tools |

## 9. Layer 7: frontend capability view

The frontend **does not bind** to a raw `tools[]` JSON. It binds to capability / server / source / binding / settings entities:

```text
deeting/components/mcp/*             ← MCP management panels
deeting/lib/api/mcp*.ts              ← MCP API client
deeting/lib/api/skills.ts            ← skill install / list / update
deeting/lib/ai/capability-settings.ts ← per-capability config (toggle / risk override / default args)
deeting/store/capability-settings-store.ts ← client state
```

The "tool name / source label / risk level / last-used time" you see on UI cards are projected from these entities, not derived from a live `tools[]`.

## 10. The `diting_think` round-1 reasoning gate

The **only "dynamically disappearing" tool** deserves a dedicated section:

- **Injection point**: [`chat_tool_runtime/mod.rs::inject_diting_think_tool`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs)
  - Appended to `tools[]` only when `round == 1 && !state.diting_think_consumed`
- **Consumption point**: dispatcher hits `tool_name == DITING_THINK_TOOL_NAME`:
  - Renders structured `[Intent] / [Context] / [Plan] / [Constraints]` via `format_diting_think_reasoning(arguments)`
  - Stored in `state.captured_reasoning`
  - Sets `state.diting_think_consumed = true`
- **Why**: when the tool surface is wide (Worker plane), force the model to do a structured "thought sweep" first — preventing blind `delegate_task` / `execute_code_plan` calls on round 1.

## 11. One real end-to-end call chain

```text
① user request
    ↓
② 8-step orchestration pipeline runs (incl. RouteSelectionStep)
    → execution_policy decides Direct / Worker plane
    → decides allowlist (resident vs full)
    ↓
③ tool_catalog.build_local_runtime_tools_with_allowlist
    = core[allowed]  +  lane_aux[allowed]  +  dynamic[allowed]
    → dynamic_capability_alias handles unsafe-char names
    → renders provider-safe tools[] array
    ↓
④ agentic loop round 1
    diting_think appended (round 1 only)
    ↓
⑤ provider returns tool_calls
    ↓
⑥ resolve_provider_tool_name_for_execution
    reverse-lookup cap_* alias to canonical
    ↓
⑦ dispatcher big match:
    - core tool? → built-in function
    - context_*?  → context_orchestrator/tools.rs
    - terminal_context_*? → chat_tool_runtime/terminal_context.rs
    - delegate_task? → execute_delegate_task_tool
    - shell_execute / sandbox? → ShellExecuteCoreTool / sandbox manager
    - else → execute_or_queue_mcp_tool_call_with_tool_ref
    ↓
⑧ tool_execution.rs:
    - assess_policy_risk → tag risk
    - resolve_approval_decision → Allow / Deny / RequireApproval
    - if RequireApproval → persist_pending_approval + suspend loop
    - if Allow → route to specific backend: stdio MCP / SSE MCP / skill host / shell / sandbox / browser bridge
    ↓
⑨ result returns:
    - tool_result envelope (with status / source_refs / risk meta)
    - written to execution_graph runtime context
    - enters next-round chat completion messages
    ↓
⑩ evaluator + bandit feedback (see self-evolution / bandit docs)
```

**Three common confusions**:

1. `search_sdk` is a tool, but its return value **does not mean immediate execution** — it only injects a capability snapshot into state; the next round decides attach / delegate / direct call.
2. Skill package and tool name are **not 1:1** — one skill can export multiple callable tools.
3. The provider-safe name the model sees (`cap_*`) is **not** the canonical name used at execution (`monitor.create`) — never use the alias in persistence layers.

## 12. When adding a new tool, which layer does it belong to?

| What you want to add | Where it should live | Key constraint |
|---|---|---|
| System built-in, stable, requires strong host control | **Core tool** (`core_tool_contracts.rs` + dispatcher match) | Also add schema, risk level; decide via dual-plane allowlist whether it is resident or full |
| Installable / publishable / reusable feature pack | **Skill package** (`SKILL.md + deeting.json + llm-tool.yaml + main.py`) | One package can export many tools; `llm-tool.yaml` is the contract source |
| External system or independent service host | **MCP tool** (stdio / SSE / remote) | Via an MCP server; dynamically injected into tools[] |
| Heavy / long-tail capability that should be discovered before being called | **Capability registry** | Does not enter tools[]; exposed via `search_sdk` |
| Request-scope / one-shot meta capability | **Lane aux tool** (`build_local_execution_lane_aux_tools`) | Not persisted; only attached to current loop |
| Desktop-host platform capability | **Official desktop capability** (`OFFICIAL_SKILL_CAPABILITIES` allowlist) | Only visible to official skills; admin-only entries have a second check |

**Decision tree**:

```text
New capability?
├── High-side-effect + platform core → Core tool
├── Users can install / uninstall / upgrade → Skill package
├── External service / cross-process → MCP tool
├── Heavy / long-tail / should not be instantly visible → Capability registry only
└── Effective only for the current conversation → Lane aux tool
```

## 13. Anti-patterns (reject in PR review)

| Anti-pattern | Why it is rejected |
|---|---|
| Adding `delegate_task` / `execute_code_plan` to the Direct allowlist | Breaks dual-plane tool isolation; prior learning target collapses (see [dual-plane-architecture.en.md §12](./dual-plane-architecture.en.md#12-anti-patterns-reject-in-pr-review)) |
| Letting `diting_think` remain visible past round 1 | It is a round-1 reasoning gate; repeated appearance traps the model in a meta-reasoning loop |
| Persisting under the `cap_*` aliased name from `dynamic_capability_alias` | Aliasing is a provider-boundary temporary mapping; the hash changes when sanitization rules change |
| Binding a capability directly into `tools[]` instead of going through the registry | Tool surface explodes; you lose the `search_sdk` ranking signal |
| Letting `tool_result` skip `assess_policy_risk` and return directly | Breaks the unified approval boundary; UI cannot render the risk tag |
| Skill `main.py` calling host-internal APIs in reverse (bypassing `llm-tool.yaml`) | Loses contract enforcement; approval / risk / routing lose correct metadata |
| Registering an MCP server tool whose name contains `.` / `/` without aliasing | Provider will reject; aliasing only at call time is also OK, but you cannot skip aliasing |
| Temporarily union-extending `allowed_tool_names` in Direct plane | The policy is what the prior learns against; temporary extension pollutes the next learning round |
| Changing `shell_execute` to default Allow risk | Any shell must go through Approval Gate — security charter red line |

## 14. Verification checklist

PRs touching the tool system must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib tool_catalog --no-fail-fast`
- [ ] `cargo test --lib core_tool_contracts --no-fail-fast`
- [ ] `cargo test --lib tool_execution --no-fail-fast`
- [ ] `cargo test --lib capability_discovery --no-fail-fast`
- [ ] `cargo test --lib mcp_runtime::policy --no-fail-fast`
- [ ] Key invariants still green:
  - Direct plane allowlist does **not** include `delegate_task` / `execute_code_plan` / `attach_capability` / `monitor.*`
  - `diting_think` does not appear past round 1
  - Every canonical name containing `./:` is rendered through alias as `cap_*`
  - `shell_execute` / `browser_eval` (write) / `browser_storage_write` default to `RequireApproval`
- [ ] Manual desktop tests:
  - Install a new skill → `refresh_skill_index` → model `search_sdk` should see it
  - In Direct mode, model tries to call `delegate_task` → provider should reject directly (not in tools[])
  - High-risk tool → UI shows approval card → user rejects → tool_result.status = `denied`
  - Aliased tool called → `resolve_provider_tool_name_for_execution` reverse-lookup correct

## 15. Most useful files to read

| Topic | File |
|---|---|
| Model-visible tool assembly | [`chat_tool_runtime/tool_catalog.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/tool_catalog.rs) |
| Static tool contracts (~49) | [`code_mode/core_tool_contracts.rs`](../deeting/src-tauri/src/modules/code_mode/core_tool_contracts.rs) |
| Allowlist double-track definitions | [`crates/mcp-runtime/src/policy.rs`](../deeting/src-tauri/crates/mcp-runtime/src/policy.rs) |
| Dispatcher big match | [`chat_tool_runtime/mod.rs::process_chat_tool_calls`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/mod.rs) |
| Context tools | [`context_orchestrator/tools.rs`](../deeting/src-tauri/src/modules/desktop_runtime/context_orchestrator/tools.rs) |
| Terminal tools | [`chat_tool_runtime/terminal_context.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/chat_tool_runtime/terminal_context.rs) |
| Shell execution backend | [`execution/core_tool.rs`](../deeting/src-tauri/src/modules/execution/core_tool.rs) |
| Delegation execution | `chat_tool_runtime/mod.rs::execute_delegate_task_tool` + [`custom_task_agents/bound_callables.rs`](../deeting/src-tauri/src/modules/custom_task_agents/bound_callables.rs) |
| Capability registry | [`capability_discovery.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/capability_discovery.rs) |
| Skill registry | [`skills/registry_impl.rs`](../deeting/src-tauri/src/modules/skills/registry_impl.rs) |
| Skill package format | [`packages/README.md`](../packages/README.md) + [`packages/official-skills/crawler/llm-tool.yaml`](../packages/official-skills/crawler/llm-tool.yaml) |
| Desktop platform capability allowlist | [`desktop_runtime/desktop_capabilities.rs`](../deeting/src-tauri/src/modules/desktop_runtime/desktop_capabilities.rs) |
| Unified execution + Policy + Approval | [`mcp/commands/runtime/tool_execution.rs`](../deeting/src-tauri/src/modules/mcp/commands/runtime/tool_execution.rs) |
| MCP server registration | [`mcp/store/tool_registry.rs`](../deeting/src-tauri/src/modules/mcp/store/tool_registry.rs) |
| Browser execution surface | [`packages/deeting_chrome/src/content/execute.ts`](../packages/deeting_chrome/src/content/execute.ts) |
| Sibling docs | [`dual-plane-architecture.en.md`](./dual-plane-architecture.en.md), [`agent-dag-architecture.en.md`](./agent-dag-architecture.en.md), [`rag-architecture.en.md`](./rag-architecture.en.md), [`memory-architecture.en.md`](./memory-architecture.en.md), [`bandit-architecture.en.md`](./bandit-architecture.en.md), [`security-architecture.en.md`](./security-architecture.en.md), [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md) |

## 16. One-sentence conclusion

Deeting's "tool system" is not a static tool list but a layered structure: **`tool_catalog` decides what the model can call this round (filtered by plane allowlist), `core_tool_contracts` supplies the ~49 static contracts, `capability_discovery` lets heavy / long-tail capabilities be discovered before being called, the dynamic layer makes MCP and Skill plug-and-play, and `tool_execution` funnels every source into the same policy + approval + risk boundary**. Skill / MCP / shell / browser are just different sources and execution hosts — they share the same approval flow, the same tool trace, and the same persistence.
