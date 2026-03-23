# Deeting Workflow Runtime V2

Updated: 2026-03-23
Status: proposed architecture

## 1. Problem

Deeting currently has two partially overlapping lines of capability:

1. `spec agent`
   - Good at plan-as-state, DAG execution, approval, rerun, node inspection, and execution logs.
   - Weak at true parallelism, replan, and modern desktop-local runtime integration.
2. `custom_task_agent`
   - Good at local worker execution, model binding, MCP tool binding, guidance skills, and desktop routing integration.
   - Weak at workflow-level state, checkpoints, artifacts, scheduling, resumability, and structured multi-step orchestration.

The production gap is not "more subagents". The gap is the lack of a durable workflow runtime between routing and leaf-worker execution.

## 2. Core Decision

Deeting should treat:

- `custom_task_agent` as a `WorkerProfile` / leaf execution resource
- old `spec agent` ideas as the basis of a `Workflow Runtime`

The target system is not "spec agent versus subagent".

The target system is:

- `Workflow Runtime` = planning, scheduling, approval, retry, rerun, audit, artifact, and trace
- `WorkerProfile` = one bounded way to execute a leaf task

## 3. Product Goal

Enable Deeting to handle three kinds of execution with one coherent runtime:

1. Direct answer
   - Normal chat completion with tool use when orchestration is unnecessary.
2. Single delegated worker
   - Route a bounded task to one worker profile and synthesize the result.
3. Workflow run
   - Build or load a multi-step plan, execute it with approval and resumability, and render it as a first-class runtime object.

## 4. Non-Goals

V2 should not start with:

- fully autonomous swarm chat among many peers
- unrestricted group-chat orchestration
- remote agent federation as a hard dependency
- arbitrary user-defined code execution without stronger sandboxing

Those can come later. The first production step is a truthful workflow runtime.

## 5. Current State Summary

### 5.1 What is already valuable in old `spec agent`

- DAG manifest with `action`, `logic_gate`, and `replan_trigger`
- `SpecPlan` / `SpecExecutionLog` / `SpecWorkerSession`
- SSE drafting flow
- node status, node detail, node rerun, node patch, approval interaction
- persisted conversation linkage and event audit
- `model_override` and `pending_instruction`

This line already proves Deeting wanted plan-as-state, not just more prompts.

### 5.2 What is already valuable in current `custom_task_agent`

- desktop-local agent profile storage
- bound MCP tools
- bound guidance skills
- bound skill actions
- desktop runtime integration
- route override into worker execution
- local model selection and preview execution

This line already proves Deeting has a usable leaf-worker abstraction.

### 5.3 Main weakness today

Current worker delegation effectively does:

`select custom task agent -> run preview -> inject delegated result back into main chat`

That is useful, but it is still a worker call, not a workflow engine.

## 6. Target Architecture

```text
User Request
  -> Intent Router
  -> Execution Decision
     -> Direct Answer
     -> Single Worker Delegation
     -> Workflow Runtime

Workflow Runtime
  -> Planner
  -> Scheduler
  -> Approval / Policy Engine
  -> Worker Adapter Layer
  -> Artifact Store
  -> Checkpoint Store
  -> Trace / Eval Store

Worker Adapter Layer
  -> custom_task_agent / WorkerProfile
  -> MCP tool adapter
  -> skill action adapter
  -> direct LLM worker
  -> code-mode worker
```

## 7. Layer Responsibilities

### 7.1 Router / Control Plane

Responsibilities:

- classify request as direct, delegated-worker, or workflow
- decide whether planning is necessary
- attach runtime policy and safety gates
- emit user-visible route reasoning

This stays close to current `desktop_runtime/control_plane`, but becomes policy-first instead of heuristic-only.

### 7.2 Planner

Responsibilities:

- convert user intent into a workflow template or workflow run plan
- choose execution pattern: sequential, parallel, approval, finalize
- bind each step to a worker reference

The planner is a manager, not a doer.

### 7.3 Scheduler

Responsibilities:

- compute ready steps from dependency state
- run steps concurrently when safe
- persist step transitions
- stop on approval gates, policy failures, or terminal errors

This is the runtime heart that old `spec agent` began but never fully generalized.

### 7.4 Worker Adapter Layer

Responsibilities:

- normalize all leaf executors to one contract
- hide whether the executor is a custom task agent, MCP tool, skill action, direct model, or code-mode worker

