# Deeting Self-Evolution Architecture (Sovereign Self-Adjustment)

> Scope: the "self-evolution / self-adjustment" subsystem for desktop local chat.
> Out of scope: RAG / context orchestration (see [rag-architecture.en.md](./rag-architecture.en.md)).

This document is the authoritative spec for the desktop "self-evolution" subsystem. The goal mirrors [`rag-architecture.en.md`](./rag-architecture.en.md): anyone reviewing later, taking over maintenance, or learning agent design should be able to read this single file and understand:

- The design motivation (why Deeting "adjusts itself")
- The system topology (who observes, who judges, who updates priors)
- The system boundary (what is allowed, what is forbidden)
- Where to add things, where to change things

## 1. TL;DR

Deeting desktop is **not** an agent with fixed behavior. It adjusts **its own routing / retrieval / execution / verification dispositions** based on the outcome of every task.

Its self-evolution follows a deliberately restrained loop:

1. Before a task starts, the runtime compresses "what kind of task is this" into a **TaskFingerprint** — 8 semantic dimensions.
2. For each **decision point** (route / worker_selection / discovery / capability_attach / execution / verification), the system pulls historical weights (priors) for this fingerprint from a **prior store**.
3. After the task actually finishes, the runtime evaluates "how well did this run go" using a **heuristic judge**, combines it with the **user posterior signal** (accepted / corrected / rejected), and produces a `PolicyDelta`.
4. The delta is **weight-merged** back into the prior store. Old deltas **half-decay** over time (21-day half-life).
5. The next time a similarly fingerprinted task arrives, the prior influences route bias — but it **can never break a safety lock** (destructive / approval_sensitive / explicit user route).

