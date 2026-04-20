# desktop_runtime/runtime — Sovereign Architecture Charter

## OVERVIEW

This module hosts Deeting's autonomous self-adjustment system. It is architected
around a single principle: **Deeting is the subject; everything else is
observation.**

This charter captures architectural commitments that **already exist in the
code** prior to this document. The charter exists to **name what is already
true** so that future refactors (by humans or agents) do not silently erode it.

## CORE PRINCIPLE

Deeting is a sovereign self-adjusting system. It has its own "Self" that decides
how to adjust itself based on observations. Every external thing — user actions,
tool traces, posterior signals, future external capability sources, MCP
registries, file system events — is **input data, not authority**.

No external source, no theoretical framework, no single mechanism owns
Deeting's decision-making. The Self consults many signals and adjusts itself;
it never abdicates.

## THE FOUR NAMED LAYERS

### 1. The Self (decision locus)

**What it is:** The single entity that decides how Deeting adjusts itself.

**Where it lives today:** Distributed across `task_learning/` (priors, bandit,
deltas) and the policy gates in `chat_tool_runtime/mod.rs`. Long-term goal: a
single `Self_::decide(locus, observation) -> Decision` entry point that wraps
the existing functions without rewriting them.

**Contract:**
- Decision logic is paradigm-agnostic. Today: statistics + bandit + safety
  locks. Tomorrow may include LLM reasoning or techniques not yet invented.
  The choice is internal and replaceable.
- The Self never delegates final authority to any single signal, source, or
  mechanism.
- Safety locks (e.g. `decision_has_safety_lock` in
  [task_learning/policy.rs](task_learning/policy.rs)) are inviolable: user
  intent always overrides learned priors.

### 2. Canonical Substrate (data structures)

**What it is:** Deeting's own vocabulary for describing observations and
adjustments.

**Where it lives:** [task_learning/types.rs](task_learning/types.rs),
[posterior_signal/types.rs](posterior_signal/types.rs).

**Discipline:**
- Type names describe **what is observed**, not **what it means in some
  theory**. Existing examples: `TaskFingerprint`, `EvaluatedOutcome`,
  `PolicyDelta`, `effective_weight`, `confidence`, `evidence_count`,
  `maturity`, `PosteriorSignalKind`. None of them say "fitness", "gene",
  "mutation", "evolution", "gdi" — they describe phenomena.
- Multi-dimensional, decomposable signals (4+ source kinds, 6 decision points,
  multi-axis weighting) prevent any single dimension from masquerading as
  ground truth.

### 3. Ingress (input boundary)

**What it is:** The unified interface through which observations enter The
Self's awareness.

**Where it lives today:** Implicit — distributed across direct calls in
`chat_tool_runtime`, `posterior_signal`, `tool_trace`, etc. Long-term goal:
an explicit `trait Ingress` so all input sources implement the same contract.

**Contract:**
- All input sources are equal. User actions, tool traces, posterior signals,
  and (future) external capability registries are siblings, not a hierarchy.
- Source provenance is metadata (`PosteriorSignalSource`, future `SourceTag`),
  never structural privilege.
- Adding a new ingress source must not require changes to The Self or
  Substrate.

### 4. Boundary Translation (anti-corruption layer)

**What it is:** The narrow zone where foreign formats (external protocols,
third-party schemas) are mapped into Canonical Substrate.

**Where it lives today:** Empty — Deeting has no external sources. When
external sources arrive (e.g. EvoMap GEP capsules, friend-shared skills,
GitHub-scraped patterns, synthetic data), they live behind
`ingress/sources/<name>.rs` and never leak their native types into the core.

**Contract:**
- Foreign type names (e.g. `GepCapsule`, `Gene`, `Fitness`) appear nowhere
  outside the single boundary file that handles that format.
- Foreign data is fully translated into `Observation` at the boundary; the rest
  of the system cannot tell where it came from beyond an opaque source tag.
- Removing any boundary file must not break the core build.

## EXISTING CODE THAT EMBODIES SOVEREIGNTY

These are not aspirational — they are already in the repo. Read them before
changing this area:

| Sovereign behavior | Where to find it |
|---|---|
| Descriptive (non-theoretical) vocabulary | [task_learning/types.rs](task_learning/types.rs) |
| Multi-decision-point abstraction | `DECISION_POINT_*` constants in [task_learning/types.rs](task_learning/types.rs) |
| Multi-source signal taxonomy | `PosteriorSignalSource` in [posterior_signal/types.rs](posterior_signal/types.rs) |
| Bandit as tie-breaker, not judge | `ROUTE_BANDIT_COEFF: f64 = 0.25` in [task_learning/policy.rs](task_learning/policy.rs) |
| User intent override of learned priors | `decision_has_safety_lock` in [task_learning/policy.rs](task_learning/policy.rs) |
| Time-decay of priors (no permanent enshrinement) | `decay_weight` + `PRIOR_HALF_LIFE_MS` in [task_learning/policy.rs](task_learning/policy.rs) |
| Versioned signal protocol | `posterior-signal/v1` in [posterior_signal/types.rs](posterior_signal/types.rs) |
| Confidence + evidence + maturity multi-axis weighting | `TaskPolicyHintItem` fields in [task_learning/types.rs](task_learning/types.rs) |
| Bandit isolation as a callable mechanism | [../../providers/store/bandit.rs](../../providers/store/bandit.rs) |

