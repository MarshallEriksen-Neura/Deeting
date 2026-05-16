# Deeting Bandit Architecture

> Scope: the multi-armed bandit implementation in the Deeting desktop runtime at three decision points — routing, worker selection, and memory recall.
> Out of scope: the role of bandits inside the broader self-evolution loop (see [self-evolution-architecture.en.md](./self-evolution-architecture.en.md#11-bandit-mechanism-tie-breaker)); the Approval Gate "tool call allow / deny" decision — that is not what a bandit should solve.

This document is for people who want to understand "why a desktop AI application would introduce algorithms from recommender systems". We start from the historical motivation, walk through the code for the three strategies (Thompson / UCB / ε-greedy), describe each of the three usage scenarios one by one, and then explain why Deeting deliberately restricts the bandit to a *tie-breaker* role instead of letting it act as the decision-maker.

## 1. TL;DR

**Multi-armed bandit** is a classic reinforcement-learning problem: you have N slot machines (each called an *arm*) in front of you, each with a different but unknown win rate, and you want to maximize total reward across a limited number of pulls. Its canonical application is **recommender systems** — which news article / which product / which ad to show a user.

Deeting brings it into the desktop agent because we face **the same formal problem** in three places:

| Recommender-system semantics | Deeting semantics |
|---|---|
| What news to recommend | Whether this kind of task goes through `direct` or `worker` |
| What product to recommend | Which of the 5 custom task agent profiles to pick |
| Which search result to surface | Among multiple equally matched memories, which one to emphasize |
| "Click = success" on a news item | "Task completed = success" on a decision |
| Exploration vs exploitation | Exactly the same |

But **Deeting is not a recommender system**. Two essential differences dictate how we **converge** on bandit usage:

1. **The bandit cannot decide alone.** In Deeting the bandit is a **tie-breaker** — it only kicks in when the other evidence (priors / safety locks / explicit user instructions) is tied. The coefficient is fixed at `ROUTE_BANDIT_COEFF = 0.25`; on its own it cannot exceed the `ROUTE_OVERRIDE_THRESHOLD = 0.35` override threshold.
2. **The cost of failure is much larger than the gain from success.** One misrouted task = one tool failure = the user waits a few extra seconds; one wrong tool execution = the user's system is damaged. The bandit algorithm itself **does not know** about this asymmetry — so its influence must be hard-capped by the outer layer.

Full implementation entry points:

```
deeting/src-tauri/src/modules/providers/
├── bandit_selector.rs          // Thompson / UCB / ε-greedy strategies
├── bandit_selector_tests.rs    // Deterministic tests
├── store/
│   ├── bandit.rs               // Persistence + feedback recording
│   └── mod.rs                  // Three BANDIT_SCENE_* constants
└── types.rs                    // BanditArmState data structure
```

## 2. Multi-armed bandit: a 1-minute refresher

**Problem form**:
- N arms, each arm gives a reward (success 1 / failure 0) with some probability when pulled.
- The true win rate `p_i` of each arm is unknown; you have to estimate it by pulling.
- You have T pulls in total.

**Goal**: maximize cumulative reward.

**Core tension**:
- **Exploit**: keep pulling the arm that currently looks best → but you may have missed a truly better arm (one you simply have not pulled).
- **Explore**: pull lower-rate arms occasionally → trial and error itself has a cost.

**Difference from supervised learning**: supervised learning has "the right answer" as training data; a bandit can only learn by **actively trying** — every decision is both an *action* and a *learning sample*.

**Relationship to reinforcement learning**: the bandit is the simplest form of RL (stateless / single-step reward).

Classic strategies:

1. **ε-greedy**: explore randomly with probability ε, exploit the current best with probability 1-ε. Crude but it works.
2. **UCB1** (Upper Confidence Bound): pick `mean win rate + c × sqrt(ln(N)/n_i)` — arms pulled fewer times have a higher upper bound and get explored naturally.
3. **Thompson Sampling**: maintain a Beta(α, β) distribution for each arm, sample once each round, pick the arm with the largest sample. Balances exploration and exploitation naturally from a Bayesian standpoint.

Deeting **implements all three** and can switch them at the store layer (see §4).

## 3. Why use it inside Deeting?

Deeting is a local-first desktop agent, not Netflix. Importing recommender-system algorithms sounds strange. But once you swap "user" for "model itself", the problem form lines up:

### Scenario mapping

| Recommender system | Deeting | What an arm is | What reward is |
|---|---|---|---|
| Recommend news to a user | Pick a route for a class of task | Two arms: `direct` / `worker` | Task completed = success |
| Recommend products to a user | Pick a worker profile for a class of task | Each custom task agent profile | Delegation completed and accepted by user = success |
| Recommend search results to a user | Explore cold entries during memory recall | Each candidate memory entry | Hit / accepted by user = success |

**Deeting hits the exact same engineering problems in all three places**:

1. **Truth is unknown**: nobody can pre-tell the system which route / which profile / which memory is "better".
2. **Delayed observation**: at decision time we do not know the outcome — we have to wait for the task to finish and the user to provide feedback.
3. **Sparse feedback**: most of the time the user is silent (neither praises nor complains); we have to learn from sparse signals.
4. **Cold start**: a freshly added worker profile or a newly fingerprinted task has zero historical data.
5. **Non-stationary**: actual user preferences drift over time — the worker that was optimal three months ago may not be optimal today.

These five concerns **are exactly the issues the bandit literature has studied for decades** — reusing the established methodology is more robust than designing from scratch.

### Why not just supervised learning?

Supervised learning requires "the right answer". But these three Deeting scenarios **have no ground truth** — nobody can tell the system "this query should actually have gone through worker". All we have is whether the user accepted, whether the tool errored, total runtime, whether retries fired … all of these are **indirect reward signals**, which is precisely the standard input of a bandit.

### Why not just heuristic rules?

Heuristic rules ("long query → worker, short query → direct") have different optimal thresholds for every user and drift with usage patterns. A bandit gives the system **a path to adapt to each individual user**, which is friendlier in the long term than static rules.

### Why not a more sophisticated RL formulation?

Because our scenario **really is a bandit-shaped problem**: decisions are independent of each other, rewards are observable right away, and the state space has already been discretized by `TaskFingerprint` (see [self-evolution §4](./self-evolution-architecture.en.md#4-data-skeleton-taskfingerprint)). Introducing MDP / Q-learning / policy gradients would blow up algorithmic complexity for **zero marginal benefit** — when the problem is bandit-shaped, you do not need a heavy hammer.

## 4. The three strategies in code

[`bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs). All three strategies share one interface:

```rust
pub enum BanditStrategy {
    Thompson,
    Ucb,
    EpsilonGreedy,
}

pub fn score_arm<R: Rng + ?Sized>(
    state: Option<&BanditArmState>,
    strategy: BanditStrategy,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    match strategy {
        BanditStrategy::Thompson      => score_thompson(state, cfg, rng),
        BanditStrategy::Ucb           => score_ucb(state, cfg),
        BanditStrategy::EpsilonGreedy => score_epsilon_greedy(state, cfg, rng),
    }
}
```

### 4.1 BanditArmState (data structure)

Defined in [`providers/types.rs`](../deeting/src-tauri/src/modules/providers/types.rs):

```rust
pub struct BanditArmState {
    // ... scene / arm_id / strategy and other metadata
    pub alpha: f64,                  // Beta-distribution parameter: cumulative successes + prior
    pub beta: f64,                   // Beta-distribution parameter: cumulative failures + prior
    pub successes: i64,
    pub total_trials: i64,
    pub cooldown_until: Option<String>,  // Temporary unavailable-until timestamp
    // ...
}
```

This is **hybrid Bayesian + frequentist** data: `alpha / beta` are used by Thompson; `successes / total_trials` are used by UCB and ε-greedy. Both are updated together on every feedback.

### 4.2 Thompson Sampling

```rust
pub fn score_thompson<R: Rng>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    let (alpha, beta) = match state {
        None    => (cfg.thompson_prior_alpha, cfg.thompson_prior_beta),
        Some(s) => (s.alpha.max(EPS), s.beta.max(EPS)),
    };
    Beta::new(alpha, beta)
        .map(|dist| dist.sample(rng))
        .unwrap_or(0.5)
}
```

**Intuition**:
- Each arm has its own Beta(α, β) distribution — more successes ⇒ larger α, more failures ⇒ larger β.
- On every decision, **sample once from the distribution** and pick the arm with the largest sample.
- Sampling **explores automatically**: arms with uncertain win rates have wide distributions and occasionally produce large samples that get picked.
- As feedback accumulates the distribution sharpens, gravitating toward pure exploitation.

**Deeting uses this by default**. Reasons:
1. No extra hyperparameters (ε / c) needed — prior α=β=1 is the uniform Beta, no tuning.
2. The exploration-vs-exploitation balance falls out of Bayes naturally, not from hand-tuned heuristics.
3. Incremental updates are cheap: success ⇒ `α += 1`, failure ⇒ `β += 1`.

### 4.3 UCB1 (Upper Confidence Bound)

```rust
pub fn score_ucb(state: Option<&BanditArmState>, cfg: &BanditConfig) -> f64 {
    let state = state.unwrap_or_else(|| return 1.0);
    let total = state.total_trials.max(0) as u64;
    if total == 0 || total < cfg.ucb_min_trials {
        return 1.0;            // Force a new arm to be tried at least ucb_min_trials times
    }
    let rate = state.successes as f64 / total as f64;
    rate + cfg.ucb_c * ((total as f64 + 1.0).ln() / total as f64).sqrt()
}
```

**Formula**: `mean win rate + c × sqrt(ln(N+1) / N)`

- First term: empirical win rate (exploit)
- Second term: confidence upper bound (explore) — larger `c` leans further toward exploration

**Deeting specifics**:
- `ucb_min_trials = 5`: a new arm always returns 1.0 (max value) until it has been tried 5 times — forcing initial exploration so a fresh arm is not "discarded the moment it lands".
- `ucb_c = 1.5`: slightly above the classic √2 ≈ 1.41, biasing toward a little more exploration.
- Fully deterministic (no randomness), convenient for offline replay and debugging.

**When to use UCB**: when you want every arm to get a "fair trial" — memory-recall exploration uses a similar idea (see §5.3).

### 4.4 ε-greedy

```rust
pub fn score_epsilon_greedy<R: Rng>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    if cfg.epsilon <= 0.0 {
        return score_success_rate(state);     // Pure exploitation
    }
    if rng.gen::<f64>() < cfg.epsilon {
        return rng.gen::<f64>();              // Pure random with probability ε
    }
    score_success_rate(state)
}
```

**Simplest**: explore fully at random with probability ε, exploit the current best with probability 1-ε. `epsilon` defaults to 0.1.

**Deeting keeps this path mainly to**:
1. Provide a baseline against external evaluation tools.
2. Give unit tests a deterministic, controllable strategy (with ε=0 it degenerates into pure success-rate scoring).
3. Allow users or admins to **force more aggressive exploration** (raising epsilon) when they suspect Thompson is converging too fast.

## 5. The three usage scenarios

[`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs) declares three scene constants at the top:

```rust
pub const BANDIT_SCENE_TASK_ROUTE: &str       = "task_learning:route";
pub const BANDIT_SCENE_WORKER_SELECTION: &str = "task_learning:worker_selection";
pub const BANDIT_SCENE_MEMORY_RECALL: &str    = "memory:recall";
```

**The scene field is a namespace boundary** — arms across the three uses cannot contaminate each other, and strategies / hyperparameters can be switched independently.

### 5.1 Scene 1: Routing (task_learning:route)

Call site: [`task_learning/policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs).

**Arms**: two — `direct` / `worker`.

**Reward**: task completed and no "reroute" verdict (see [self-evolution §7](./self-evolution-architecture.en.md#7-evaluation-pipeline-evaluator) `route_judgment` label).

**Why a bandit**: under the same task fingerprint, routing happens repeatedly with observable rewards — a textbook stationary multi-armed bandit setup.

**Key constraint**:

```rust
const ROUTE_BANDIT_COEFF: f64 = 0.25;
// Inside apply_route_prior:
direct_score += 0.25 * bandit_direct_score;
worker_score += 0.25 * bandit_worker_score;
// Override threshold:
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
```

The bandit is deliberately bounded here: even if the bandit gives a full 1 to one side and 0 to the other, the gap is only 0.25 — **not enough to overcome the 0.35 override threshold**. This means the bandit **only matters when the prior + base router are already nearly tied** — it is a **tie-breaker**, not a judge.

The test `apply_route_prior_bandit_scores_surface_on_application` guards this invariant.

### 5.2 Scene 2: Worker selection (task_learning:worker_selection)

Call site: [`desktop_runtime/runtime/worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs).

**Arms**: every custom task agent profile the user has configured.

**Reward**: the worker finished the delegation without `worker_selection_judgment in (failed, unstable, blocked)`.

**Why a bandit**: a user may configure 3 to 10 profiles, each one stronger on a different family of tasks; no one can hand-write a static rule that says "this type of task should use profile X".

**Cooldown**:

```rust
pub fn is_in_cooldown(state: &BanditArmState, now_rfc3339: &str) -> bool {
    match &state.cooldown_until {
        Some(until) => until.as_str() > now_rfc3339,
        None => false,
    }
}
```

If a profile fails repeatedly in a row, `cooldown_until` is written → `select_arm` skips it temporarily, and the profile only rejoins sampling once the cooldown elapses. This avoids "immediately retrying a worker that just crashed".

**Difference from the routing scene**: worker_selection **can** be driven directly by the bandit — because there is no "explicit user instruction" safety-lock priority here; picking the wrong worker means the task is slower or worse, not unrecoverable system damage. This is an engineering distinction — where the bandit "is allowed to speak on its own" is a **business question**, not an algorithm question.

### 5.3 Scene 3: Memory recall exploration (memory:recall)

Call site: inside the search path in [`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs).

**Arms**: candidate memory entries (the memory `id` is the arm_id).

**Reward**: hit, and the user did not "immediately retract / deny".

**Why a bandit**:
- A user's memory store has many entries; many are retrieved without ever being used.
- Pure similarity ranking leaves "cold but actually relevant" memories at the bottom forever.
- The bandit gives cold entries a **structured exploration opportunity** — bumping them up occasionally so the user sees them.

**Relationship to ranking**: here the bandit is not a replacement for similarity ranking — it **layers a mild perturbation on top**. Most of the time the ordering is dominated by similarity, but occasionally (when Thompson samples the long tail) a cold entry surfaces.

**Why the bandit should not own memory ranking by itself**: similarity is already a very strong signal; fully replacing it with the bandit would let "past usage" take over "semantic relevance", which is a regression. So just like in the routing scene, the bandit is an **auxiliary signal**; the main signal is vitality + lifecycle multiplier (see [memory-architecture §3](./memory-architecture.en.md#3-architecture-overview)).

## 6. Cooldown and failure protection

`BanditArmState.cooldown_until` is the **circuit breaker** inside the bandit module:

```text
record_bandit_feedback(scene, arm_id, success=false, …)
    └─ After N consecutive failures:
       cooldown_until = now + cooldown_duration
       (persisted into SQLite)

Next select_arm:
    is_in_cooldown(state, now_rfc3339):
        Some(until) where until > now → skip this arm
```

Why is this needed? Because the "learning rate" of the algorithm itself only suppresses the win rate after many failures — but **we cannot wait that long**. A worker / profile failing repeatedly may have broken config or a downed service — immediately shielding it for a few minutes is better than letting the algorithm learn slowly.

**Relationship with the algorithm itself**: cooldown is not a standard part of bandits; it is a Deeting engineering patch. Academic bandits assume arms are **stationary distributions**; real systems have arms that **fail outright** — cooldown distinguishes the "failure mode" from the "low-win-rate mode" and keeps the learning curve from being skewed by anomalies.

## 7. Alignment with the Python reference implementation

Top-of-file comment in [`bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs):

```rust
//! Multi-armed bandit selection algorithms for the provider routing layer.
//!
//! Mirrors the reference implementation in
//! `deeting_core/app/services/decision/decision_service.py` so the desktop
//! runtime and the core service converge on identical mathematical behaviour.
```

The desktop Rust implementation **strictly mirrors** the Python implementation in `deeting_core`. That means:

- Math, hyperparameter defaults, and RNG-seed behavior must be **bit-aligned**.
- A sample run on Python must be reproducible on Rust.
- Changing one side requires synchronously updating the other.

Why? Because the bandit state is also consumed by `deeting_core` (the cloud orchestration path) — both sides act on the same `BanditArmState` row. If the math diverges, the same arm produces different recommendations on the two sides and the user experience breaks down.

## 8. The full feedback loop

```text
┌──────────────────────────────────────────────────────────┐
│ ① Decision moment                                         │
│   select_arm(candidates, arm_id_of, arm_map, strategy)   │
│   - Pull all arm states for this scene from the store    │
│   - Skip in_cooldown                                      │
│   - score_arm(...) scores each one                        │
│   - Return the highest-scoring arm                        │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
   Actual execution (routing / delegation / recall)
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ ② Feedback moment (task ended / user reacted / error)     │
│   record_bandit_feedback(scene, arm_id, success, meta)   │
│   - successes += success ? 1 : 0                          │
│   - total_trials += 1                                     │
│   - alpha += success ? 1 : 0                              │
│   - beta  += success ? 0 : 1                              │
│   - Set cooldown_until when needed                        │
│   - Write to SQLite (audit row)                           │
└──────────────────────────────────────────────────────────┘
```

The whole loop is **completely transparent from the user's point of view** — they never see "the bandit recommends X"; they only see the model gradually fitting their tasks better.

## 9. Design constraints (reject during PR review)

| Anti-pattern | Why it is rejected |
|---|---|
| Raising `ROUTE_BANDIT_COEFF` so the bandit can override on its own | Violates the [self-evolution charter](./self-evolution-architecture.en.md#65-bright-line-rejections-pr-review-checklist); promotes the bandit from tie-breaker to judge |
| Letting the bandit make decisions in "safety-sensitive" scenes beyond worker_selection | Unrecoverable operations must not be governed by a probabilistic algorithm |
| Adding fancy historical-reward discounting to the bandit | Adds hyperparameters and double-learns the reward; use cooldown, not reward shaping |
| Writing the prior into bandit state | Priors live in the `task_policy_priors` table; mixing them into the bandit double-counts |
| Letting the bandit make critical decisions during cold start | A new arm with no data: UCB returns 1.0 (forced exploration), Thompson samples a uniform prior — outcomes are near-random; critical decisions should wait until maturity (≥10 trials) |
| Replacing RAG recall ranking with the bandit | The bandit only layers a signal; similarity stays dominant or memory quality collapses |
| Sharing arm_id across scenes (e.g. `direct` used in multiple scenes) | Scenes are namespaces — always prefix to disambiguate |
| Changing the Rust implementation without syncing the Python implementation | The math must stay aligned across both sides |

## 10. File map

| I want to… | Look here |
|---|---|
| Tune Thompson / UCB / ε defaults | [`bandit_selector.rs::BanditConfig::default`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs) |
| Change ε-greedy / UCB strategy implementation | [`bandit_selector.rs::score_*`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs) |
| Change the default strategy | [`providers/store/mod.rs::BANDIT_DEFAULT_STRATEGY`](../deeting/src-tauri/src/modules/providers/store/mod.rs) |
| Add a new scene | Same file as above + call `select_arm` on the business side |
| Change cooldown trigger logic | [`providers/store/bandit.rs::record_bandit_feedback`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) |
| Change the routing fusion formula | [`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| Change worker selection strategy | [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) |
| Change BanditArmState persistence | [`providers/types.rs::BanditArmState`](../deeting/src-tauri/src/modules/providers/types.rs) + [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) |
| Offline replay / verification | [`bandit_selector_tests.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector_tests.rs) |

## 11. How to extend

### 11.1 Adding a new scene (e.g. `prompt_variant_selection`)

> Scenario: you have several prompt variants and want the system to learn which variant works best on a class of task.

1. Add a constant in [`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs):
   ```rust
   pub const BANDIT_SCENE_PROMPT_VARIANT: &str = "prompt:variant";
   ```
2. Call `select_arm` with `scene = BANDIT_SCENE_PROMPT_VARIANT` and the prompt variant id as the arm_id.
3. At the feedback point in the evaluation pipeline (see [self-evolution §7](./self-evolution-architecture.en.md#7-evaluation-pipeline-evaluator)) call `record_bandit_feedback(scene, arm_id, success)`.
4. **Decide**: is this scene a "tie-breaker" or a "stand-alone decision-maker"? If a tie-breaker, add a `_COEFF` constant and multiply it during fusion; if stand-alone, decide whether a safety lock is required.
5. Add a test that asserts the new scene does not pollute arms in older scenes (namespace isolation).

### 11.2 Adding a new strategy (e.g. `SoftmaxBoltzmann`)

1. Add a variant to [`BanditStrategy`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs).
2. Add `parse` support.
3. Implement `score_softmax(state, cfg, rng)`.
4. Add a branch in `score_arm` match.
5. Sync the Python implementation (`deeting_core/app/services/decision/decision_service.py`).
6. Add a deterministic test: fix the RNG seed, assert same input → same output.

### 11.3 Adding context to the bandit (contextual bandit)

> Idea: have arm selection consider not only history but also the current task context (such as fingerprint dimensions).

Do **not** do this inside the bandit module. The correct approach:
- **Fingerprint already discretizes the context** — same fingerprint shares one set of arm states.
- If you want more granular context → make fingerprint dimensions richer / finer (see [self-evolution §4](./self-evolution-architecture.en.md#4-data-skeleton-taskfingerprint)), instead of teaching the bandit algorithm to handle context.
- This boundary is important: the bandit algorithm stays simple (stateless); all "context sensitivity" is resolved through the fingerprint key. Algorithm and "semantic modeling" stay separate.

## 12. Known decisions and trade-offs

| Decision | Why |
|---|---|
| All three strategies implemented, not just one | Thompson is default, but UCB (forces cold-start exploration) and ε-greedy (baseline reference) each have independent value |
| `ROUTE_BANDIT_COEFF = 0.25` locked down | The bandit is a tie-breaker, not allowed to override alone — hard invariant |
| `ucb_min_trials = 5` | Force exploration of new arms at least 5 times during cold start |
| Default Beta prior (1.0, 1.0) | Equivalent to a uniform prior; any more aggressive prior biases the cold start toward one side |
| Cooldown is an engineering patch, not part of the algorithm | The algorithm assumes stationary arms; real arms fail, and cooldown separates "failure mode" from "low-win-rate mode" |
| Scenes are namespace-isolated | Arms across decision points must not pollute each other |
| Rust mirrors Python | Both sides act on the same `BanditArmState`; the math must agree |
| The bandit does not hold the prior | Priors live in `task_policy_priors`; mixing them into bandit state double-counts |
| Default Thompson | No extra hyperparameters; the exploration-exploitation balance falls out of Bayes naturally |

## 13. Verification checklist

PRs touching the bandit module must self-check:

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib bandit_selector --no-fail-fast`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib worker_dispatch --no-fail-fast`
- [ ] Key invariant tests still green:
  - `apply_route_prior_bandit_scores_surface_on_application` (the bandit cannot override on its own)
- [ ] When modifying the algorithm: sync the Python side (`deeting_core/app/services/decision/decision_service.py`)
- [ ] When adding a scene: verify arms of old scenes are not polluted
- [ ] When changing default hyperparameters: replay history once and check whether the cumulative-reward curve matches expectations
- [ ] Manual desktop tests:
  - Trigger the same kind of task repeatedly → the route preference should converge slowly
  - Force a worker profile to fail repeatedly → cooldown should kick in
  - Cold start a new fingerprint → the first few decisions should be visibly exploratory

## 14. FAQ

**Q: Can what the bandit learns inside Deeting be shared across users?**
A: Technically the `BanditArmState` table can be exported and imported, but treat cross-user sharing as a **new ingress** (see [self-evolution §6.3](./self-evolution-architecture.en.md#63-ingress-input-boundary)). Merging tables directly lets one user's preferences pollute another and offers no audit point.

**Q: Can we let the user see what the bandit is doing?**
A: Yes — every row written by `record_bandit_feedback` carries meta; the UI can render a "why this was recommended" explanation. But **do not** let the UI suggest the user "tune the bandit" — its purpose is to self-learn, not to be micromanaged.

**Q: Thompson sampling is random — won't users feel the system is "unstable"?**
A: On hot arms (lots of data), the Beta distribution is sharp and sampling lands near the mean rate — the user does not feel randomness. Only on cold arms (little data) is the distribution wide → exploration is visible → the user **will** feel randomness, which is exactly what we want.

**Q: UCB is fully deterministic — how does it ever pick a low-win-rate arm?**
A: Via the "exploration bonus" term `c × sqrt(ln(N)/n_i)` — for a new arm with `n_i = 1` the second term is large; for an old arm with `n_i = 1000` the second term is small. So UCB drives exploration via **differences in trial counts**, not randomness.

**Q: Can cooldown permanently kill an arm that failed early?**
A: No — cooldown is a time window, expiring automatically. If an arm enters cooldown repeatedly, it really does have a problem and should be handled upstream (disable the worker profile / restart the MCP tool), not by the bandit.

**Q: Will the win rates the bandit learns become stale over time?**
A: They can. Deeting currently does **not** implement explicit reward decay — this is a **known shortcoming**. Mitigations: (1) cooldown handles acute failures; (2) the prior table (task_learning) has a 21-day half-life, providing another signal. A full fix requires giving the bandit a "sliding-window successes" view — a next-step item.

**Q: Can the bandit be used to pick an LLM provider?**
A: Yes — that was the original use case in the `providers` module. The top-of-file comment in `bandit_selector.rs` explicitly mentions the "provider routing layer". Each provider is an arm; reward is "request succeeded and user accepted". But because provider choice often involves non-reward dimensions (cost / privacy preferences), the actual production scope of "bandit decides provider" gets capped by an outer policy.

**Q: Why a bandit over "let the LLM decide directly"?**
A: (1) **Explainable**: every arm's alpha/beta is visible in a PR; (2) **No hallucination**: the bandit output is a math function and never fabricates content; (3) **Convergence is provable**: with deterministic reward signal, convergence speed has a proof; (4) **Offline replay**: with a fixed seed, behavior is reproducible. The LLM is the cautionary tale on all four axes — it cannot be trusted to make critical-path decisions.

## 15. References

- Algorithm implementation: [`providers/bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs)
- Storage and feedback: [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs)
- Scene constants: [`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs)
- Arm data structure: [`providers/types.rs::BanditArmState`](../deeting/src-tauri/src/modules/providers/types.rs)
- Routing scene: [`task_learning/policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- Worker scene: [`worker_dispatch.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs)
- Memory recall: [`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs)
- Python reference implementation: `deeting_core/app/services/decision/decision_service.py`
- Tests: [`bandit_selector_tests.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector_tests.rs)
- Sibling docs: [`rag-architecture.en.md`](./rag-architecture.en.md), [`self-evolution-architecture.en.md`](./self-evolution-architecture.en.md), [`agent-dag-architecture.en.md`](./agent-dag-architecture.en.md), [`memory-architecture.en.md`](./memory-architecture.en.md), [`security-architecture.en.md`](./security-architecture.en.md)

## 16. Classic references (for deeper reading)

- Sutton & Barto, *Reinforcement Learning: An Introduction* (Chapter 2 Multi-Armed Bandits) — textbook-grade derivation
- Thompson, W.R. (1933) *On the Likelihood that One Unknown Probability Exceeds Another* — the original Thompson Sampling paper
- Auer et al. (2002) *Finite-time Analysis of the Multiarmed Bandit Problem* — UCB1 convergence proof
- Russo et al. *A Tutorial on Thompson Sampling* — modern survey

Once you have absorbed these and revisit [`bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs), you will see that each of its ~100 lines of Rust has a clear theoretical lineage. That is why we are comfortable putting it on the critical path of a desktop agent — it is not "AI mysticism", it is an engineering method backed by six decades of literature.