This structure is called the **Sovereign Architecture**. It lives under [`deeting/src-tauri/src/modules/desktop_runtime/runtime/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/) in `task_learning/`, `posterior_signal/`, and `sovereign/`.

> Naming note: similar industry work (e.g. EvoMap's GEP/GDI methodology) has its own vocabulary. Deeting **borrows the ideas, not the words** — you will not find `gene` / `fitness` / `phenotype` / `evolver` in the core code. The reason is in §6.

## 2. Why we did it this way

A naive "self-evolving agent" easily devolves into one of two failure modes:

1. **Black-box evolution.** The model keeps "evolving" against a hidden fitness function, and engineers cannot explain, roll back, or discuss any specific weight change in a PR review.
2. **Single-signal dictatorship.** Either "user thumbs-down" vetoes everything, or "model self-evaluation" approves everything. Whenever a single mechanism has final authority, edge cases will silently destroy the experience.

Deeting's design choices:

| Naive self-evolution pitfall | Deeting's approach |
|---|---|
| One global fitness decides everything | **Multiple decision points + multiple signals**: 6 independent decision points, 4 categories of signal sources, heuristic judge and user posterior signal checking each other |
| Learned priors permanently override user intent | Safety locks (`decision_has_safety_lock`) veto; explicit user instructions always win |
| Old priors live forever | 21-day half-life (`PRIOR_HALF_LIFE_MS`); without updates they fade away |
| Adding an external signal source rewrites the core | **Sovereign Charter**: external sources can only enter through the `Ingress` boundary; the core only sees `Observation` |
| LLM self-evaluation creates a hallucination feedback loop | Task evaluation is **heuristic-only** — no second model call during evaluation, no "model judging model" hidden loop |
| Bandits get more aggressive over time | `ROUTE_BANDIT_COEFF = 0.25` — bandits are only tie-breakers, they cannot flip a decision alone |

In one sentence: **Deeting is the subject; all signals are observation.**

## 3. Architecture overview

```text
┌────────────────────────────────────────────────────────────────┐
│ One local turn (chat_tool_runtime/mod.rs)                       │
│                                                                │
│  ① receive user query                                          │
│  ② build_task_fingerprint(query) → TaskFingerprint             │
│  ③ Self_::consult(locus, query)                                │
│        └→ task_learning::query_task_policy_hint                │
│              ├─ pull priors for this fingerprint from McpStore  │
│              ├─ decay_weight by 21-day half-life                │
│              └─ emit TaskPolicyHint                             │
│  ④ apply_route_prior(base_decision, hint, bandit_scores)       │
│        ├─ add prior weight                                      │
│        ├─ add bandit tie-breaker (coeff 0.25)                   │
│        └─ if safety lock present → no flip allowed              │
│  ⑤ execute (direct / worker / delegated / execute_code_plan / …)│
│        └─ collect tool_trace_blocks, error_codes, latency, etc.│
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ After task completion: evaluate_task_learning_with_runtime    │
│                                                                │
│  ① collect_task_learning_signals(trace) → TaskLearningSignals  │
│  ② heuristic derivation                                        │
│       final_status / verification_result / route_judgment /    │
│       discovery_judgment / execution_judgment / cost_class /   │
│       error_profile / confidence …                             │
│  ③ resolve_posterior_signal(user_text / score / explicit)      │
│       └─ accepted / corrected / rejected / unknown              │
│  ④ primary_stage_from_outcome → which decision point learns    │
│  ⑤ compute_policy_delta → direction & magnitude                 │
│  ⑥ apply_policy_delta → write to task_policy_priors (McpStore) │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Next same-fingerprint task → back to top, priors updated
```

### Module tree

```
deeting/src-tauri/src/modules/desktop_runtime/runtime/
├── AGENTS.md                  // Sovereign Charter (architectural discipline)
├── task_learning/
│   ├── mod.rs                 // re-exports
│   ├── types.rs               // TaskFingerprint / EvaluatedOutcome / PolicyDelta / 6 DECISION_POINTs
│   ├── fingerprint.rs         // build_task_fingerprint (8-dim classifier)
│   ├── policy.rs              // query_task_policy_hint / apply_route_prior / apply_policy_delta / decay
│   ├── evaluator.rs           // evaluate_task_learning (heuristic-only, no second model call)
│   └── revision.rs            // history replay, manual revision
├── posterior_signal/
│   ├── mod.rs
│   ├── types.rs               // PosteriorSignalKind / Source / Input / Decision
│   ├── rules.rs               // heuristic rules (explicit_outcome / score / user_text)
│   └── resolver.rs            // multi-rule arbitration + ≥0.5 confidence threshold
├── sovereign/
│   ├── mod.rs                 // Self_::consult / DecisionLocus / Observation / Ingress trait
│   └── ingress.rs             // PosteriorSignalIngress / TaskExecutionIngress / UserActionIngress / ExternalIngress
└── ../../providers/store/bandit.rs   // Thompson / ε-greedy multi-armed bandit
```

## 4. Data skeleton: TaskFingerprint

The **minimum learning unit** for self-evolution is not raw query text — it's the **task fingerprint**: a query compressed into 8 semantic dimensions. Tasks with the same fingerprint share one set of priors.

Defined in [`task_learning/types.rs::TaskFingerprint`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs); produced by [`fingerprint.rs::build_task_fingerprint`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs):

| Dimension | Values | Example |
|---|---|---|
| `goal_shape` | investigate / repair / transform / orchestrate / produce / answer | "trace / fix / migrate / automate / implement / Q&A" |
| `output_shape` | artifact / diagnosis / comparison / changed_state / explanation | "patch / root cause / tradeoff / state change / explanation" |
| `scope_shape` | batch / open_ended / single_target | "all files / architectural / single target" |
| `risk_class` | destructive / approval_sensitive / high_regret / low | "delete / secret / production / ordinary" |
| `execution_pressure` | high / medium / low | does it need to actually change state? |
| `discovery_pressure` | high / medium / low | does it depend on external retrieval? |
| `environment_dependency` | high / medium / low | does it depend on this machine's current state? |
| `verification_demand` | strict / normal / weak | must we verify? |

Serialized → SHA-1 → `fingerprint_key`. This is the primary key in the prior table.

> **Why not embeddings?** Embeddings turn "self-evolution" into a black-box search in a continuous space — **un-reviewable**. 8 enum dimensions are labels an engineer can read and discuss in a commit message. This is a deliberate interpretability tradeoff.

## 5. Decision points (DecisionLocus)

Deeting does **not learn "what the model should say."** It only learns **which of 6 engineering decision points this task family should lean toward, and how**:

| Decision point | Action candidates | Meaning |
|---|---|---|
| `route` | `direct` / `worker` | Run inline on main thread, or hand to a worker |
| `worker_selection` | `<profile_id>` | Which custom task agent profile to pick |
| `discovery` | `search_sdk_early` | Whether to call `search_sdk` early for external retrieval |
| `capability_attach` | `attach_capability` | Whether to dynamically attach an MCP capability |
| `execution` | `execute_code_plan` | Whether to escalate to the code execution plane |
| `verification` | `stronger_checks` | Whether to apply stronger verification on the result |

Canonical string constants live in [`types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs) (`DECISION_POINT_*` / `ACTION_*`). Runtime types live in [`sovereign/mod.rs::DecisionLocus`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs). The two are forced into 1:1 correspondence by the unit test `decision_locus_strings_match_canonical_constants`.

**Important**: adding a new decision point is expensive. Each addition requires:
- New constant in types.rs
- New variant in DecisionLocus
- New `derive_*_judgment` in evaluator.rs
- New arm in `compute_policy_delta`
- New weight fusion in `apply_route_prior` (if route-style)
- An explicit gate call site in chat_tool_runtime → `Self_::consult`

Do not add a decision point just to "look more complete." Each one must produce observable, evaluable, rollbackable behavior.

