# Deeting Workflow Runtime V2

Updated: 2026-03-23
Status: proposed architecture
Scope: desktop local only

## 1. Positioning

This document is intentionally narrowed to `desktop local`.

It does not define:

- cloud workflow execution
- backend-owned workflow scheduling
- hybrid desktop/backend workflow runs
- remote worker federation

The goal is to make desktop Deeting capable of running a truthful, durable workflow runtime on top of the existing local runtime stack.

## 2. Problem

Desktop Deeting already has two useful but incomplete lines of capability:

1. `desktop_runtime`
   - Good at local routing, capability discovery, code mode, approval interruption, and live execution.
   - Weak at durable workflow state, rerun semantics, persisted checkpoints, and first-class multi-step run objects.
2. `custom_task_agent`
   - Good at bounded local worker execution with model binding, MCP tools, guidance skills, and skill actions.
   - Weak at workflow-level scheduling, artifacts, lifecycle, and replay.

The real production gap is not "more subagents".

The real gap is:

- desktop can route and execute
- desktop can delegate to one worker
- desktop still lacks a durable workflow runtime between routing and leaf execution

## 3. Core Decision

Desktop V2 should standardize on three layers:

- `Chat Surface`
  - the user interaction surface
- `Workflow Runtime`
  - the local orchestration surface
- `WorkerProfile`
  - the bounded local execution surface

The critical architectural decision is:

- keep `desktop_runtime` as the execution truth for desktop local
- treat `custom_task_agent` as the first `WorkerProfile` implementation
- treat old `spec agent` as a source of useful product/runtime patterns, not as the desktop execution kernel

The corresponding routing decision is:

- short term: keep `Direct`, current single-worker delegation, and `Workflow`
- long term: converge to `Direct` plus `Workflow`
- in that end state, current single-worker delegation becomes a compatibility path for a minimal one-step workflow run, not a separate orchestration model

This is the main correction from the earlier broader framing.

## 4. Non-Goals

V2 does not start with:

- backend workflow execution
- shared worker identity across desktop and cloud
- hybrid workflow runs spanning local and remote executors
- arbitrary loop/replan support in MVP
- group-chat swarm orchestration
- unrestricted local code execution beyond existing desktop policy surfaces

## 5. Product Goal

Enable desktop Deeting to handle three near-term execution modes with one coherent local runtime:

1. Direct answer
   - existing local chat path when orchestration is unnecessary
2. Single delegated worker
   - existing light-weight delegation to one `WorkerProfile`
   - treated as a compatibility path in V2, not the long-term final orchestration shape
3. Workflow run
   - a durable local multi-step run with persisted lifecycle, approval, rerun, artifact, and trace

Long term, the architecture should simplify to:

1. Direct answer
2. Workflow run

where a one-worker task is represented as the smallest workflow rather than a separate orchestration class.

The product outcome is not "AI feels smarter".

The product outcome is:

- state is not lost
- approval is resumable
- rerun is explicit
- run detail is inspectable
- workflow UI can reflect real runtime state instead of prompt fiction

## 6. Current Desktop Truth

### 6.1 What is already real in desktop runtime

Desktop runtime already owns:

- route selection
- execution policy selection
- capability discovery
- delegated worker execution
- code-mode execution
- approval interruption and resume for local execution
- streaming status and trace blocks

That means desktop already has an orchestration spine.

V2 should extend that spine instead of replacing it with a second local orchestrator.

### 6.2 What is already real in `custom_task_agent`

`custom_task_agent` already behaves like a local worker profile with:

- persisted local profile storage
- prompt binding
- model binding
- callable MCP tools
- callable skill actions
- guidance skills
- discoverability metadata

This is a strong foundation for the first `WorkerProfile`.

### 6.3 What is useful in old `spec agent`

Old `spec agent` still contains useful ideas:

- persisted run/step/session state
- run status and step detail
- rerun and patch semantics
- approval interaction
- workflow-oriented UI vocabulary

But those are reusable patterns, not the desktop runtime source of truth.

### 6.4 What is missing today

Current desktop worker delegation is still:

`route -> pick one custom task agent -> preview -> inject result back into chat`

That is useful, but it is still a worker call, not a durable workflow runtime.

## 7. Source Of Truth Decision

For desktop-local V2:

- execution truth lives in `deeting/src-tauri/src/modules/desktop_runtime/`
- worker profile truth begins with `deeting/src-tauri/src/modules/custom_task_agents/`
- workflow persistence truth should live in desktop-local SQLite, alongside existing Tauri-local runtime storage

For agent ownership, desktop-local V2 should also treat:

- the primary desktop assistant as the only orchestration entry
- worker templates as controlled execution resources
- worker instances as ephemeral runtime objects created per phase

Explicitly not true for this phase:

- backend Postgres is not the workflow truth
- backend `SpecExecutor` is not the desktop workflow kernel
- `/spec-agent/*` is not the implementation target for V2 desktop execution

## 8. Target Architecture

