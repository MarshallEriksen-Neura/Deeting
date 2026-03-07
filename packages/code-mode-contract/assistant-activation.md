# Assistant Activation Contract

Shared contract for explicit request-scoped assistant activation in Deeting code mode.

## Tools
- `consult_expert_network`
  - returns candidates only
- `activate_assistant`
  - returns activation payload and does not mutate prompt/tools by itself
- `deactivate_assistant`
  - returns a deactivation payload and restores default context when applied

## Format Version
- `assistant_activation.v1`

## Rules
- Search and activation are separate actions.
- Activation mode is `replace` in v1.
- Scope is `request` in v1.
- Executors/orchestrators apply returned payloads explicitly.