## 6. The Sovereign Charter (most important discipline)

If the RAG subsystem's bright line is the [No Double Lifecycle Rule](./rag-architecture.en.md#6-the-no-double-lifecycle-rule-the-most-important-rule), the self-evolution subsystem's bright line is the **Sovereign Charter** ([`runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)).

It consists of four core commitments:

### 6.1 The Self (decision locus)
The single entity that decides how Deeting adjusts itself. Today it is distributed across `task_learning/policy.rs` and safety gates in `chat_tool_runtime/mod.rs`; the long-term goal is a single `Self_::decide(locus, observation) -> Decision` entry point. **Callers must never bypass `Self_` to query the underlying bandit / scorer directly.**

### 6.2 Canonical Substrate (own vocabulary)
Type names describe **observed phenomena**, not theoretical positions. Allowed: `TaskFingerprint`, `EvaluatedOutcome`, `PolicyDelta`, `effective_weight`, `confidence`, `evidence_count`, `maturity`. **Forbidden**: `Fitness`, `Gene`, `Mutation`, `Phenotype`, `EvolutionEngine`, `GDI`, etc. in core code — they can appear in exactly one boundary file under `ingress/sources/<name>.rs`.

### 6.3 Ingress (input boundary)
All signal sources are **peers**. User actions, tool traces, posterior signals, future external capability sources (EvoMap GEP capsules / friend-shared skills / GitHub-scraped patterns / synthetic data) all enter through `trait Ingress` and appear to the core as an opaque `SourceTag`.

> Today's four ingresses are in [`sovereign/ingress.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/ingress.rs): `PosteriorSignalIngress` / `TaskExecutionIngress` / `UserActionIngress` / `ExternalIngress`. New sources **add a file here**; they do not touch core types.

### 6.4 Boundary Translation (anti-corruption layer)
When foreign protocols enter, the boundary file under `ingress/sources/<name>.rs` must completely translate them into `Observation`. **Foreign terms like `Gene` / `Capsule` must not leak into core modules.** Deleting any boundary file must leave the core `cargo check` green.

### 6.5 Bright-line rejections (PR review checklist)

- ❌ Renaming a type to `Fitness` / `Gene` / `Mutation`
- ❌ Renaming `effective_weight` to `fitness`
- ❌ `if source == "evomap" { ... }` outside a boundary file
- ❌ Raising `ROUTE_BANDIT_COEFF` to the point where bandits can flip a decision alone
- ❌ Removing `decision_has_safety_lock` "to simplify"
- ❌ Treating an external source as "more authoritative" than user_action
- ❌ Adding fields meaningful to only one external source to canonical types

The full anti-pattern list is in [`runtime/AGENTS.md` §ANTI-PATTERNS](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md).

## 7. Evaluation pipeline (Evaluator)

Defined in [`task_learning/evaluator.rs::evaluate_task_learning_with_runtime`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs).

```text
input:
  - TaskFingerprint
  - LocalRouteDecision  (the route taken this turn)
  - LocalExecutionPolicy (the execution plane this turn)
  - response_text + finish_reason
  - tool_trace_blocks    (all tool call results)
  - delegated_execution  (if a worker delegation occurred)
  - user_response_signal (if a user posterior signal arrived)

step 1: collect_task_learning_signals(trace)
        → TaskLearningSignals { tool_call_count, search_sdk_calls,
          used_attach_capability, used_execute_code_plan,
          attach_capability_errors, observed_error_codes, ... }

step 2: heuristic_pass
        derive_final_status        // success / partial / failed / blocked
        derive_verification_result // passed / weak_pass / unverified / failed
        derive_route_judgment      // good / acceptable / wasteful / wrong
        derive_discovery_judgment  // sufficient / shallow / excessive / skipped_when_needed
        derive_execution_judgment  // justified / fragile / failed
        derive_cost_class          // low / medium / high / disproportionate
        derive_retry_profile       // none / light / heavy / looping
        derive_error_profile       // none / recoverable / structural / environment_blocked
        derive_confidence          // 0.0 - 1.0

step 3: resolve_posterior_signal(user post-turn input)
        → accepted / corrected / rejected / unknown
        → applied only when confidence ≥ 0.5

step 4: primary_stage_from_outcome
        priority order — "which decision point did this turn primarily learn from":
        worker_selection > verification (if user corrected/rejected)
                         > route (if wasteful/wrong)
                         > discovery > capability_attach > execution
                         > verification (fallback) > route (fallback)

step 5: compute_policy_delta
        decision_point / action_key / direction(strengthen|weaken) / magnitude / state(provisional|confirmed)

step 6: apply_policy_delta(store, fingerprint_key, delta)
        → write to task_policy_priors table
```

**Key discipline**:

- Task evaluation is **heuristic-only** — no second model call during evaluation. This boundary is enforced by the synchronous signature of `evaluate_task_learning_with_runtime`, which no longer depends on `AppState` / `LocalModelConnection`.
- The `learning_eligible` gate filters out environment-blocked, blocked, and (confidence < 0.45 AND no posterior signal) samples — they are **not written to priors**. We'd rather lose dirty data than poison the prior table.

## 8. Prior update & decay

Writes in [`policy.rs::apply_policy_delta`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs):

```text
signed_delta = direction == "strengthen" ? +|magnitude| : -|magnitude|
store.apply_task_policy_delta(
    fingerprint_key,
    decision_point,
    action_key,
    signed_delta,
    state,            // "provisional" / "confirmed"
    confidence,       // 0..=1
    run_id,
)
```

Reads + decay in `query_task_policy_hint`:

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;
fn decay_weight(raw, updated_at, now) -> f64 {
    let age = now - updated_at;
    raw * 0.5_f64.powf(age / PRIOR_HALF_LIFE_MS)
}
```

A **21-day half-life** means:

- A strong preference learned a month ago has roughly 1/3 of its original weight today.
- Preferences from 3 months ago are essentially forgotten, leaving room for recent data.
- No "active cleanup" needed — auto-forgetting is an infrastructure property.

`recommended_action` threshold is `effective_weight > 0.1`: weak signals don't surface as recommendations.

## 9. Route fusion (apply_route_prior)

Defined in [`policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs).

