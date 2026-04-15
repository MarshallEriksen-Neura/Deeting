# Desktop Precise Worker Delegation Architecture

**Lane:** `desktop local / runtime / worker route / custom task agent dispatch / workflow handoff`

## Goal

Define the right architecture for one narrow question:

How should the desktop runtime delegate work to a child worker more precisely without inventing a second hidden orchestration system?

This document is intentionally scoped to current desktop-local runtime truth.

It does **not** try to redesign:

- cloud task execution
- backend `SpecExecutor`
- multi-worker DAG orchestration
- a new top-level `codemode` route
- user-facing composer mode semantics

The question here is narrower:

Given the current `Direct | Worker` runtime split, how should worker delegation become more precise?

## Short Answer

The current system is already stronger on `route` and `result integration` than it is on `custom_task_agent dispatch`.

Today the runtime can:

- choose `Direct` vs `Worker`
- inject `search_sdk` and runtime policy into the main model
- select one `custom_task_agent` profile
- run that agent or route it through workflow
- inject a schema-first `delegated_result` back into the main model

The weak seam is the middle:

`route selected`
`->`
`pick one custom_task_agent profile`
`->`
`send mostly raw user message + task_prompt`

That seam is not precise enough.

The correct fix is **not** "give the main model more context" and **not** "add more subagents".

The correct fix is:

- keep `route` runtime-owned
- treat `custom_task_agent` profile lookup as candidate generation, not final delegation truth
- compile a canonical `WorkerTaskPacket`
- score workers using bound callable coverage and output fit, not just lexical/semantic matching
- keep `delegated_result` as the shared return seam for both model and UI

The target pipeline should become:

`runtime discovery`
`->`
`route decision`
`->`
`worker candidate generation`
`->`
`WorkerTaskPacket compilation`
`->`
`custom_task_agent` execution
`->`
`delegated_result injection`

Not:

`user query`
`->`
`heuristic worker match`
`->`
`prompt-only delegation`

## Current Runtime Truth

The correct design has to start from what the code actually does today.

### 1. Top-level route is `Direct | Worker`

Current route selection lives in `deeting/src-tauri/crates/mcp-runtime/src/route.rs`.

`select_local_route_with_evidence(...)` builds a `LocalRouteDecision` from:

- `TaskProfile::from_query(query)`
- `RouteEvidence::from_search_result(search_result)`

This is the actual top-level split:

- `LocalRouteKind::Direct`
- `LocalRouteKind::Worker`

There is no current top-level `CodeMode` route in this layer.

Instead, `execute_code_plan` is an orchestration primitive that becomes available inside the `Worker` execution policy.

### 2. Route selection already uses runtime discovery

In `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs`, the `route_selection` step currently does this:

1. build a `RuntimeDiscoveryBundle`
2. compute a base route via `select_local_route_with_evidence(...)`
3. allow `custom_task_agent` override via `maybe_override_route_with_custom_task_agent_query_vector(...)`
4. apply task-learning route priors via `apply_route_prior(...)`
5. build execution policy via `build_local_execution_policy(...)`
6. apply `prefer_workflow_runtime` override via `apply_desktop_execution_policy_overrides(...)`

This means route is already a real runtime step, not just hidden prompt wording.

### 3. Worker execution is policy-scoped

`deeting/src-tauri/crates/mcp-runtime/src/policy.rs` builds two actual execution policies:

- `Direct` -> `LocalExecutionPlane::ResponseOnly`
- `Worker` -> `LocalExecutionPlane::WorkerReasoning`

For `Worker`, the policy currently enables:

- `search_sdk`
- `query_task_policy`
- `get_tool_schema`
- `execute_code_plan`
- `consult_expert_network`
- `attach_capability`
- `detach_capability`
- onboarding / refresh helpers

This matters because current desktop worker execution is not just "ask another model".

It is a bounded runtime plane with a defined tool surface.

### 4. `Worker` is the route, `custom_task_agent` is the delegated target

Current runtime terminology needs to stay precise:

- `Worker` is the top-level route / execution-plane meaning
- `custom_task_agent` is the current delegated target object

That means the current chain is:

`route = Worker`
`->`
`runtime chooses custom_task_agent profile`
`->`
`runtime delegates`

This document should not describe the current runtime as if there were a separate concrete `worker` entity being delegated to.

### 5. Worker-route delegation is currently a second-stage override

The actual worker-selection seam lives in:

- `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs`

The current flow is:

1. route may already be flipped from `Direct` to `Worker` if `select_worker_custom_task_agent_with_query_vector(...)` finds a matching profile and the base direct reason was only `single_direct_callable`
2. inside worker execution, `maybe_delegate_worker_to_custom_task_agent(...)` tries again to select a `custom_task_agent` profile
3. if found, runtime delegates to either:
   - `workflow_service::prepare_quick_workflow_run(...)` when `prefer_workflow_runtime` is on and the profile is `Chat`
   - `preview_custom_task_agent(...)` otherwise
4. the delegated outcome becomes a `DelegatedExecutionRecord`
5. the main model then receives that outcome as `delegated_result`

This is the current `custom_task_agent` dispatch seam under the `Worker` route.

### 6. Non-Chat invocation kinds already have separate execution branches

`CustomTaskAgentInvocationKind` currently has three values:

- `Chat`
- `ImageGeneration`
- `TextToSpeech`

`preview_custom_task_agent(...)` already treats them differently:

- `ImageGeneration` goes through the dedicated image-generation branch and returns image outputs directly
- `TextToSpeech` goes through the dedicated TTS branch and returns audio outputs directly
- `Chat` goes through the general delegated chat/tool loop

In `worker_handler.rs`, workflow handoff is only attempted when:

- `prefer_workflow_runtime` is enabled
- and `selection.profile.invocation_kind == Chat`

Non-chat invocation kinds explicitly skip workflow routing.

This matters because the delegation-precision refactor in this document is scoped to the `Chat` dispatch path unless stated otherwise.

### 7. Current worker selection is still mostly retrieval-like

`select_custom_task_agent_candidate(...)` currently scores profiles using:

- explicit profile id match
- explicit profile name match
- tag match
- term overlap
- semantic rank from indexed `custom_task_agent` assets
- image-intent special cases

This is useful, but it is still fundamentally a retrieval scorer.

It is not yet a compiled delegation planner.

### 8. Current worker input is too thin

`preview_custom_task_agent(...)` in `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs` builds the delegated conversation from:

- one system block containing:
  - generic runtime instructions
  - `profile.task_prompt`
  - optional guidance skill docs
  - optional maintainer corpus preview
- one user message containing the raw task text

The chat-style custom task agent is also explicitly told:

- do not do extra `search_sdk`
- do not do route planning
- do not do orchestration on your own
- if blocked, explain briefly and stop

That makes the worker bounded, which is good.

But it also means the worker does **not** receive a strong task packet.

### 9. Result integration is already stronger than dispatch

`deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs` already provides a hard return seam:

- `DelegatedExecutionRecord`
- `DelegatedExecutionRecord::delegated_result()`
- `build_delegated_result_feedback_messages(&record)`

That `delegated_result` is schema-versioned and gets injected back into the main chat call before the upstream request.

So the current architecture is already stronger at:

- making delegated output observable
- making delegated output replayable
- keeping UI and model on one schema

than it is at constructing the delegation input.

## The Real Problem

The precision gap is not at the beginning and not at the end.

It is in the middle.

The real weak segment is:

`route decision`
`->`
`custom_task_agent` profile chosen
`->`
`worker receives under-specified task`

That weakness shows up in four concrete ways.

### 1. Selection is not capability-aware enough

Current scoring does not deeply inspect whether the selected worker's bound execution surface actually matches the task.

The scorer does **not** currently make first-class decisions from:

- bound MCP tool coverage
- bound skill action coverage
- output modality fit
- whether the task probably needs retrieval, execution, generation, or maintenance
- whether the profile is weakly similar by text but poorly matched by callable surface

### 2. Worker input is not compiled enough

The worker mostly receives:

- `task_prompt`
- the raw user request

It does not receive a canonical structured packet with:

- explicit goal
- task kind
- constraints
- non-goals
- allowed actions
- forbidden actions
- expected output contract
- completion standard
- relevant runtime evidence

That means the worker must infer too much from prompt text.

### 3. Parent arbitration is too thin

The runtime currently picks a single best profile and moves on.

It does not produce a top-k candidate set and then make a second structured choice from:

- candidate coverage
- candidate risk fit
- candidate modality fit
- candidate historical fit

So the "delegation decision" is currently too close to "highest retrieval score wins".

### 4. Worker-specific learning is missing

The runtime already has a route-learning loop through task policy priors.

But there is no equivalent confirmed worker-selection learning layer such as:

- for task family X, worker A usually succeeds
- for task family Y, worker B over-delegates or blocks
- for task family Z, direct answer is still better than worker A

So route can learn, but `custom_task_agent` dispatch cannot learn enough yet.

## Non-Goals

This architecture should **not** do the following.

### 1. Do not add a hidden second router model

The correct owner of route remains runtime + explicit policy seams.

This design should not smuggle in:

- a second invisible planner model
- prompt-only subagent arbitration
- a free-form "AI decides everything" layer

### 2. Do not make workers self-route

`custom_task_agent` should remain a bounded execution resource.

It should not decide:

- whether the task should have been `Direct`
- whether a different worker should have been selected
- whether it should widen scope and become workflow orchestration owner

That logic belongs to the parent runtime.

### 3. Do not collapse worker route and workflow

Current workflow handoff is real and useful.

This design should preserve:

- direct worker preview path
- optional quick workflow handoff for chat workers

But it should not pretend those are the same object.

### 4. Do not change non-Chat invocation branches in this refactor

This architecture is not proposing a redesign of:

- `CustomTaskAgentInvocationKind::ImageGeneration`
- `CustomTaskAgentInvocationKind::TextToSpeech`

Those branches already have separate execution paths and should remain unchanged in this refactor.

The intended scope is:

- improve `Chat`-style `custom_task_agent` dispatch under the `Worker` route

Not:

- rewrite image generation execution
- rewrite TTS execution
- force non-chat agents through workflow handoff

### 5. Do not solve precision by dumping more transcript

Passing more raw history is not the same as better delegation.

The correct solution is selective compilation, not transcript inflation.

## Core Design Decision

`Chat`-style `custom_task_agent` dispatch under the `Worker` route should be refactored into four explicit seams:

1. `RouteDecision`
2. `WorkerCandidateSet`
3. `WorkerTaskPacket`
4. `DelegatedExecutionRecord`

Only the middle two need major strengthening.

## Proposed Architecture

## 1. Keep RouteDecision Runtime-Owned

Current route ownership is already mostly correct.

Keep these properties:

- route remains `Direct | Worker`
- route still uses runtime discovery evidence
- safety locks still prevent route priors from overriding destructive / approval-sensitive direct routes
- task-learning route priors remain tie-breakers, not safety overrides

Recommended change:

- do not let `custom_task_agent` override act like a hidden route replacement
- instead convert it into a candidate-generation signal that feeds worker dispatch

In other words:

Current behavior:

`base route -> maybe flip route because one worker matched`

Target behavior:

`base route -> if worker lane is plausible, build worker candidate set -> choose worker from stronger dispatch planner`

This keeps route cleaner.

## 2. Replace Single Winner Lookup with WorkerCandidateSet

Current `select_custom_task_agent_candidate(...)` should evolve from "pick one `custom_task_agent` profile" into "build a candidate set".

Recommended new object:

```text
WorkerCandidateCard
- profile_id
- profile_name
- invocation_kind
- description
- tags
- bound_callable_summary
- guidance_skill_summary
- retrieval_score
- lexical_score
- semantic_score
- callable_coverage_score
- modality_fit_score
- profile_prior_score
- final_score
- reason_codes[]
```

Recommended runtime behavior:

1. list active discoverable profiles
2. compute retrieval features
3. compute execution-surface fit features
4. compute output/modality fit features
5. compute historical fit features
6. keep top `k` cards
7. choose winner from that structured set

The runtime may still auto-select one winner.

But the important change is that the winner should be chosen from a real candidate set, not directly from string matching.

### Required new scoring dimensions

Current scorer is already fine for:

- lexical name match
- tag match
- semantic profile recall

But it needs these additional dimensions.

#### A. Bound callable coverage

Use the selected `custom_task_agent` profile's bound execution surface as a first-class feature:

- `callable_mcp_tool_ids`
- `callable_skill_action_refs`
- `invocation_kind`
- built-in callable availability

Examples:

- if the task is likely to need browser or host actions, prefer profiles that actually bind callable tools for that lane
- if the task is evidence-heavy but tool-light, favor strong chat workers with better guidance docs
- if the task implies write or maintenance behavior, prefer profiles whose callable surface supports that write path

#### B. Output modality fit

Selection should consider expected output shape:

- text answer
- structured summary
- image generation
- audio
- maintenance/write task

Current image special-casing is a valid prototype of this idea, but it should become a general modality-fit layer.

#### C. Profile prior fit

Add a future worker-selection learning seam:

- task family `fingerprint_key`
- selected `profile_id`
- outcome quality
- blocked / success / rerun signals

This should become a dispatch-time bias, similar in spirit to route priors but scoped to worker selection.

## 3. Introduce Canonical WorkerTaskPacket

This is the most important structural addition.

The delegated `Chat` custom task agent should stop receiving mostly raw request text.

Instead the runtime should compile a canonical task packet first.

Recommended object:

```text
WorkerTaskPacket
- schema_version
- task_id
- route
- goal
- user_query
- task_kind
- deliverable_kind
- context_summary
- relevant_inputs
- required_capabilities[]
- candidate_capabilities[]
- constraints[]
- non_goals[]
- allowed_actions[]
- forbidden_actions[]
- output_contract
- completion_standard
- escalation_policy
- packet_hash
```

### Why this object matters

It changes delegation from:

- "read this prompt and guess what the parent meant"

into:

- "execute this bounded compiled task"

That is the actual difference between fuzzy delegation and precise delegation.

### Packet fields that should come from current runtime data

The runtime already has most of the raw ingredients.

#### From route / policy

- `route`
- `reason_codes`
- `allowed_tool_names`
- whether workflow handoff is preferred

#### From discovery

- `capability_snapshot`
- top direct capabilities
- relevant orchestration primitives
- routing hints

#### From user input

- latest normalized prompt
- image inputs if any
- narrow conversation summary, not whole transcript

#### From dispatch planner

- selected worker profile
- candidate-set reasons
- callable coverage assumptions

### Packet should be selective, not exhaustive

The packet should **not** include the full conversation by default.

Instead it should carry:

- latest task request
- a concise parent-written context summary
- only the evidence needed for this worker to act

That keeps delegation bounded and inspectable.

## 4. Pass WorkerTaskPacket into Custom Task Agent Runtime

The `Chat` branch of `preview_custom_task_agent(...)` should evolve to accept more than plain text.

Recommended direction:

- preserve the current `task_prompt`
- preserve guidance-skill loading
- preserve bound callable lanes
- add canonical packet injection ahead of the user message

Recommended message shape:

1. `system`
   - runtime rules
   - profile `task_prompt`
   - lane constraints
2. `system`
   - canonical `WorkerTaskPacket` instruction header
3. `user`
   - serialized `WorkerTaskPacket` JSON
4. optional extra `user`
   - raw human phrasing for tone-sensitive tasks if needed

The packet should be authoritative for scope and success criteria.

The raw user message can still exist as supporting context, but it should stop being the primary contract.

### Why the packet must live inside runtime, not profile prompt

`task_prompt` is profile-owned.

`WorkerTaskPacket` is runtime-owned.

That separation is important.

The profile says:

- what this worker is generally for
- what lane rules it follows

The packet says:

- what this exact delegated task is
- what success means now
- what not to do now

If those stay merged, precision stays weak.

## 5. Keep Workers Bounded

Current custom task agent instructions explicitly prohibit:

- extra search routing
- route planning
- independent orchestration

That is directionally correct.

Keep that principle.

But replace the current thin boundary with a stronger one:

- the worker should not self-route
- the worker should not self-widen scope
- the worker should not invent missing success criteria
- the worker should not infer authority from general prompt style

The worker should execute the packet it was given.

## 6. Strengthen Selection Metadata in DelegatedExecutionRecord

Current `DelegatedExecutionSelection` already records:

- `explicit`
- `score`
- `reason_codes`
- `reason_text`

That should be expanded, not replaced.

Recommended additions:

```text
DelegatedExecutionSelection
- explicit
- score
- reason_codes[]
- reason_text
- candidate_count
- selected_from_top_k
- callable_coverage_score
- modality_fit_score
- profile_prior_score
- packet_hash
```

This matters for two reasons:

1. UI and debug surfaces can explain why this worker was chosen
2. future worker-selection learning can evaluate whether the dispatch basis was actually good

## 7. Keep Delegated Result as the Shared Return Contract

This part is already right for both direct custom task agent execution and workflow handoff.

Do not regress from the current schema-first seam.

Keep:

- `DelegatedExecutionRecord`
- `delegated_result`
- shared model/UI consumption
- structured `primary_output`

The design correction is not on return.

It is on dispatch.

### Recommended extension

Include a lightweight packet receipt in the delegated record:

```text
packet_receipt
- packet_hash
- task_kind
- deliverable_kind
- selected_profile_id
```

That would let replay surfaces confirm exactly what the worker was asked to do.

## Module Shape

The safest implementation is to add a focused dispatch module instead of growing `worker_handler.rs`.

Recommended new module:

`deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs`

Suggested ownership:

### `worker_dispatch.rs`

Own:

- candidate generation
- candidate scoring
- top-k selection
- `WorkerTaskPacket` compilation
- dispatch-plan summary objects

### `worker_handler.rs`

Own:

- lifecycle emission
- workflow vs preview branch
- delegation execution
- delegated record creation

### `custom_task_agents/runtime.rs`

Own:

- packet consumption for the `Chat` branch
- `Chat` custom task agent execution loop
- bound callable execution
- structured worker result assembly