```text
User Request
  -> Desktop Chat Surface
  -> Desktop Intent Router
     -> Direct Answer
     -> Single Worker Delegation
     -> Workflow Runtime

Desktop Workflow Runtime
  -> Plan Proposal Generator
  -> Plan Compiler / Validator
  -> Scheduler
  -> Revalidation Engine
  -> Context Packet Builder
  -> Worker Template Resolver
  -> Approval / Policy Layer
  -> Worker Adapter Layer
  -> Artifact Store
  -> Checkpoint Store
  -> Event Log

Worker Adapter Layer
  -> user_worker_profile adapter
  -> system_worker_template adapter
  -> mcp_tool adapter
  -> skill_action adapter
  -> direct_llm adapter

Deferred
  -> code_mode adapter
  -> loop / replan runtime
```

## 9. Layer Responsibilities

### 9.1 Router / Control Plane

Responsibilities:

- classify request as direct, delegated-worker, or workflow
- decide whether planning is necessary
- attach local runtime policy
- emit user-visible routing reasons

This stays close to current desktop control plane.

The router and planner are owned by the primary desktop assistant.

Worker execution should not become a second user-facing entry surface.

### 9.2 Plan Proposal Generator

Responsibilities:

- generate one coarse-grained workflow proposal from user intent
- produce 3 to 5 human-readable phases as a starting point
- bind each proposed phase to a suggested local runtime owner
- output a user-editable proposal, not the final execution truth

Important constraints:

- the generator is judged by whether it produces a useful starting point, not a perfect final plan
- user editing is the primary correction path
- full regeneration is an exception path, not the normal loop

This is intentionally weaker than a classical "master planner".

### 9.3 Plan Compiler / Validator

Responsibilities:

- parse the user-confirmed proposal into structured execution data
- validate unresolved worker refs, malformed stages, and unsafe edits
- freeze the current execution snapshot before a run starts or resumes
- reject edits that break the executable subset

The key rule is:

- proposal is editable
- execution snapshot is executable

Desktop should never treat arbitrary edited markdown or free text as direct runtime truth.

### 9.4 Scheduler

Responsibilities:

- compute ready steps
- drive step state transitions
- stop at approval gates
- persist run/step/event/checkpoint state
- resume after approval or rerun
- revalidate the remaining plan after each completed phase
- request suffix replan or user edit when later phases are no longer valid

In MVP, this can remain sequential.

True parallel scheduling is deferred.

### 9.5 Context Packet Builder

Responsibilities:

- build the per-phase handoff context from proposal, execution snapshot, prior results, and artifact refs
- render a human-readable `context.md`
- emit a machine-readable `context.json`
- keep user-editable notes separate from system-generated facts

This layer exists because database persistence and worker communication are different concerns.

SQLite is the storage truth.

Context packets are the communication truth between phases.

### 9.6 Worker Template Resolver

Responsibilities:

- resolve the phase's requested execution target from a controlled template pool
- choose between user worker profiles, system worker templates, and direct self-execution
- instantiate a temporary worker instance for the phase
- reject unknown or unauthorized template references

The key design rule is:

- runtime may instantiate worker instances
- runtime does not invent new persistent worker definitions on the fly

### 9.6.1 Resolver priority

For MVP, worker template resolution should follow a deterministic priority order:

1. explicit user-selected `user_worker_profile`
2. explicit `system_worker_template`
3. explicit `direct_llm`
4. runtime fallback to the `PrimaryAssistant`

Failure rules:

- if an explicit worker ref is invalid, do not silently switch to another specialized worker
- if a worker ref is valid but temporarily unavailable, runtime may pause for edit or fall back to `PrimaryAssistant` only when policy allows it
- every fallback decision must be recorded in run and step events

### 9.6.2 Why this priority matters

This preserves three important invariants:

- user choice wins when explicitly stated
- system templates remain controlled and auditable
- the primary assistant remains the safe universal fallback

### 9.7 Worker Adapter Layer

Responsibilities:

- normalize local leaf executors behind one contract
- hide executor-specific invocation details from the scheduler
- feed workers a context packet instead of exposing storage internals directly

Proposed contract:

```ts
interface WorkerAdapter {
  kind: "worker_profile" | "mcp_tool" | "skill_action" | "direct_llm"
  canHandle(step: WorkflowStep): boolean
  execute(input: WorkerExecutionInput): Promise<WorkerExecutionResult>
}
```

Important desktop constraint:

`custom_task_agent` is not a pure tool call. It is a bounded local worker that may itself perform internal tool rounds.

The runtime should accept that instead of pretending it is an atomic MCP tool.

### 9.8 Approval / Policy Layer

Responsibilities:

- pause workflow execution at explicit approval gates
- persist checkpoint rows
- resume deterministically after approve / reject / modify
- carry local policy metadata needed for safe resume

This is one of the main missing durable layers today.

### 9.9 Artifact Store

Responsibilities:

- persist structured outputs and references
- avoid replaying giant raw text between steps
- provide UI-friendly step outputs

Image outputs already have partial local persistence patterns.