```text
direct_score = (base_decision == direct ? 1.0 : 0.0) + prior_direct_weight
worker_score = (base_decision == worker ? 1.0 : 0.0) + prior_worker_weight
direct_score += 0.25 * bandit_direct_score   // ROUTE_BANDIT_COEFF
worker_score += 0.25 * bandit_worker_score

preferred = arg max(direct_score, worker_score)
override_applied =
       NOT has_safety_lock(base_decision)
   AND has_signal
   AND preferred != base_decision.route
   AND |direct_score - worker_score| >= 0.35   // ROUTE_OVERRIDE_THRESHOLD
```

Three gates:

1. **Safety lock first**. Any of `explicit_route` / `explicit_task_agent` / `destructive_intent` / `approval_sensitive` / `mutating_capability` / `high_risk_capability` blocks priors from flipping the decision.
2. **Bandit coefficient = 0.25**. The bandit is a tie-breaker, not a judge. Even if the bandit gives `direct` a perfect 1.0 and `worker` 0.0, that yields a 0.25 gap — **insufficient to cross the 0.35 flip threshold alone**. The test `apply_route_prior_bandit_scores_surface_on_application` enforces this invariant.
3. **0.35 flip threshold**. If the gap is smaller, we only append `task_learning_route_prior_observed` to `reasons` — we **do not** change the route. Observable but inactive is Deeting's default posture when learning produces uncertain signals.

## 10. Posterior signals

Defined in [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/).

**Input sources** (in priority order):

1. `explicit_outcome`: user clicked accept / correct / reject in the UI.
2. `feedback_score` + `feedback_comment`: ±1 score + free-form comment.
3. `user_text`: the user's next chat message (heuristics classify it as affirm / negate / correct).

Arbitration: [`resolver.rs::resolve_posterior_signal`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs) tries the three rule categories in priority order; the first match wins.

**Application gate**: [`should_apply_posterior_signal`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs)
- source ≠ `Unknown`
- signal ≠ `unknown`
- confidence ≥ 0.5

**Protocol version**: `posterior-signal/v1`. Like the envelope, any incompatible change requires bumping the version string.

## 11. Bandit mechanism (tie-breaker)

Full impl at [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs); multi-arm namespace isolated via `BANDIT_SCENE_TASK_ROUTE`.

Entry point: [`policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs).

```rust
let arms = provider_store.list_bandit_arm_states(BANDIT_SCENE_TASK_ROUTE).await?;
let strategy = BanditStrategy::parse(arm.strategy).unwrap_or(Thompson);
let cfg = BanditConfig { epsilon: arm.epsilon, ..default };
let direct = score_arm(find("direct"), strategy, &cfg, &mut rng);
let worker = score_arm(find("worker"), strategy, &cfg, &mut rng);
RouteBanditScores { direct, worker }
```

Strategy is switchable at the store layer (Thompson Sampling / ε-greedy). The coefficient is locked at `ROUTE_BANDIT_COEFF = 0.25` and may not be raised at the business layer.

## 12. Explicit-Feedback Experience Loop

§7–§11 describe the **priors loop**: a heuristic judge collapses every execution into one row of `task_policy_priors` (numeric weight). This section describes the **parallel** loop — the **experience loop**, living in [`evolution/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/).

It does not solve "which route to take next time"; instead:

> When a similar task arrives next time, **let the model see, in the system prompt, the natural-language experience of past same-family tasks.** Do not modify its decision — only hand it cold-start context.

