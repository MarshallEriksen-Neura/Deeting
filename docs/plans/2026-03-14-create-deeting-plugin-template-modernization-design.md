# Create Deeting Plugin Template Modernization Design

Date: 2026-03-14

## Summary

`create-deeting-plugin` currently scaffolds a plugin template that does not match the current desktop runtime contract. The default template still uses a legacy single-tool `llm-tool.yaml` shape and an outdated Python `invoke(tool_name, args, deeting)` entrypoint, while the current runtime expects `tools:` manifests and a stdin-driven script protocol. This design updates the scaffold so newly created plugins align with the present skill registration and execution model.

## Goals

- Make `packages/templates/default-plugin` the single source of truth for scaffolding.
- Align the generated template with the current local skill runtime protocol.
- Keep the template simple enough for users to customize without understanding internal legacy wrappers.
- Preserve optional UI support.

## Non-Goals

- Do not redesign the plugin UI renderer protocol.
- Do not introduce multiple template families in this pass.
- Do not retrofit every existing plugin sample in the repository.

## Target template contract

### Metadata

`deeting.json` should explicitly include:

- `runtime: ["local"]`
- `execution.timeout_seconds`
- `capabilities.llm_tools`
- `entry.backend` and optional `entry.ui`

### Tool manifest

`llm-tool.yaml` should use the current `tools:` array format so the runtime scanner can materialize callable bindings.

### Backend entrypoint

`main.py` should:

- read JSON from stdin
- resolve `method` / `tool`
- resolve `arguments` / `params`
- emit JSON to stdout

This keeps the scaffold compatible with current `deeting_tool` binding execution instead of the old `invoke(...)` convention.

### UI

The optional `ui/index.html` can stay simple, but should remain obviously optional and not imply that every plugin must ship a UI.

## Scaffold packaging

`packages/create-deeting-plugin` currently contains both a flat `templates/` copy and a nested `templates/default-plugin/` copy. The CLI should always scaffold from `templates/default-plugin` so npm-packed and monorepo-local paths behave the same way.

## Recommended implementation

1. Update `packages/templates/default-plugin/*` to the current runtime contract.
2. Update `packages/create-deeting-plugin/src/index.ts` so it copies `templates/default-plugin`.
3. Update the packaged fallback copy under `packages/create-deeting-plugin/templates/default-plugin/*`.
4. Add a lightweight verification script/test that asserts the scaffolded template includes:
   - `runtime`
   - `execution`
   - `tools:` manifest shape
   - stdin-based backend handler

## Risks

- If the packaged `templates/` copy and source template drift again, CLI behavior will become environment-dependent.
- If the template stays too implicit, users will keep building against the wrong protocol.

## Design rule

- New plugin scaffolds should model the current substrate directly, not historical wrappers.