Keep unchanged:

- `ImageGeneration` branch
- `TextToSpeech` branch

### `execution_plane.rs`

Keep owning:

- `DelegatedExecutionRecord`
- `delegated_result`
- final integration into main model request

## Proposed Data Contracts

## A. WorkerCandidateCard

```json
{
  "profile_id": "research.worker",
  "profile_name": "Research Worker",
  "invocation_kind": "chat",
  "retrieval_score": 0.71,
  "callable_coverage_score": 0.83,
  "modality_fit_score": 0.60,
  "profile_prior_score": 0.15,
  "final_score": 1.94,
  "reason_codes": [
    "semantic_rank",
    "callable_coverage",
    "research_task_fit"
  ]
}
```

## B. WorkerTaskPacket

```json
{
  "schema_version": 1,
  "task_id": "task_123",
  "route": "worker",
  "goal": "Compare the current desktop delegation seams and propose a concrete redesign.",
  "user_query": "how to delegate child agents more precisely",
  "task_kind": "analysis",
  "deliverable_kind": "architecture_note",
  "context_summary": "The parent runtime already selected Worker and wants a bounded analysis result, not independent orchestration.",
  "required_capabilities": [],
  "constraints": [
    "Do not self-route",
    "Do not widen scope to full workflow redesign"
  ],
  "non_goals": [
    "Do not redesign cloud execution"
  ],
  "allowed_actions": [
    "use bound callable tools",
    "return structured findings"
  ],
  "forbidden_actions": [
    "run extra search_sdk",
    "perform orchestration planning"
  ],
  "output_contract": {
    "required_sections": [
      "summary",
      "findings",
      "recommendation"
    ]
  },
  "completion_standard": "Return a concrete recommendation with explicit tradeoffs.",
  "escalation_policy": "If blocked by missing callable surface, return blocked with the missing surface named.",
  "packet_hash": "..."
}
```

## C. DelegatedSelectionMeta

```json
{
  "score": 88,
  "candidate_count": 3,
  "reason_codes": [
    "semantic_rank",
    "callable_coverage"
  ],
  "callable_coverage_score": 0.83,
  "modality_fit_score": 0.60,
  "profile_prior_score": 0.15,
  "packet_hash": "..."
}
```

## Rollout Plan

## Phase 1: Extract dispatch planning without changing execution semantics

Goal:

- move `custom_task_agent` dispatch logic into a dedicated dispatch module
- produce candidate cards and richer selection metadata
- keep the final execution path unchanged

Concrete changes:

- extract `select_custom_task_agent_candidate(...)` responsibilities
- compute `WorkerCandidateSet`
- still choose one winner automatically
- write richer selection data into `DelegatedExecutionSelection`

Success condition:

- no change to visible worker behavior
- much better inspectability

## Phase 2: Introduce WorkerTaskPacket

Goal:

- stop delegating with only raw user message plus profile prompt

Concrete changes:

- add `WorkerTaskPacket` type
- compile packet in runtime before delegation
- add packet injection only to the `Chat` path in `custom_task_agents/runtime.rs`
- keep existing raw message only as supporting context if needed

Success condition:

- delegated task scope becomes explicit and replayable
- `ImageGeneration` and `TextToSpeech` execution behavior remains unchanged

## Phase 3: Add coverage-aware dispatch scoring

Goal:

- make worker choice depend on execution surface fit, not mostly retrieval fit

Concrete changes:

- inspect bound callables and invocation kind during scoring
- add modality-fit scoring
- gate low-coverage profiles from auto-selection

Success condition:

- fewer false-positive worker matches

## Phase 4: Add worker-selection learning

Goal:

- let the system learn which worker works for which task family

Concrete changes:

- add worker-selection outcome recording
- add task-family x profile prior lookup
- feed that prior into candidate scoring

Success condition:

- similar future tasks choose better workers with less dispatch drift

## Why This Is Better

This architecture improves precision without creating a second fake brain.

It keeps what is already correct:

- runtime-owned route
- bounded worker execution
- schema-first delegated result
- workflow handoff when desired

And it fixes the actual weak seam:

- worker dispatch becomes a compiled runtime decision instead of a mostly heuristic retrieval match

## Final Position

The current desktop runtime is already close to the right architecture.

The main correction is not "add more context" and not "add more subagents".

The main correction is:

- strengthen `custom_task_agent` dispatch under the `Worker` route
- compile a real `WorkerTaskPacket`
- score workers by execution fit
- keep `delegated_result` as the hard return seam

In short:

The system does not need a smarter child by default.

It needs a better parent-owned delegation contract.