Proposed adapter interface:

```ts
interface WorkerAdapter {
  kind: "worker_profile" | "mcp_tool" | "skill_action" | "llm_worker" | "code_mode"
  canHandle(step: WorkflowStep): boolean
  execute(input: WorkerExecutionInput): Promise<WorkerExecutionResult>
}
```

### 7.5 Approval / Policy Engine

Responsibilities:

- handle `check_in`, risky actions, budget overflow, branch switch, and destructive operations
- persist checkpoint state explicitly
- allow approve, reject, and modify

This should not live as ad hoc behavior inside one node type.

### 7.6 Artifact Store

Responsibilities:

- persist structured outputs, files, images, tables, links, summaries
- give downstream steps references instead of forcing giant prompt replay
- support UI rendering and replay

This is where the current architecture is still thin outside image outputs.

### 7.7 Trace / Eval Store

Responsibilities:

- capture step events, tool calls, worker traces, approvals, retries, and final outcomes
- support debugging, replay, audit, and later eval

## 8. New Conceptual Model

### 8.1 WorkerProfile

Rename the mental model of `custom_task_agent`:

- not a workflow
- not a manager
- not a swarm member with global agency

It is a `WorkerProfile`: a bounded local execution profile with:

- prompt
- model binding
- callable MCP tools
- guidance skills
- callable skill actions
- discoverability metadata

### 8.2 WorkflowTemplate

A reusable plan definition containing:

- graph topology
- step types
- worker references
- approval policy
- branch policy
- runtime defaults

This is the spiritual successor to the old spec manifest.

### 8.3 WorkflowRun

A concrete execution instance containing:

- request input
- resolved graph
- context snapshot
- status
- checkpoint pointer
- artifact references

### 8.4 StepRun

A concrete step execution containing:

- status
- input snapshot
- output artifact refs
- worker trace
- retries
- error
- started/completed timestamps

## 9. Proposed Data Model

The old spec tables should be evolved, not thrown away blindly.

### 9.1 Recommended tables

- `worker_profile`
  - derived from current `custom_task_agent_profiles`
- `workflow_template`
  - reusable declarative graph definition
- `workflow_run`
  - instance of a template or ad hoc planned run
- `workflow_step_run`
  - one row per step attempt
- `workflow_worker_session`
  - worker internal messages and summarized trace
- `workflow_artifact`
  - structured outputs and asset refs
- `workflow_checkpoint`
  - waiting approval / waiting input / paused branch switch
- `workflow_event`
  - append-only event stream for UI and audit

### 9.2 Mapping from existing structures

- `custom_task_agent_profiles` -> `worker_profile`
- `SpecPlan` -> `workflow_run`
- `SpecExecutionLog` -> `workflow_step_run`
- `SpecWorkerSession` -> `workflow_worker_session`

## 10. Recommended Step Types

V2 should begin with a small honest set:

- `worker_call`
- `logic_gate`
- `approval_gate`
- `parallel_group`
- `finalize`

Optional later:

- `replan`
- `loop`
- `handoff`
- `external_agent_call`

### 10.1 Why not keep `replan_trigger` as-is

Old `replan_trigger` exists in schema, but execution never implemented it.

In V2, replan should be a runtime capability:

- step fails
- branch set is exhausted
- policy says plan is stale
- scheduler invokes planner again with current artifacts and context

That is more truthful than a dead-end placeholder node.

## 11. Runtime Structure Recommendation

Deeting should not use one single structure for everything.

The recommended runtime truth is a hybrid model:

1. Graph
   - for business topology and control flow
2. Lifecycle FSM
   - for run status and stage transitions
3. Event Log
   - for durability, replay, audit, and debugging

### 11.1 Why not use graph alone

A graph is good at expressing:

- dependency
- branching
- loop-back
- fan-out / fan-in

But a graph is not the cleanest structure for:

- run lifecycle
- pause / resume reasons
- approval waiting state
- retry budget exhaustion
- audit and replay

If Deeting puts all of that into graph nodes and edges, the runtime becomes hard to reason about.

### 11.2 Why not use FSM alone

A state machine is good at expressing:

- drafting
- running
- waiting approval
- verifying
- failed
- completed

But FSM alone is weak at representing:

- parallel dependencies
- conditional branching
- subgraph fan-out
- reusable step topology

So FSM should manage lifecycle, not replace the workflow graph.

### 11.3 Why event log must exist separately

An append-only event stream is the durable debugging truth for:

- what happened
- in what order
- which worker ran
- which tool was called
- what approval interrupted execution
- why a retry or failover happened

Without this, Deeting will have poor replay, poor observability, and weak recovery semantics.

### 11.4 Recommended separation of concerns

Use these three structures together:

- `WorkflowTemplateGraph`
  - nodes and edges for business logic
- `WorkflowRunFSM`
  - lifecycle state for a concrete run
- `WorkflowEventLog`
  - append-only history for every meaningful transition

This keeps topology, lifecycle, and audit from being over-merged.

## 12. Graph Model Recommendation

The workflow graph should default to DAG semantics, but support controlled cycles.

### 12.1 Recommended node model

Each node should have:

- `id`
- `type`
- `worker_ref` or runtime-specific payload
- `needs`
- `output_as`
- `policy`
- `artifact_contract`

### 12.2 Recommended edge model

Each edge should have an explicit kind:

- `normal`
- `conditional`
- `approval_resume`
- `retry`
- `loop_back`
- `failover`

This is more expressive than relying on plain `needs` only.

### 12.3 Why not allow arbitrary cycles

LangGraph-style cyclic control flow is useful, but arbitrary cycles are dangerous:

- they hide termination bugs
- they complicate replay
- they increase prompt amplification risk
- they make cost control harder
- they create unclear side-effect semantics

So Deeting should support loops only under explicit policy.

## 13. Loop Policy

Deeting should support loops, but only as a controlled runtime primitive.

### 13.1 Allowed loop shape

Loops should be expressed by explicit `loop_back` edges or loop nodes.

They should never emerge implicitly from arbitrary graph authoring.

### 13.2 Required loop guardrails

Every loop must define:

- `max_iterations`
- `exit_condition`
- `on_exhausted`
- `checkpoint_on_iteration`

Recommended `on_exhausted` options:

- `fail`
- `approval_gate`
- `replan`
- `fallback_edge`

### 13.3 Loop semantics

Each loop iteration should:

- create a new `step_run` attempt
- append iteration events
- persist artifacts separately
- checkpoint before re-entry if the loop has any non-trivial side effects

### 13.4 Side-effect policy

If a looped step can mutate external state, it must be:

- idempotent
- approval-gated
- or wrapped in compensating policy

Otherwise loops will be unsafe in production.

## 14. Lifecycle FSM Recommendation

The run lifecycle should be modeled as a separate finite state machine.

Suggested run states:

- `drafting`
- `ready`
- `running`
- `waiting_approval`
- `waiting_input`
- `verifying`
- `repairing`
- `completed`
- `failed`
- `cancelled`

Suggested step states:

- `pending`
- `ready`
- `running`
- `waiting_approval`
- `succeeded`
- `failed`
- `skipped`
- `cancelled`

### 14.1 Why this matters

The graph answers:

- what can run next

The FSM answers:

- what stage is this run in right now

Those are different questions and should stay separate.

## 15. Compile-Time Validation

Before a workflow template can execute, Deeting should compile and validate it.

### 15.1 Required validations

- unique node IDs
- all referenced nodes exist
- all referenced worker refs are syntactically valid
- all edges connect valid nodes
- all approval nodes have resumable exits
- all loop structures have explicit loop policy
- all finalize nodes are reachable
- all fail terminals are reachable only by explicit transitions

### 15.2 Graph-specific validations

- detect strongly connected components
- reject cycles that are not marked as allowed loop regions
- reject disconnected orphan nodes unless explicitly allowed
- validate fan-in dependencies resolve to compatible artifact contracts

### 15.3 Runtime contract validations

- verify `worker_ref` kind is supported by the current runtime
- verify required models or tools are available
- verify artifact input/output contracts can be satisfied
- verify risky steps have policy coverage

## 16. Event Log And Checkpoint Recommendation

Deeting should treat events and checkpoints as first-class runtime data.

### 16.1 Recommended event categories

- `run.created`
- `run.started`
- `run.paused`
- `run.resumed`
- `run.completed`
- `run.failed`
- `step.ready`
- `step.started`
- `step.worker.bound`
- `step.tool.called`
- `step.tool.returned`
- `step.artifact.produced`
- `step.waiting_approval`
- `step.retried`
- `step.succeeded`
- `step.failed`
- `loop.iteration.started`
- `loop.iteration.exhausted`