The two loops coexist and do not contaminate each other:

| Dimension | Priors loop (§7–§11) | Experience loop (this section) |
|---|---|---|
| Data sink | `task_policy_priors` (numeric weights) | `evolution_cases` (natural-language summaries) |
| Input evidence | Heuristic judge + posterior signal | **Only** `ExplicitTraceFeedback` (user Accept / Reject / Correct) |
| Injection site | Routing / worker-selection layer (decision fusion) | Cold-start system message (`ColdStartPacket`) |
| Injection strength | Weighted fusion, can flip the decision past threshold | **Read-only guidance**; model may ignore |
| Learning trigger | Every task that completes | Only on explicit feedback arrival |

### 12.1 Topology

```text
task ends → user clicks Accept / Reject / Correct in UI
              │
              ▼
        ExplicitTraceFeedback signal
              │
              ▼
  submit_evolution_signal (evolution/service.rs)
              │
   ┌──────────┴──────────────────────────────────┐
   ▼                                             ▼
persist as EvolutionSignal                  route_case_type
(carries fingerprint_key, trace_id, run_id) (Rejected  → Negative case)
                                            (Accepted  → Reference case)
                                            (Corrected → Constraint case)
                                                   │
                                                   ▼
                                          evolution_cases table
                                                   │
   next task with the same fingerprint_key:
                                                   ▼
  build_cold_start_packet → ColdStartPacket {
      priors_summary,    // from task_policy_priors (read-only projection)
      reference_cases,   // up to 2
      negative_cases,    // up to 2
  }
                                                   │
                                                   ▼
  render_cold_start_packet_prompt → injected as system message
                                                   │
                                                   ▼
                                           model decides freely
```

### 12.2 Signal sources (EvolutionSignalSource)

[`evolution/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/types.rs) lists five signal sources, but **only one** is allowed to be promoted into a Case:

| Source | Entry point | Allowed to promote to Case |
|---|---|---|
| `ExplicitTraceFeedback` | `admin/commands.rs` (user clicks Accept / Reject / Correct in UI) | ✅ **Only** allowed source |
| `DeetingThink` | `chat_tool_runtime/mod.rs` (pre-task pre-flight planning) | ❌ Persisted as audit signal only |
| `ManualTaskLearningRevision` | `admin/commands.rs` (operator revises historical run) | ❌ Persisted as audit signal only |
| `MonitorObservation` | `monitor/mod.rs` (runtime monitor observations) | ❌ Persisted as audit signal only |
| `MonitorFeedback` | `monitor/workflow.rs` (monitor feedback score) | ❌ Persisted as audit signal only |

**Why locked to explicit user feedback**: this boundary is a charter invariant. Any "the program judges its own run" or "another model judges this run" would constitute a hidden secondary agent and would pollute the experience store. The gate is hardcoded in [`service.rs::route_case_type`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs), guarded by `reference_case_does_not_trigger_for_other_sources_with_accepted` / `constraint_case_does_not_trigger_for_other_sources_with_corrected` / `monitor_feedback_rejected_does_not_trigger_negative_case` tests.

### 12.3 Case promotion rules

`(source, classification) → case_type` mapping ([`service.rs::route_case_type`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs)):

| classification | case_type | Meaning |
|---|---|---|
| `Rejected`  | `Negative`   | "Avoid this framing for next same-family task" |
| `Accepted`  | `Reference`  | "This response is a good reference for next same-family task" |
| `Corrected` | `Constraint` | "Next same-family task must respect this boundary" |
| `Neutral` / `Unknown` | — | No promotion; persisted as signal only |

On promotion, `EvolutionSignal.status` advances from `Classified` to `Applied`; writing into `evolution_cases` carries `fingerprint_key` + `source_run_id` + `evidence_signal_ids` for full traceability. Case summaries are built by [`service.rs::render_case_summary`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs), a pure function that concatenates the user's note directly; when no note is supplied a fixed placeholder is used — **no model call** for polishing or rewriting.

### 12.4 Cold-start packet (ColdStartPacket)

Build entry: [`evolution/packet.rs::build_cold_start_packet`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/packet.rs), invoked by [`local_orchestrator/workflow.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) at every task startup.

Render template (any empty section is omitted):

```text
## Evolution Context (from prior runs of similar tasks)
These notes are guidance only — use them when assessing context. Do not treat
them as overriding the user's current request.

### Prior direction         ← priors_summary (read-only projection from §8)
- route:direct (favor, weight +0.42, confidence 0.71)
- discovery:search_sdk_early (avoid, weight -0.18, confidence 0.55)

### Reference cases — past successes for this task family
- User accepted the assistant's prior response with note: ...

### Negative cases — avoid repeating
- User rejected the assistant's prior response with note: ...
```