Workflow V2 generalizes that idea to structured step outputs.

### 9.10 Event Log

Responsibilities:

- append run and step lifecycle events
- support replay, debugging, status UI, and audit

For desktop-only V2, event log is more important than advanced graph expressiveness.

## 10. Conceptual Model

### 10.1 WorkerProfile

`custom_task_agent` should be renamed mentally as:

- not a manager
- not a workflow
- not a global agent identity

It is a local `WorkerProfile` with:

- prompt
- model binding
- callable MCP tools
- guidance skills
- callable skill actions
- discoverability metadata

This is the user-owned form of a worker template.

### 10.2 PrimaryAssistant

The primary desktop assistant is:

- the only user-facing orchestration entry
- the owner of routing, planning, compilation, and revalidation
- the default executor when no specialized worker is needed

It is not just "one more worker".

It is the coordinator.

### 10.3 WorkerTemplate

A controlled execution template containing:

- role and prompt definition
- execution surface
- tool and skill bindings
- policy limits
- discoverability metadata

Worker templates come from two sources:

- user-defined worker profiles
- system-defined worker templates

### 10.4 UserWorkerProfile

A user-authored worker template backed by local desktop persistence.

This is the current `custom_task_agent` line.

### 10.5 SystemWorkerTemplate

A system-owned worker template provided by the app itself.

Examples may include:

- critic-like review workers
- research workers
- summarization workers

These are controlled templates, not ad hoc AI inventions.

### 10.6 WorkerInstance

A temporary runtime instantiation of a worker template for one phase execution.

Key properties:

- created by the primary assistant or scheduler
- scoped to one step or phase attempt
- can consume a context packet
- can emit structured result artifacts
- is disposable after execution

This is the closest desktop-runtime analogue to Codex-style subagent execution.

### 10.7 PlanProposal

A user-editable planning artifact containing:

- coarse-grained phases
- suggested workers
- editable descriptions
- optional notes and constraints
- human-readable ordering

This is the primary object shown to the user before execution.

It may be rendered as:

- a structured markdown template in MVP
- a native plan editor later

But in both cases, it is still a proposal, not the final runtime truth.

### 10.7.1 Recommended `proposal.md` template

The MVP proposal document should stay semi-structured and easy to edit.

Suggested shape:

```md
# Workflow Proposal

Title: Workflow Runtime V2 launch package
Goal: Produce a launch-ready proposal, architecture note, and review materials

## Global Constraints
- Preferred language: Chinese
- Out of scope: cloud execution
- Editable by user: yes

## Phase 1: External Research
- Worker: user_worker_profile:research-pro
- Goal: Find 3 relevant desktop AI agent or workflow products
- Expected output: research_notes
- User Notes:

## Phase 2: Repo Boundary Analysis
- Worker: system_worker_template:repo-architect
- Goal: Analyze desktop_runtime, custom_task_agent, and code_mode boundaries
- Expected output: repo_boundary_map
- Depends on: Phase 1
- User Notes:

## Phase 3: MVP Synthesis
- Worker: direct_llm:default
- Goal: Synthesize MVP interaction, storage model, and migration path
- Expected output: mvp_spec
- Depends on: Phase 2
- User Notes:

## Phase 4: Review Package
- Worker: user_worker_profile:cn-writer
- Goal: Produce PRD, tech note, and review checklist
- Expected output: review_package
- Depends on: Phase 3
- User Notes:
```

Editing expectations:

- users can change phase titles, goals, workers, order, and notes
- users can add or remove not-yet-executed phases
- the runtime compiler is responsible for turning this into an executable snapshot

### 10.8 ExecutionSnapshot

A compiled executable snapshot containing:

- validated phase list
- resolved worker references
- frozen execution ordering
- execution-time policy fields
- references to the proposal version it was compiled from

This is the runtime truth for a given execution window.

User edits update the proposal.

Execution runs against the latest compiled snapshot, not raw proposal text.

### 10.8.1 Minimal `snapshot.json` schema

The first executable version of `snapshot.json` should capture only what runtime needs to execute and resume deterministically.

Suggested minimum fields:

```json
{
  "run_id": "uuid",
  "proposal_version": 3,
  "snapshot_version": 2,
  "compiled_at": "2026-03-23T12:00:00Z",
  "goal": "Produce a launch-ready Workflow Runtime V2 package",
  "phases": [
    {
      "phase_id": "phase-1",
      "title": "External Research",
      "worker_ref": "user_worker_profile:research-pro",
      "depends_on": [],
      "goal": "Find 3 relevant desktop AI agent or workflow products",
      "expected_output": {
        "result_kind": "json_structured",
        "result_schema_hint": "research_notes.v1"
      }
    },
    {
      "phase_id": "phase-2",
      "title": "Repo Boundary Analysis",
      "worker_ref": "system_worker_template:repo-architect",
      "depends_on": ["phase-1"],
      "goal": "Analyze desktop_runtime, custom_task_agent, and code_mode boundaries",
      "expected_output": {
        "result_kind": "json_structured",
        "result_schema_hint": "repo_boundary_map.v1"
      }
    }
  ],
  "policy": {
    "allow_auto_suffix_replan": false,
    "default_timeout_ms": 600000
  }
}
```