## ANTI-PATTERNS (REJECT IN PR REVIEW)

These are the failure modes that erode sovereignty. If a proposed change
matches any of these, push back.

### Vocabulary erosion
- Adding type names that commit to a specific paradigm: `Fitness`, `Gene`,
  `GeneCapsule`, `EvolutionEngine`, `Phenotype`, `Mutation`, `Selection`,
  unless the term is **strictly local** to one boundary file.
- Renaming `effective_weight` to `fitness`, `PolicyDelta` to `Mutation`, etc.

### Privileged source
- Code that gives any external source structural status, e.g.
  `if source == "evomap" { ... }` outside the boundary file.
- Hardcoding behavior that depends on a specific external protocol's schema.
- "External capabilities are more authoritative than user signals" — never.

### Single-mechanism dictatorship
- Raising `ROUTE_BANDIT_COEFF` (or equivalent) to the point where one
  mechanism dominates the rest.
- Removing `decision_has_safety_lock` checks "to simplify".
- Bypassing decision-point routing to call a specific scorer directly from
  `chat_tool_runtime`.

### Boundary leak
- Importing foreign types (`GepCapsule`, etc.) anywhere outside
  `ingress/sources/<that_source>.rs` (when such files exist).
- Letting foreign source identifiers appear in `Observation` discriminants
  beyond an opaque `SourceTag`.

### Substrate drift
- Adding fields to canonical types that only make sense for one external
  source.
- Coupling decision-point enums or signal kinds to specific external
  protocols.

## INVARIANTS

The following must hold at every commit. Add CI checks if practical:

1. **Vocabulary test:** No occurrence of `gene` / `gep` / `evolver` / `fitness`
   / `phenotype` (case-insensitive) outside `ingress/sources/*.rs` (once those
   exist).
2. **Build isolation test:** Removing any single file under `ingress/sources/`
   must leave `cargo check -p deeting-tauri` green.
3. **Safety lock test:** Existing tests
   `apply_route_prior_does_not_override_safety_locked_*` must remain green.
4. **Multi-source test:** `PosteriorSignalSource` must continue to enumerate
   ≥3 distinct non-`Unknown` kinds.
5. **Tie-breaker test:** Bandit coefficient must remain low enough that bandit
   alone cannot flip a decision against the prior + base layer.

## WHERE TO LOOK

| Concern | Location |
|---|---|
| Decision logic (today) | [task_learning/policy.rs](task_learning/policy.rs), [task_learning/evaluator.rs](task_learning/evaluator.rs) |
| Canonical types | [task_learning/types.rs](task_learning/types.rs), [posterior_signal/types.rs](posterior_signal/types.rs) |
| Decision invocation points | [chat_tool_runtime/mod.rs](chat_tool_runtime/mod.rs) — search for `query_task_policy_hint` |
| Posterior signal resolution | [posterior_signal/resolver.rs](posterior_signal/resolver.rs), [posterior_signal/rules.rs](posterior_signal/rules.rs) |
| Tool trace capture | [tool_trace.rs](tool_trace.rs), [tool_feedback.rs](tool_feedback.rs) |
| Recovery / inflight | [chat_tool_runtime/recovery.rs](chat_tool_runtime/recovery.rs), [chat_tool_runtime/inflight.rs](chat_tool_runtime/inflight.rs) |
| Bandit mechanism | [../../providers/store/bandit.rs](../../providers/store/bandit.rs) |
| Capability governance | [../../capability_control_plane.rs](../../capability_control_plane.rs) |

## ON EXTERNAL SOURCES

Deeting may eventually benefit from external signal sources (e.g. EvoMap's GEP
capsules, friend-shared skills, GitHub-scraped patterns). The discipline:

- They enter only as a new `Ingress` implementation in
  `ingress/sources/<name>.rs`.
- They translate their native format into `Observation` at the boundary.
- They get an opaque `SourceTag`; The Self treats them with the same epistemic
  posture as user actions and posterior signals — no more, no less.
- They are never load-bearing: removing all external sources must leave
  Deeting still adjusting itself from local signals alone.
- Attribution for borrowed concepts (e.g. "this scoring rubric is inspired by
  EvoMap's GDI methodology") goes in the boundary file's module comment, not
  in core type names. Borrow concepts; do not import vocabulary.

## ORIGIN OF THIS CHARTER

Most of this discipline was already practiced in the code before this charter
was written:

- The vocabulary was already descriptive, not theoretical.
- The bandit was already a tie-breaker, not a judge.
- Safety locks were already protecting user intent.
- Posterior signals already distinguished sources.
- Priors already decayed with time.

The charter exists because **good engineering instincts can be silently undone
by future refactors that "simplify" away the discipline**. Naming what was
already true makes it defensible — in PR review, in onboarding, in long-horizon
architectural decisions.

When in doubt: **Deeting observes; Deeting adjusts itself; Deeting remains the
subject.**