Token budgets (constants at top of [`packet.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/packet.rs)):

| Section | Cap | Constant |
|---|---|---|
| `priors_summary` | 200 tokens (≈ 800 chars) | `PRIORS_SUMMARY_CHAR_BUDGET` |
| `reference_cases` + `negative_cases` combined | 600 tokens (≈ 2400 chars) | `CASES_CHAR_BUDGET`, enforced by `enforce_case_budget` which drops lowest `confidence × recency_decay` first |
| Per-type case count | 2 | `CASE_PACKET_PER_TYPE_LIMIT` |
| Case half-life | ≈ 14 days (`exp(-age_days/20)`) | `CASE_HALFLIFE_DAYS` |
| Prior half-life | 21 days | `PRIOR_HALF_LIFE_MS`, matches §8 |

**Read-only discipline**: the `priors_summary` section is decayed and displayed from `task_policy_priors`, but is **never written back**. `task_learning::policy::apply_policy_delta` remains the sole writer for the priors table.

### 12.5 Hard lines (PR review rejection checklist)

- ❌ Promoting a Case from any signal source other than `ExplicitTraceFeedback` (charter invariant, enforced by `route_case_type` gate)
- ❌ Calling any model inside `evolution/packet.rs` or `service.rs` to score, rewrite, or generate cases
- ❌ Marking `ColdStartPacket` content as "must obey" — it is guidance; the disclaimer line in the render template must not be removed
- ❌ Letting `evolution/packet.rs` write `task_policy_priors` (priors write path is owned by `task_learning::policy::apply_policy_delta` alone)
- ❌ Routing Case summaries through any async / LLM post-processing pipeline for "polishing" — summaries come from `render_case_summary` directly off the user note
- ❌ Adding a second "experience" store outside `evolution_cases`

## 13. Self_ Consult API

Recommended caller pattern ([`sovereign/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs)):

```rust
use sovereign::{Self_, DecisionLocus};

let advisory = Self_::consult(
    &app_state.mcp_store,
    DecisionLocus::Route,
    user_query,
    8, // limit
).await;

let weight = advisory.weight_for("direct");
let recommended = advisory.recommended_action();
let gate_meta = advisory.gate_meta("direct"); // attach to tool-call telemetry
```

**Do not bypass `Self_` to call `task_learning::query_task_policy_hint` directly.** `Self_` is the future fusion point for bandits, safety filters, and new mechanisms; bypassing it pins extension points to the call site.

`Self_::consult_named(store, "discovery", ...)` is a transitional bridge for stringly-typed callers; new code uses the strongly-typed `DecisionLocus`.

## 14. End-to-end: full lifecycle of one task

```text
T0  ─ user query "rename all .ts files in src to .tsx"
T1  ─ build_task_fingerprint → {goal_shape: transform, scope_shape: batch, ...}
T2  ─ Self_::consult(Route, query)
       └─ hits fingerprint_key=abc with two priors:
           direct  effective_weight = 0.18 (provisional, 3 evidence)
           worker  effective_weight = 0.42 (confirmed,  9 evidence)
T3  ─ base router selects direct (capabilities sufficient)
T4  ─ apply_route_prior(direct, hint, bandit)
       direct_score = 1.0 + 0.18 + 0.25*0.5 = 1.305
       worker_score = 0.0 + 0.42 + 0.25*0.4 = 0.520
       no flip (gap large but preferred==base)
T5  ─ chat_tool_runtime runs direct path, 5 tools, 1 error
T6  ─ model produces patch, response_text non-empty
T7  ─ evaluate_task_learning_with_runtime
       signals = { tool_call_count: 5, tool_error_count: 1, ... }
       final_status         = partial
       route_judgment       = acceptable
       discovery_judgment   = sufficient
       execution_judgment   = justified
       error_profile        = recoverable
       confidence (heuristic) = 0.55
T8  ─ user replies "perfect"
       resolve_posterior_signal → accepted, source=user_text, confidence=0.7
       outcome.user_response_signal = "accepted"
T9  ─ primary_stage = route (no corrected/rejected; route not wrong/wasteful)
       PolicyDelta {
         decision_point: "route",
         action_key:     "direct",
         direction:      "strengthen",
         magnitude:      0.18 + 0.55*0.22 * 0.8 ≈ 0.245
         state:          "confirmed" (confidence ≥ 0.8? no → "provisional")
       }
T10 ─ apply_policy_delta writes to priors table (direct weight rises to ~0.44)

Next similar task:
T0' ─ user query "rename all .js files in lib to .ts"
T1' ─ same fingerprint_key=abc
T2' ─ direct prior is now larger; lean toward direct
       but a destructive word ("delete old files") would trigger safety lock
       and prevent the prior from flipping
```

## 15. File map

By "what do I want to change":