### 16.2 Recommended checkpoint triggers

- before approval wait
- before loop re-entry
- before failover branch switch
- before external side effects
- after planner patch-plan / replan

### 16.3 Why checkpoint separately from event log

Event log is replay truth.

Checkpoint is fast resume truth.

Deeting should keep both.

## 17. Recommended Data Structures For Deeting

If we translate all of this into a practical Deeting runtime model, the recommended structure is:

- Graph for task topology
- FSM for lifecycle
- Event log for durability
- Artifact store for structured outputs
- Checkpoint store for recovery

This means Deeting should not become a pure LangGraph clone.

Instead, it should borrow:

- graph-based execution semantics
- checkpoint/resume thinking
- conditional edge and loop concepts

while keeping its own clearer product/runtime boundaries.

## 18. Execution Patterns

### 18.1 Direct

Use current direct local chat path when:

- user intent is simple
- no multi-step graph is needed
- no durable checkpoint is needed

### 18.2 Single Worker Delegation

Use current delegation shape when:

- one worker profile clearly fits
- there is no need for persistent workflow UI

This should still be supported as the lightest-weight path.

### 18.3 Workflow

Use workflow runtime when:

- more than one bounded execution step is needed
- approval or rerun is likely
- branch switching matters
- user benefits from plan visibility

## 19. Planning Contract

Planner output should evolve from old `SpecManifest`, but simplify terminology.

Suggested shape:

```json
{
  "workflow_v": "2.0",
  "title": "Laptop Purchase Strategy",
  "steps": [
    {
      "id": "S1",
      "type": "worker_call",
      "worker_ref": "worker_profile:image-research",
      "instruction": "Search candidate models under budget",
      "needs": [],
      "output_as": "candidates"
    },
    {
      "id": "S2",
      "type": "approval_gate",
      "needs": ["S1"],
      "reason": "Choose preferred direction",
      "input": "{{candidates}}"
    }
  ]
}
```

Important rules:

- every step binds to an explicit runtime owner
- step outputs become artifacts and named context variables
- approval is explicit
- branch decisions are explicit
- planner never directly executes work

## 20. Worker Reference Scheme

All workflow leaf steps should use one unified `worker_ref` namespace:

- `worker_profile:{id}`
- `mcp_tool:{tool_name}`
- `skill_action:{skill_id}#{action_id}`
- `llm_worker:{profile_slug}`
- `code_mode:{preset}`

This gives the planner and scheduler a stable binding contract.

## 21. API Direction

The old spec APIs are still a good base shape.

Recommended V2 API family:

- `POST /api/v1/workflows/draft`
- `GET /api/v1/workflows`
- `GET /api/v1/workflows/{run_id}`
- `GET /api/v1/workflows/{run_id}/status`
- `GET /api/v1/workflows/{run_id}/steps/{step_id}`
- `POST /api/v1/workflows/{run_id}/start`
- `POST /api/v1/workflows/{run_id}/interact`
- `PATCH /api/v1/workflows/{run_id}/steps/{step_id}`
- `POST /api/v1/workflows/{run_id}/steps/{step_id}/rerun`
- `POST /api/v1/workflows/{run_id}/steps/{step_id}/events`

The existing `/spec-agent/*` family can be:

- kept as compatibility routes
- or soft-deprecated after the frontend moves

## 22. Desktop / Backend Boundary

This should be explicit.

### 15.1 Backend owns

- workflow draft generation
- workflow persistence
- workflow scheduling for cloud-backed runs
- approval state
- audit / history / admin visibility
- knowledge feedback integration

### 15.2 Desktop owns

- local worker profiles
- local MCP / skill action / local model execution
- local artifact persistence when necessary
- desktop-local workflow preview and fast local runs

### 15.3 Shared contract

Both sides should speak the same workflow schema and worker reference model.

That lets Deeting choose:

- backend execution
- desktop-local execution
- hybrid execution

without changing the product concept.

## 23. Frontend Direction

The old spec frontend state is still useful.

Useful reusable pieces:

- drafting state
- plan init / node added / link added SSE handling
- graph layout
- node status updates
- node detail drawer
- node model override
- pending instruction and rerun flow