This schema should remain narrower than the editable proposal:

- proposal is optimized for editing
- snapshot is optimized for execution and resume

The compiler is responsible for translating between those two forms.

### 10.9 ContextPacket

A per-phase communication bundle containing:

- `context.md` for model/human-readable context
- `context.json` for machine-readable runtime fields
- references to prior `result.md`, `result.json`, and raw artifacts

This is how information is handed to the next phase.

It is not a substitute for persistence.

It is the communication interface above persistence.

### 10.10 WorkflowTemplate

A reusable local blueprint containing:

- reusable phase topology
- reusable worker bindings
- reusable policy defaults

Templates are optional and explicitly deferred behind proposal-driven MVP.

### 10.11 WorkflowRun

A concrete local run containing:

- request input
- proposal reference
- execution snapshot reference
- resolved step graph
- run lifecycle status
- context snapshot
- checkpoint pointer
- artifact references

### 10.12 WorkflowStepRun

A concrete step attempt containing:

- step status
- input snapshot
- output artifact refs
- worker trace summary
- retries
- error
- started/completed timestamps

### 10.13 WorkflowEvent

An append-only runtime event containing:

- run ID
- step ID when applicable
- event type
- event payload
- created timestamp

### 10.14 WorkflowCheckpoint

A persisted pause point containing:

- run ID
- reason
- blocked step ID
- approval payload
- resume payload

### 10.15 RemainingPlanState

A runtime view over not-yet-executed phases containing:

- still valid phases
- invalidated phases
- obsolete phases
- phases requiring suffix replan

This exists because the planner is not trusted to remain correct after reality changes.

## 11. Desktop-Only Worker Reference Scheme

For desktop-local V2, keep `worker_ref` intentionally narrow:

- `worker_profile:{id}`
- `mcp_tool:{tool_name}`
- `skill_action:{skill_id}#{action_id}`
- `direct_llm:{profile_slug}`

Explicitly deferred:

- `code_mode:{preset}`
- remote worker refs
- backend-owned worker refs

Why this matters:

- it matches what desktop can actually resolve today
- it avoids inventing a fake shared identity model
- it keeps MVP executable

## 12. Recommended Step Types

### 12.1 MVP step types

Start with a small honest set:

- `worker_call`
- `approval_gate`
- `finalize`

### 12.2 Phase-2 step types

Add only after MVP is stable:

- `logic_gate`
- `mcp_tool_call`
- `skill_action_call`

### 12.3 Deferred step types

Do not put these in MVP:

- `parallel_group`
- `replan`
- `loop`
- `handoff`
- `code_mode_call`

### 12.4 Why this narrower MVP

Desktop currently lacks durable workflow persistence, not expressive graph syntax.

So the first win should be:

- persisted runs
- persisted step attempts
- persisted approval checkpoints
- rerun and inspection

not:

- advanced graph control flow
- fake generality

## 13. Persistence Model

Desktop V2 should persist workflow state in desktop-local SQLite.

Recommended tables:

- `workflow_run`
- `workflow_step_run`
- `workflow_event`
- `workflow_checkpoint`
- `workflow_artifact`

Optional later:

- `workflow_template`
- `workflow_worker_session`

### 13.1 Mapping to existing local truth

- `custom_task_agent_profiles` remains the source of truth for `worker_profile`
- workflow run state is new and should not try to directly reuse backend `SpecPlan` tables

### 13.2 Why not reuse backend spec tables directly

Because this phase is desktop-local only:

- different runtime owner
- different storage boundary
- different approval/resume mechanics
- different execution spine

Spec tables are a reference for shape, not the storage target.

## 14. Runtime Structure

Desktop V2 should use a hybrid model:

1. Graph
   - for topology
2. Run FSM
   - for lifecycle state
3. Event Log
   - for durable history

This separation still makes sense in desktop-only scope.

But MVP should keep the graph model simple.

### 14.1 Runtime truth rule

For this design, runtime truth is ordered by reliability:

1. real executed artifacts
2. current execution snapshot
3. latest user-edited proposal
4. initial AI-generated proposal

This ordering is intentional.

It prevents the system from treating the first plan draft as more authoritative than reality.

### 14.2 Additional runtime states

Beyond normal success/failure states, desktop workflow runtime should support:

- `awaiting_plan_edit`
- `obsolete`
- `invalidated`
- `needs_suffix_replan`

These states matter because a later phase may stop making sense even when no step has technically failed.

## 15. Plan Editing And Checkpoint Semantics

Desktop V2 should treat user editing as a first-class workflow capability, not just a narrow approval popup.

Desktop approval today already has live interruption and resume behavior in code mode.

V2 should generalize that into durable workflow checkpoints plus editable plan proposals.

### 15.1 Proposal flow

The intended happy path is:

1. user request arrives
2. AI generates one coarse-grained plan proposal
3. user edits the proposal directly
4. user confirms execution
5. system compiles the proposal into an execution snapshot
6. scheduler executes the current snapshot

This is intentionally different from:

- plan once, execute forever
- repeatedly regenerate the whole plan after every user comment

Regeneration should remain a manual fallback for cases where the proposal direction is broadly wrong.

### 15.2 Compile before execution

Before any workflow starts, desktop should:

- parse the latest proposal version
- validate the executable subset
- resolve workers and phase ordering
- write a fresh execution snapshot
- prepare the first phase context packet

If compile fails:

- keep the proposal editable
- show validation errors in UI
- do not start execution

### 15.3 Plan editing checkpoint

When a step reaches an editing checkpoint, desktop should:

- persist a `workflow_checkpoint`
- persist a `run.awaiting_plan_edit` or `step.waiting_approval` event
- allow the user to edit only not-yet-executed phases
- compile the edited proposal into a new execution snapshot before resuming

Editing capabilities should include:

- change phase description
- change suggested worker
- add a later phase
- remove a not-yet-executed phase
- reorder not-yet-executed phases

### 15.4 Approval outcomes

Support explicit checkpoint actions:

- `approve`
- `reject`
- `modify`

But MVP `modify` should still stay structured:

- change instruction text
- select branch option
- adjust a bounded input field

Do not start with arbitrary patch-plan semantics.

### 15.5 Revalidate after each phase

After each completed phase, scheduler should inspect the remaining plan and decide:

- `continue`
- `pause_for_edit`
- `mark_obsolete`
- `mark_invalidated`
- `suffix_replan`

This is the core safeguard against planner unreliability.

The system should assume:

- the initial proposal may be directionally right but locally wrong
- real artifacts can invalidate later phases
- user edits and runtime revalidation must work together

### 15.5.1 Revalidation decision table

Use the following default decisions in MVP:

| Situation | Default action | Reason |
|---|---|---|
| Upstream result matches expected shape and later phases still make sense | `continue` | No correction needed |
| Upstream result is usable, but user intent may want refinement or reprioritization | `pause_for_edit` | Human correction is cheaper than blind replanning |
| A later phase is no longer needed because an earlier phase already answered it | `mark_obsolete` | Preserve history without pretending the phase failed |
| A later phase depends on assumptions that are now false | `mark_invalidated` + `pause_for_edit` | Facts changed; user should see the break |
| Remaining suffix is structurally broken but still machine-recoverable | `suffix_replan` | Local automatic repair is appropriate |
| Safety, cost, or policy boundary is crossed | `pause_for_edit` | Do not auto-replan across sensitive boundaries |

### 15.5.2 Auto suffix replan guardrails

Automatic suffix replanning should only be allowed when all are true:

- only not-yet-executed phases are affected
- the original user goal is unchanged
- worker/policy surface is not broadening materially
- no sensitive approval boundary is being bypassed
- the runtime can explain the replan delta to the user

Otherwise default to `pause_for_edit`.

### 15.6 Phase handoff rule

For every phase boundary, desktop should:

1. persist phase result artifacts
2. build the next phase context packet from:
   - original user request
   - current proposal text
   - current execution snapshot
   - upstream result summaries
   - upstream artifact references
3. resolve the next phase worker template
4. instantiate a worker instance
5. execute against the context packet

This creates a continuous chain with no hidden handoff gap between planning and execution.

### 15.7 Resume rule

Resume should rebuild state from:

- `workflow_run`
- `workflow_step_run`
- `workflow_checkpoint`
- `workflow_event`

not from in-memory runtime objects only.

## 16. Artifact Semantics

Artifacts should be first-class local runtime outputs.

Recommended artifact categories:

- `text_summary`
- `json_structured`
- `table`
- `image`
- `file_ref`
- `link`

Each completed phase should normally produce:

- `result.md`
  - human-readable result summary
- `result.json`
  - structured machine-readable result
- raw artifacts
  - files, images, tables, extracted sources, and similar outputs

Each next phase should consume a `context packet` built from those outputs:

- `context.md`
  - readable handoff document for the worker instance
- `context.json`
  - structured runtime metadata for adapter execution

Important rule:

- artifact store is the persistence truth
- context packet is the phase-to-phase communication interface

The runtime should not collapse those two into one thing.

### 16.1 Why not pass SQLite rows directly to workers

Workers should not need to understand:

- SQLite schema
- workflow storage tables
- audit/event row formats

Workers should instead receive:

- a readable task handoff
- selected upstream summaries
- artifact refs
- explicit constraints and policy fields

Avoid making raw prompt replay the main data bus.

### 16.2 Recommended local run directory

```text
~/.deeting/workflows/
  └── {run_id}/
      ├── proposal.md
      ├── snapshot.json
      ├── phases/
      │   ├── phase-1/
      │   │   ├── context.md
      │   │   ├── context.json
      │   │   ├── result.md
      │   │   ├── result.json
      │   │   └── artifacts/
```

SQLite and local files should cooperate:

- SQLite indexes and tracks runtime truth
- local files provide inspectable working documents and artifacts

### 16.3 Recommended context packet shape

`context.md` should be semi-structured, not fully freeform.

Suggested sections:

- task goal
- system-generated upstream result summary
- original user request
- constraints
- user notes

Editing rule:

- system-generated factual sections should be treated as controlled output
- user notes should be the main editable correction area
- if system-generated summary is editable, the runtime should preserve provenance and diff history

### 16.3.1 Recommended `phase/context.md` template

Suggested handoff template:

```md
# Phase 2: Repo Boundary Analysis

## Task Goal
Analyze the real boundaries between `desktop_runtime`, `custom_task_agent`, and `code_mode`.

## System-Generated Upstream Summary
Phase 1 found:
- Product A uses a primary assistant plus temporary worker instances
- Product B exposes editable plans but hides worker context
- Product C uses local markdown working files for human review

## Original User Request
Help me produce a launch-ready Workflow Runtime V2 package for desktop local.

## Constraints
- Worker: system_worker_template:repo-architect
- Allowed tools: search_sdk
- Required output: repo_boundary_map
- Timeout: 600000 ms

## Artifact References
- phase-1/result.json
- phase-1/result.md
- phase-1/artifacts/product-comparison.csv

## User Notes
Please focus on whether current worker routing should become a compatibility layer.
```

This template intentionally separates:

- system-generated factual handoff
- runtime constraints
- user-provided correction notes

That separation is important for debugging and provenance.

### 16.4 Minimal `context.json` schema

The first executable version of `context.json` should stay small and stable.

Suggested minimum fields:

```json
{
  "run_id": "uuid",
  "phase_id": "phase-2",
  "phase_title": "整理对比维度",
  "proposal_version": 3,
  "snapshot_version": 2,
  "worker_ref": "user_worker_profile:analysis-agent",
  "worker_instance_id": "uuid",
  "goal": "根据前序结果整理对比矩阵",
  "constraints": {
    "allowed_tools": ["search_sdk"],
    "approval_required": false,
    "timeout_ms": 600000
  },
  "inputs": {
    "artifact_refs": [
      "phase-1/result.json",
      "phase-1/artifacts/competitors.csv"
    ],
    "upstream_phase_ids": ["phase-1"]
  },
  "expected_output": {
    "result_kind": "json_structured",
    "result_schema_hint": "comparison_matrix.v1"
  }
}
```

This is enough for:

- adapter execution
- auditability
- deterministic resume
- worker debugging

### 16.5 Minimal `result.json` schema

The first executable version of `result.json` should also stay narrow.

Suggested minimum fields:

```json
{
  "run_id": "uuid",
  "phase_id": "phase-2",
  "worker_ref": "user_worker_profile:analysis-agent",
  "status": "succeeded",
  "summary": "完成了 3 个竞品的对比矩阵整理",
  "outputs": {
    "primary_artifact_ref": "phase-2/artifacts/comparison-matrix.json",
    "named_outputs": {
      "comparison_matrix": "phase-2/artifacts/comparison-matrix.json"
    }
  },
  "followup_hints": {
    "recommended_next_action": "continue",
    "invalidates_future_phases": []
  }
}
```

This should not try to encode every possible raw result.

Raw files, images, or large payloads should remain in `artifacts/` and be referenced, not embedded.

## 17. Event Vocabulary

Recommended initial events:

- `run.created`
- `run.plan_proposed`
- `run.plan_edited`
- `run.plan_compiled`
- `run.started`
- `run.paused`
- `run.resumed`
- `run.awaiting_plan_edit`
- `run.plan_revalidated`
- `run.completed`
- `run.failed`
- `step.ready`
- `step.started`
- `step.worker.bound`
- `step.artifact.produced`
- `step.waiting_approval`
- `step.obsolete`
- `step.invalidated`
- `step.suffix_replan_requested`
- `step.succeeded`
- `step.failed`
- `step.rerun.queued`

Keep the vocabulary narrow until the runtime stabilizes.

### 17.1 Recommended event payload examples

The following examples are intentionally small.

They are meant to make event wiring, debugging, and UI rendering concrete without locking the system into a bloated event protocol too early.

#### `run.plan_compiled`

```json
{
  "event": "run.plan_compiled",
  "run_id": "uuid",
  "proposal_version": 3,
  "snapshot_version": 2,
  "compiled_at": "2026-03-23T12:00:00Z",
  "phase_count": 4
}
```

Use this event when:

- the current editable proposal has been successfully compiled
- a new execution snapshot becomes the active runtime truth

#### `step.worker.bound`

```json
{
  "event": "step.worker.bound",
  "run_id": "uuid",
  "phase_id": "phase-2",
  "worker_ref": "system_worker_template:repo-architect",
  "worker_instance_id": "uuid",
  "binding_reason": "explicit_worker_ref"
}
```

Use this event when:

- a worker template has been resolved for a phase
- a concrete worker instance has been created
- the scheduler is about to hand over the context packet

