# Assistant Activation Contract Design
Updated: 2026-03-07

## Goal
- Replace implicit persona side effects with an explicit activation contract shared by cloud and desktop code mode.
- Keep `consult_expert_network` as candidate search only.
- Introduce explicit `activate_assistant` / `deactivate_assistant` transitions that are observable in tool traces and UI blocks.

## Architecture
- Shared contract lives in `packages/code-mode-contract/`.
- Cloud and desktop both expose the same direct entry tools:
  - `search_sdk`
  - `execute_code_plan`
  - `consult_expert_network`
  - `activate_assistant`
  - `deactivate_assistant`
- Persona activation is request-scoped in v1.

## Semantics
- `consult_expert_network`
  - returns assistant candidates only
  - never mutates prompt/tools by itself
- `activate_assistant`
  - validates assistant availability
  - returns assistant activation payload with prompt + resolved tools
  - executor/orchestrator applies the payload explicitly
- `deactivate_assistant`
  - clears the active assistant and restores base direct tools
  - remains idempotent when no assistant is active

## Shared Payload
- Activation payload contains:
  - `action`
  - `scope`
  - `activation_mode`
  - `assistant_id`
  - `assistant_name`
  - `system_prompt`
  - `skill_tools`
  - `activated_at`
- Search payload contains:
  - `action`
  - `scope`
  - `candidates`
  - `recommended_assistant_id`
  - `reason`

## Cloud Changes
- Add `activate_assistant` / `deactivate_assistant` to `system.deeting_core_sdk`.
- Update `AgentExecutorStep` to consume explicit activation events instead of watching `ctx["assistant"]["id"]`.
- Keep mid-loop prompt/tool injection, but trigger it only after successful `activate_assistant`.
- Stop removing `consult_expert_network` as an implicit side effect.

## Desktop Changes
- Extend desktop code mode entry tools with:
  - `consult_expert_network`
  - `activate_assistant`
  - `deactivate_assistant`
- Add local assistant candidate search, activation payload resolution, and request-scoped active-assistant state.
- Merge active assistant skill tools into the wrapped `tools` payload for subsequent rounds.

## Observability
- Emit explicit assistant transition blocks:
  - `assistant_transition` with `activated` / `deactivated`
- Preserve normal `tool_call` / `tool_result` blocks for auditability.
- Make future UI debugging possible without parsing free-form text.

## Verification
- Cloud tests:
  - core SDK exposes activation tools
  - agent executor applies explicit activation/deactivation payloads
- Desktop tests:
  - entry tools include assistant activation tools
  - wrapped tools payload accepts activation-aware schemas
- Frontend tests:
  - assistant transition blocks render with assistant name and action state
