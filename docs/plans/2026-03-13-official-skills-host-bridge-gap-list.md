# Official Skills Host Bridge Gap List

Date: 2026-03-13

> Status note (2026-03-14): this document captures the pre-cutover host-bridge audit.
> The desktop runtime has now started moving toward a desktop-only capability
> contract, so legacy host tool names in this doc should be treated as audit
> inputs, not as the new desktop contract shape.

## Purpose

This document audits `packages/official-skills/*` against the current **desktop-local**
runtime architecture and answers one narrow question:

> When an official skill executes in the desktop-local runtime and calls
> `deeting.call_tool(...)`, does the host actually resolve and execute that tool?

The goal is to separate:
- skills that are materially usable today,
- skills that only work in cloud/backend paths,
- skills that need additional desktop host bridge work.

This is not a migration plan. It is a current-state bridge audit.

---

## Current desktop-local behavior

As of the 2026-03-13 skill-runtime work:

1. Desktop-local Python `deeting_tool` bindings now inject `PYTHONPATH` so
   `from deeting import deeting` works in official skills.
2. Desktop-local Python `deeting_tool` bindings now support marker-mode host
   re-execution.
3. Desktop-local host bridge currently resolves **one explicit internal host tool**
   from skill marker mode:
   - `register_local_skills`

Anything else emitted through `deeting.call_tool(...)` from a desktop-local
official skill is **not guaranteed** to resolve today unless it is already
available through some other direct capability path outside this bridge.

In practice, for official skill wrappers that call host tools by name, the
current bridge support is still extremely partial.

---

## Audit Matrix

| Official skill | Calls `deeting.call_tool(...)` | Desktop-local status | Notes |
|---|---|---|---|
| `code_interpreter` | `execute_code_plan` | Partial / uncertain | Core tool exists, but desktop-local official-skill marker bridge does not explicitly route this name today. Needs explicit verification or bridge entry. |
| `database` | `list_provider_presets`, `create_provider_preset` | Broken in desktop-local | Tauri has `list_local_provider_presets` and `replace_local_provider_presets`, but not these exact host tool names. This is alias drift. |
| `expert_network` | `search_sdk` | Likely works only via core path, not official-skill bridge | `search_sdk` is a core tool in desktop-local. But current official-skill marker bridge does not explicitly map it. Needs explicit verification / bridge support. |
| `ingestor` | `fetch_web_content`, `sys_refine_asset_metadata`, `sys_submit_onboarding_request` | Mostly broken in desktop-local | `fetch_web_content` exists as a skill binding from crawler, but the internal marker bridge currently does not resolve arbitrary skill/capability names. `sys_refine_asset_metadata` is backend-side. `sys_submit_onboarding_request` exists in desktop local code mode core, but not explicitly bridged here. |
| `memory` | `add_knowledge_chunk`, `list_user_memories` | Alias drift / partial | Desktop-local has `append_local_memory`, `list_local_memories`, `search_local_memories`, `search_knowledge_semantic`. Wrapper names do not match. |
| `monitor` | `create_monitor`, `list_monitors` | Alias drift / broken in desktop-local | Desktop-local exposes `create_local_monitor_task`, `list_local_monitor_tasks`. Wrapper names do not match. |
| `provider_probe` | `probe_provider` | Broken in desktop-local | Desktop-local exposes `verify_local_provider`; backend has `probe_provider`. Wrapper name is cloud-oriented. |
| `provider_registry` | `get_unified_schema`, `verify_provider_template` | Cloud/backend-only today | These exist in backend builtin plugin land, not as current desktop-local Tauri host tools. |
| `scheduler` | `submit_background_job`, `check_job_status` | Broken in desktop-local | No matching desktop-local host tools found. |
| `skill_manager` | `register_local_skills` | Works in desktop-local after fix | This was explicitly bridged in the current runtime work. |

---

## What is actually fixed now

### `skill_manager`

`skill_manager` was the first official skill that crossed from "suspicious" to
"materially usable" in desktop local:

- it can import `deeting` from the SDK in desktop-local subprocess execution,
- its `refresh_skill_index()` can call `deeting.call_tool("register_local_skills")`,
- the desktop host bridge now maps that request back to
  `register_local_skills_inner(...)`.

This means:
- it can install/link skills into the user skill directory,
- and it can trigger the desktop-local rescan/index path afterwards.

That is a real end-to-end closure for this particular official skill.

### Everything else

The rest of the official wrapper skills still fall into one of two problem
classes:

1. **Alias drift**
   - the wrapper calls a host tool name that exists only in backend/cloud naming,
   - while desktop-local uses a different `*_local_*` or renamed command.

2. **Missing bridge entry**
   - the host capability may exist somewhere in desktop-local,
   - but the official-skill marker bridge does not currently resolve it.

---

## Root causes

### 1. Wrapper names are not normalized across lanes

Examples:
- `create_monitor` vs `create_local_monitor_task`
- `list_monitors` vs `list_local_monitor_tasks`
- `list_user_memories` vs `list_local_memories`
- `probe_provider` vs `verify_local_provider`

These wrappers read like product-level verbs, but desktop-local currently
exposes lane-specific command names.

### 2. Desktop-local marker bridge is still too narrow

Current desktop-local skill marker bridge is not a full generic host resolver.
It only explicitly handles the internal `register_local_skills` bridge path
that was added for `skill_manager`.

### 3. Some official skills are architecturally backend-first

Some wrappers are clearly designed around backend builtin plugin capabilities:
- `provider_registry`
- parts of `ingestor`
- `scheduler`

These are not just alias issues. Some of them simply do not have a truthful
desktop-local equivalent yet.

---

## Recommended priority

### P0

Bridge or rename the official skills that are supposed to work locally and are
closest to current desktop-local capability truth:

1. `expert_network` -> `search_sdk`
2. `database` -> provider preset local commands
3. `memory` -> local memory commands
4. `monitor` -> local monitor commands

These are the highest-value wins because they mostly look like naming /
resolution problems rather than missing product surfaces.

### P1

Decide whether these should truly exist in desktop-local at all:

1. `provider_probe`
2. `scheduler`
3. `provider_registry`

If the answer is "yes", build a truthful desktop-local host lane for them. If
the answer is "no", stop presenting them as desktop-local official skills.

### P2

Refactor official wrappers away from hardcoded host tool names and onto a small
desktop-local host alias registry so we stop repeating this problem per skill.

---

## Practical recommendation

Do **not** keep fixing official skills one by one by editing wrapper Python
files only.

The durable fix is:

1. define a desktop-local official-skill host alias map,
2. resolve wrapper tool names through that map,
3. reject skills whose target host tools do not exist in the current lane.

That keeps the skill package stable while letting the host remain the source of
truth for what actually runs locally.

---

## Bottom line

`skill_manager` is now materially usable in the current desktop-local
architecture.

Most other official wrapper skills are **not** yet fully usable in the same
way. They need either:
- desktop-local alias mapping,
- generic marker bridge expansion,
- or an explicit product decision that they remain cloud/backend-only.