#### `step.artifact.produced`

```json
{
  "event": "step.artifact.produced",
  "run_id": "uuid",
  "phase_id": "phase-2",
  "artifact_ref": "phase-2/result.json",
  "artifact_kind": "json_structured",
  "producer_worker_ref": "system_worker_template:repo-architect"
}
```

Use this event when:

- a phase has emitted a result packet or other material output
- downstream phases may need to consume the artifact

#### `run.plan_revalidated`

```json
{
  "event": "run.plan_revalidated",
  "run_id": "uuid",
  "snapshot_version": 2,
  "checked_after_phase": "phase-2",
  "outcome": "pause_for_edit"
}
```

Use this event when:

- the scheduler has completed a remaining-plan check
- the runtime has chosen a next control action

#### `step.suffix_replan_requested`

```json
{
  "event": "step.suffix_replan_requested",
  "run_id": "uuid",
  "phase_id": "phase-3",
  "trigger_phase_id": "phase-2",
  "reason": "upstream_artifact_invalidated_assumption",
  "affected_future_phases": ["phase-3", "phase-4"]
}
```

Use this event when:

- the current suffix is no longer trustworthy
- the runtime is asking for an automatic or user-mediated suffix replan

## 18. Execution Patterns

### 18.1 Direct

Use current direct local chat path when:

- request is simple
- no durable workflow state is needed

### 18.2 Single Worker Delegation

Use current delegated worker path when:

- one worker profile clearly fits
- there is no need for workflow visibility or rerun

Architectural note:

- this is a compatibility path
- it should not remain a permanently separate orchestration model once workflow runtime is stable
- the long-term target is to represent this as a one-step workflow run when durability or inspection is desired

### 18.3 Workflow

Use workflow runtime when:

- more than one bounded execution step is needed
- approval is likely
- rerun or step inspection matters
- the user benefits from explicit run visibility

Long-term note:

- once workflow runtime is stable, this should absorb most of the current worker-route use cases
- the difference between "single worker" and "workflow" should become a runtime sizing choice, not a separate mental model

Default workflow sequence:

1. generate proposal once
2. let user edit proposal directly
3. compile proposal into execution snapshot
4. build the first phase context packet
5. resolve a worker template and instantiate a worker instance
6. execute current frontier
7. persist result packet and artifacts
8. revalidate remaining phases after each completed phase
9. continue, pause for edit, or suffix replan as needed

## 19. Frontend Direction

Desktop workflow UI should reuse old spec-oriented product patterns where useful:

- run list
- step status rail
- step detail drawer
- rerun affordance
- approval affordance

But MVP should not start with a full graph editor or a restored old spec page.

The core MVP UI should be a `Plan Editor`, not just a status viewer.

Recommended MVP surfaces:

1. `Plan Editor`
   - user edits the coarse-grained proposal directly
2. `Execution Status`
   - current phase status and run lifecycle
3. `Phase Result Panel`
   - result artifacts and trace summary for completed phases
4. `Editing Checkpoint UI`
   - confirm continue, edit remaining phases, or request regeneration
5. `Phase Context Viewer`
   - inspect `context.md` and user notes before phase execution
6. `Chat Bridge`
   - convert a chat suggestion into a workflow proposal

Graph canvas can come later.

MVP rendering note:

- structured markdown template is acceptable for the first editable surface
- native editor UI can replace it later
- execution should still run on compiled snapshots, not raw markdown text
- phase context should be inspectable even if editing remains partially constrained

## 20. Migration Strategy

### Phase 0: naming and truth

- keep runtime behavior unchanged
- define `custom_task_agent` as `WorkerProfile` in docs
- explicitly state that desktop worker delegation is not yet a workflow runtime
- mark cloud/hybrid execution as out of scope

### Phase 1: persistence foundation

- add local SQLite tables for workflow run/step/event/checkpoint/artifact
- add Rust domain models for persisted workflow state
- do not change routing behavior yet

### Phase 2: proposal generation and editing

- add one-shot coarse plan proposal generation
- add editable proposal surface
- add proposal compile/validate path into execution snapshots
- keep regeneration as an explicit fallback action

### Phase 3: context packet and worker model

- add primary-assistant-owned worker template resolution
- add system worker template registry
- formalize user worker profiles as user-owned worker templates
- add phase context packet generation (`context.md` + `context.json`)
- add phase result packet generation (`result.md` + `result.json`)

### Phase 4: workflow runtime slice

- execute compiled snapshots instead of raw proposal text
- add sequential scheduler
- add revalidation after each completed phase
- add worker-profile adapter backed by current `custom_task_agent`
- keep current single-worker route unchanged as a compatibility path

### Phase 5: approval and rerun

- persist approval checkpoints
- support approve/reject/modify
- support rerun from a selected step
- support editing remaining phases before resume

### Phase 6: route convergence

- allow workflow runtime to execute one-step `worker_call -> finalize` runs
- add a compatibility shim from current worker-route entrypoints into workflow runtime where appropriate
- keep direct answer separate

