# Capability Attachment Contract

Shared contract for explicit request-scoped expert capability attachment in Deeting code mode.

## Tools
- `consult_expert_network`
  - returns candidates only
- `attach_capability`
  - returns attachment payload and does not mutate prompt/tools by itself
- `detach_capability`
  - returns a detachment payload and restores default capability-neutral context when applied

## Format Version
- `capability_activation.v1`

## Rules
- Search and attachment are separate actions.
- Activation mode is `attach_capability` in v1.
- Scope is `request` in v1.
- Executors/orchestrators apply returned payloads explicitly.