Recommended UI surfaces:

1. `Workflow Panel`
   - canvas + console + status rail
2. `Step Detail Drawer`
   - trace, artifacts, worker profile, patch, rerun
3. `Approval Sheet`
   - approve / reject / modify with branch preview
4. `Chat Bridge`
   - upgrade a chat suggestion into a workflow run

## 24. Migration Strategy

### Phase 0: naming and truth

- keep current code behavior unchanged
- redefine `custom_task_agent` as `WorkerProfile` in architecture docs and code comments
- document that current worker delegation is not yet a workflow runtime

### Phase 1: runtime extraction

- extract old spec runtime concepts into neutral `workflow_*` models and APIs
- keep old `/spec-agent/*` aliases temporarily
- keep old planner manifest compatibility

### Phase 2: worker unification

- add `worker_ref = worker_profile:{id}` support
- route old spec action execution through worker adapters
- first adapter is `custom_task_agent`

### Phase 3: UI restoration

- restore the workflow page using existing spec store / hooks concepts
- attach workflow suggestion entrypoints from chat
- support node detail, approval, rerun, patch

### Phase 4: true scheduler improvements

- parallel ready-step execution
- explicit checkpoint rows
- artifact refs instead of giant textual replay
- retries and failure policies

### Phase 5: replan and advanced patterns

- planner patch-plan
- replan on branch exhaustion or hard failure
- handoff and remote-agent adapters if needed

## 25. Why this is better than adding more ad hoc subagents

Because production problems are mostly:

- lost state
- poor resumability
- weak observability
- unclear ownership
- no explicit approval lifecycle
- fragile prompt replay

Adding more subagents does not solve those.

Workflow runtime does.

## 26. Main Risks

### 26.1 Two orchestration stacks

Risk:
- backend workflow runtime and desktop worker runtime drift apart

Mitigation:
- one shared workflow schema
- one shared worker reference contract
- one event vocabulary

### 26.2 Hidden execution paths

Risk:
- a workflow step silently bypasses policy and calls tools directly

Mitigation:
- force leaf execution through worker adapters
- record adapter kind on every step run

### 26.3 Prompt bloat

Risk:
- downstream steps receive giant text blobs instead of structured outputs

Mitigation:
- artifact refs first
- typed output snapshots
- bounded textual summaries for model replay

### 26.4 Unsafe local execution

Risk:
- skill actions and local workers remain too permissive

Mitigation:
- explicit scopes
- timeouts, limits, approval policy
- stronger sandbox design before broadening execution power

## 27. Recommended MVP

If Deeting ships only one serious increment, it should be:

1. `workflow_run` and `workflow_step_run` models
2. `workflow draft/start/status/interact/rerun/patch` APIs
3. `worker_profile` adapter backed by current `custom_task_agent`
4. restored workflow UI with approval and rerun
5. chat-to-workflow suggestion bridge

That is already materially more production-grade than the current "delegated worker preview" path.

## 28. Source Anchors In Current Repo

Old workflow/runtime line:

- `deeting_core/app/services/agent/spec_agent_service.py`
- `deeting_core/app/models/spec_agent.py`
- `deeting_core/app/repositories/spec_agent_repository.py`
- `deeting_core/app/api/v1/spec_agent_route.py`
- `deeting_core/app/schemas/spec_agent.py`
- `docs/spec-agent-plan.md`
- `docs/api/spec-agent.md`

Current worker-profile line:

- `deeting/src-tauri/src/modules/custom_task_agents/store.rs`
- `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- `deeting/src-tauri/src/modules/custom_task_agents/skill_actions.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- `deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs`

Frontend reusable workflow state line:

- `deeting/store/spec-agent-store.ts`
- `deeting/lib/swr/use-spec-agent.ts`
- `deeting/lib/api/spec-agent.ts`

## 29. Final Recommendation

Deeting should standardize on:

- chat as the interaction surface
- workflow runtime as the orchestration surface
- worker profiles as the execution surface

In short:

- revive the old `spec agent` idea as a generalized workflow runtime
- demote current `custom_task_agent` from "mini-agent system" to "leaf worker profile"
- let routing decide when to stay direct, when to delegate to one worker, and when to launch a workflow

That gives Deeting a production-oriented architecture without throwing away the strongest ideas already present in the codebase.