### Phase 7: desktop workflow UI

- add plan editor
- add execution status
- add phase result panel
- add editing checkpoint UI
- add phase context viewer
- add chat-to-workflow entry

### Phase 8: controlled expansion

- add `logic_gate`
- add explicit artifact contracts
- evaluate `mcp_tool` and `skill_action` direct adapters

Deferred beyond this document:

- code mode as a workflow adapter
- parallel scheduler
- loop/replan runtime

## 21. Verification Requirements

Every phase should end with desktop-local proof, not just code completion.

### 21.1 Storage proof

- local workflow rows can be created
- app restart preserves run state
- checkpoint rows survive restart

### 21.2 Runtime proof

- workflow run can execute a `worker_call`
- approval pauses execution
- approval resume continues correctly
- rerun creates a new step attempt

### 21.3 UI proof

- run list reflects persisted runs
- step detail reflects persisted step state
- approval UI reflects persisted checkpoint state

### 21.4 Suggested verification commands

At minimum for each implementation slice:

- targeted `cargo check` in `deeting/src-tauri`
- targeted Rust tests for new workflow modules
- targeted frontend build or typecheck for any desktop UI surface changes

## 22. Main Risks

### 22.1 Two local orchestrators

Risk:

- new workflow runtime duplicates existing desktop route/execution logic instead of extending it

Mitigation:

- keep `desktop_runtime` as execution truth
- add workflow persistence and scheduler around it, not beside it

### 22.2 Fake worker abstraction

Risk:

- runtime pretends `custom_task_agent` is a simple tool when it is really a bounded mini-worker

Mitigation:

- make `worker_profile` an explicit adapter kind
- preserve its internal multi-round behavior

### 22.3 In-memory approval only

Risk:

- approval looks resumable but still depends on process memory

Mitigation:

- make checkpoint rows first-class before shipping workflow UI

### 22.4 Premature graph complexity

Risk:

- advanced graph features delay durable MVP

Mitigation:

- keep MVP to three step types
- defer loops, replan, parallelism

## 23. Recommended MVP

If desktop Deeting ships one serious workflow increment, it should be:

1. local `workflow_run` and `workflow_step_run`
2. local `workflow_event` and `workflow_checkpoint`
3. one-shot AI-generated coarse plan proposal
4. user-editable proposal surface
5. compile/validate into execution snapshots before execution
6. controlled worker template model:
   - primary assistant
   - user worker profiles
   - system worker templates
   - ephemeral worker instances
7. per-phase context packet generation:
   - `context.md`
   - `context.json`
   - `result.md`
   - `result.json`
8. sequential workflow runtime inside desktop runtime
9. per-phase revalidation of the remaining plan
10. `worker_profile` adapter backed by current `custom_task_agent`
11. `worker_call`, `approval_gate`, `finalize`
12. one-step worker runs supported inside workflow runtime
13. plan editor, phase context viewer, execution status, phase result, approval/edit checkpoint UI

That is already materially better than the current delegated-preview path.

## 24. What This Document Explicitly Rejects

This document does not recommend:

- reviving backend `SpecExecutor` as the desktop workflow kernel
- inventing a shared worker identity model now
- promising hybrid execution before desktop runtime is durable
- forcing code mode into the first adapter set
- treating `replan_trigger` as if it were already a real runtime primitive

## 25. Source Anchors In Current Repo

Desktop runtime line:

- `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/code_mode_orchestration.rs`

Worker profile line:

- `deeting/src-tauri/src/modules/custom_task_agents/store.rs`
- `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- `deeting/src-tauri/src/modules/custom_task_agents/skill_actions.rs`

Reusable old spec ideas:

- `deeting_core/app/models/spec_agent.py`
- `deeting_core/app/repositories/spec_agent_repository.py`
- `deeting_core/app/api/v1/spec_agent_route.py`
- `deeting/store/spec-agent-store.ts`
- `deeting/lib/swr/use-spec-agent.ts`
- `deeting/lib/api/spec-agent.ts`

## 26. Final Recommendation

For the current phase, Deeting should standardize on:

- chat as the interaction surface
- desktop workflow runtime as the orchestration surface
- worker profiles as the execution surface

In short:

- extend the current desktop runtime
- keep `custom_task_agent` as the first `WorkerProfile`
- use AI to generate an initial coarse proposal, not a perfect hidden master plan
- let users edit the proposal directly before and between execution phases
- compile edited proposals into execution snapshots before running
- keep the primary assistant as the sole orchestration entry
- resolve execution through a controlled worker template pool
- instantiate ephemeral worker instances per phase instead of inventing persistent agents on the fly
- hand off phase context through inspectable context packets instead of hidden storage assembly
- revalidate the remaining plan after each completed phase
- treat current standalone worker routing as a compatibility layer, not the final architecture
- borrow old `spec agent` data/UI ideas without inheriting its execution kernel
- ship a desktop-only durable workflow MVP before discussing cloud or hybrid execution

That is the most truthful path from the current codebase to a real workflow runtime.