| I want to… | Look here |
|---|---|
| Change fingerprint classification rules | [`task_learning/fingerprint.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs) |
| Change decay period / flip threshold / bandit coefficient | Top-of-file constants in [`task_learning/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| Change heuristic judges (route/discovery/execution) | [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) `derive_*_judgment` |
| Change PolicyDelta algorithm | [`evaluator.rs::compute_policy_delta`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| Change which decision point gets credit | [`evaluator.rs::primary_stage_from_outcome`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| Change posterior signal recognition | [`posterior_signal/rules.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/rules.rs) + [`resolver.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs) |
| Add a new decision point | §16.1 |
| Add a new external signal source | §16.2 |
| Change bandit strategy | [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) + `arm.strategy` field |
| Change safety lock list | [`policy.rs::decision_has_safety_lock`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| View / replay history runs | [`task_learning/revision.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/revision.rs) |
| Entry point (recommended: Self_) | [`sovereign/mod.rs::Self_::consult`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs) |

## 16. How to extend

### 16.1 Add a new decision point (example: `memory_write`)

> Scenario: you want Deeting to learn "should this task family write to long-term memory?"

1. In [`task_learning/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs):
   ```rust
   pub(crate) const DECISION_POINT_MEMORY_WRITE: &str = "memory_write";
   pub(crate) const ACTION_MEMORY_WRITE_STRONG: &str = "memory_write_strong";
   ```
2. Add `MemoryWrite` variant in [`sovereign/mod.rs::DecisionLocus`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs), update `as_canonical_str` / `from_canonical_str` and the `decision_locus_strings_match_canonical_constants` test.
3. Add alias mapping in [`policy.rs::normalize_decision_point`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs), add guidance text in `guidance_for_decision_point`.
4. In [`evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs):
   - Add `derive_memory_write_judgment(...)`
   - Add an arm in the `match primary_stage` inside `compute_policy_delta`
   - Decide its priority in `primary_stage_from_outcome`
5. In chat_tool_runtime, call `Self_::consult(MemoryWrite, query)` at an explicit gate site and write `gate_meta` into telemetry.
6. Write an end-to-end test: construct one task, produce trace, assert prior written and read back next time.

**Key judgment**: is the action **something runtime itself can choose**? If the choice belongs to the user (e.g. "should I delete this file"), it belongs to the safety-lock domain — **do not** make it a self-evolving decision point.

### 16.2 Add a new external signal source (example: EvoMap GEP capsule)

1. Create `runtime/sovereign/ingress/sources/evomap.rs` (this is the boundary file):
   ```rust
   //! EvoMap GEP capsule ingress.
   //!
   //! Borrowing concept: GDI ranking methodology. Vocabulary stays local.
   //! `GepCapsule`, `Fitness`, `Gene` appear nowhere outside this file.

   use crate::modules::desktop_runtime::runtime::sovereign::{
       Ingress, Observation, SourceTag,
       TaskExecutionIngress, PosteriorSignalIngress,
   };

   pub(crate) struct EvoMapIngress { /* foreign payload here */ }

   impl EvoMapIngress {
       pub(crate) fn into_observation(self) -> Observation {
           // translate to TaskExecution / UserSignal / External as it maps
           // unmappable fields drop, do not pollute canonical types
       }
   }

   impl Ingress for EvoMapIngress {
       fn source_tag(&self) -> SourceTag {
           SourceTag::new("evomap_gep_v1")
       }
   }
   ```
2. **Do not** reference `GepCapsule` / `Gene` / `Fitness` anywhere in `task_learning/` or `sovereign/mod.rs`.
3. Add an invariant test: deleting this boundary file must keep `cargo check -p deeting-tauri` green.
4. In the PR description, cite "borrows EvoMap GDI methodology" — but **do not** write this attribution into core type names.

### 16.3 Change half-life / flip threshold / bandit coefficient

Only edit the three constants at the top of `policy.rs`:

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
const ROUTE_BANDIT_COEFF: f64 = 0.25;
```

Before raising `ROUTE_BANDIT_COEFF`, **re-read** §6.5: "the bandit cannot flip a decision alone" is a hard charter invariant, guarded by the `apply_route_prior_bandit_scores_surface_on_application` test. If your change lets the bandit flip alone, that test will go red — don't "fix" it; go back and reconsider.

## 17. Anti-patterns (reject in PR review)

- Renaming `effective_weight` to `fitness`
- Applying prior decay outside `query_task_policy_hint` (double decay)
- Adding `if source == "x"` branches for some external source to core code
- Calling the model again during task evaluation to grade itself (evaluation must stay a heuristic pure function)
- Lowering the `should_apply_posterior_signal` threshold below 0.5 (noise pollutes priors)
- "Simplifying" the prior write path by bypassing `apply_task_policy_delta`
- Calling the bandit directly from chat_tool_runtime, bypassing `Self_::consult` + `apply_route_prior`
- "Refactoring" `decision_has_safety_lock` checks to be configurable (must be hardcoded)
- Adding a new ingress without implementing `Ingress` (stuffing data straight into `Observation::TaskExecution`)
- Adding fields to canonical types that only one external source uses (substrate drift)

## 18. Recorded decisions and tradeoffs

| Decision | Why |
|---|---|
| 8-dim enum fingerprint instead of embedding | Reviewable; embedding turns self-evolution into a black box |
| 21-day half-life | Work content drifts on roughly sprint cadence; preferences > 1 month are usually stale |
| 0.35 flip threshold | Empirically, < 0.3 makes priors too aggressive; > 0.4 makes learning irrelevant |
| Bandit coefficient 0.25 | Ensures bandit can never flip alone (0.25 × 1.0 = 0.25 < 0.35) |
| Heuristic-only evaluation, no second model call | A second model call during evaluation becomes a hidden secondary agent and turns a pure function into an async stateful one; explicit user feedback is the stronger evidence channel |
| Priors fade naturally instead of GC | Natural forgetting > active GC; no background job, no retention window config |
| Charter in AGENTS.md, not a design doc | Discipline for "what is already done" > design for "what we want to do"; name the current truth first |

## 19. Verification checklist

A PR that touches the self-evolution path must self-check applicable items:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib posterior_signal --no-fail-fast`
- [ ] `cargo test --lib sovereign --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `apply_route_prior_does_not_override_safety_locked_*` still green
- [ ] `apply_route_prior_bandit_scores_surface_on_application` still green (bandit cannot flip alone)
- [ ] `decision_locus_strings_match_canonical_constants` still green
- [ ] Vocabulary lint: `fitness` / `gene` / `gep` / `evolver` / `phenotype` do not appear outside `ingress/sources/*.rs`
- [ ] Desktop manual test: run the same task 3 times, watch priors table accumulate deltas; intentionally click reject, watch the next same-fingerprint task lean differently

> Known Windows caveat: `cargo test` binaries occasionally fail to launch due to DLL load failures (STATUS_ENTRYPOINT_NOT_FOUND). Distinguish compile failure (must fix) from run failure (host-env issue — rerun on CI/Linux).

## 20. FAQ

**Q: Why not just have the LLM write a "self-reflection" and rewrite its own prompt?**
A: Because (1) free-text reflection is unreviewable, unrolling-back-able, and unexplainable; (2) LLM self-reflection tends toward self-reinforcement with no external ground truth; (3) Deeting's goal is to "adjust its own behavior," not "rewrite its own prompt" — the latter is prompt engineering, the former is policy learning.

**Q: How does self-evolution relate to RAG?**
A: They are independent but cooperate. RAG (Context Orchestrator) decides "should this turn fetch context and how"; self-evolution (Sovereign) decides "should this task family lean toward worker / early search / escalating to execute_code_plan." The former owns single-turn IO boundaries; the latter owns cross-task behavior drift.

**Q: Can we add a "user's favorite answer style" decision point?**
A: Possible but be very careful. The `verification` decision point already absorbs "did the user accept this." Adding a "style preference" can easily overfit to one user and produce an echo chamber. If you must add it, the action set should be a **style family** (terse / verbose / step-by-step), not continuous parameters.

**Q: The half-life is so long that old priors block new preferences — what do I do?**
A: Don't "clean up priors." The right way is to feed new signals continuously — `apply_task_policy_delta` accumulates additively, so enough new data will naturally push old priors down. If a task family's semantics truly changed, its fingerprint likely changed too, and it lands in a different `fingerprint_key` automatically.

**Q: Can Deeting learn "I should not ask this user for approval"?**
A: **No.** This violates the safety-lock hard invariant. `approval_sensitive` is a user-intent expression, not a learnable preference. "Whether approval is needed" must come from query features, not historical priors.

**Q: Will today's code be able to ingest real EvoMap GEP capsules later?**
A: Yes, but the path is pinned by the charter: add a boundary file at `sovereign/ingress/sources/evomap.rs` that translates to `Observation`. Core code will never know EvoMap exists — it only sees `SourceTag("evomap_gep_v1")`. Deleting that boundary file leaves core build green.

**Q: Can we export "learned preferences" for others to import?**
A: Technically yes (`task_policy_priors` table + fingerprints are stable), but treat the import as a new ingress: import via `ExternalIngress`. **Do not** write `task_policy_priors` directly — otherwise cross-user contamination has no audit point.

## 21. References

- Sovereign Charter (architectural discipline): [`deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)
- Decision fusion: [`task_learning/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- Evaluation pipeline: [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)
- Task fingerprint classifier: [`task_learning/fingerprint.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs)
- Posterior signals: [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/)
- Bandit: [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs)
- Companion RAG doc: [`docs/rag-architecture.en.md`](./rag-architecture.en.md)
