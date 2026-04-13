# Desktop Task Learning Loop Architecture

**Lane:** `desktop local / runtime / task loop / feedback / policy learning`

## Goal

Define the right architecture for one narrow question:

How does one completed task leave behind useful learning so the next agent run becomes smarter?

This document intentionally does **not** decide:

- how assets should be productized
- how recap documents should be written
- how memory is physically stored

Those are later layers.

The current question is only:

What should be extracted from a task from start to finish so the brain improves next time?

## Short Answer

A useful task should leave behind three things:

- a `TaskFingerprint`
- an `EvaluatedOutcome`
- a `PolicyDelta`

The learning loop is:

`task starts -> fingerprint task -> choose path -> execute -> evaluate real outcome -> compute policy delta -> update future defaults`

The goal is not to preserve more content.

The goal is to improve the next decision.

## Core Position

The system becomes smarter when one finished task changes how the next similar task is handled.

That means the useful sediment from a task is not primarily:

- raw logs
- long prose recap
- generic memory stuffing

The useful sediment is the minimum structured signal that changes future policy.

## Current Runtime Truth

The current desktop runtime already has the right high-level execution boundaries:

- top-level route is `LocalRouteKind::{Direct, Worker}`
- executable discovery truth goes through `search_sdk`
- request-scoped capability activation goes through `attach_capability`
- bounded programmatic execution goes through `execute_code_plan`

This matters because the learning loop should improve how these boundaries are used.

It should not invent a second hidden runtime.

## The Actual Learning Spine

The most important architecture point is not any single object in this document.

It is the full transformation chain that turns one finished task into a future policy change.

That chain is:

`Reflexion-style evaluator`
`->`
`EvaluatedOutcome`
`->`
`STaR-style filtering`
`->`
`learning_eligibility`
`->`
`attribution`
`->`
`PolicyDelta`

Expanded in words:

- a Reflexion-like evaluator can help transform raw execution history into structured judgment
- a STaR-like filtering logic can decide whether this task is high-quality enough to affect learning at all
- then the system's own attribution mechanism decides where the chain first went right or wrong
- only then is a bounded, decaying, revisable `PolicyDelta` allowed to update the brain

This chain matters because external paradigms only contribute intermediate moves.

They do **not** determine the final shape of learning.

That final shape is unique to this architecture.

In particular:

- Reflexion contributes a way to critique outcomes
- STaR contributes a way to filter for update-worthy cases
- but neither Reflexion nor STaR tells us what a prior delta should look like in this runtime

That is the part this architecture must invent for itself.

## What We Borrow vs What We Must Invent

It is useful to say this explicitly.

### What we can borrow

From Reflexion:

- post-task evaluator behavior
- language-to-judgment transformation
- structured criticism of outcome quality

From STaR:

- only high-quality trajectories deserve learning
- success-path filtering is more important than transcript accumulation
- learning should prefer verified good paths over noisy raw traces

### What we cannot borrow directly

We cannot borrow the final learning object itself.

Why:

- we are not updating model weights
- we are not storing prose as the primary learning form
- we are not fine-tuning on successful reasoning chains
- we are not letting open-ended reflection directly become memory

That means the system still needs its own native learning object:

- `PolicyDelta`

And that `PolicyDelta` must be:

- bounded
- stage-attributed
- confidence-weighted
- decaying over time
- revisable by delayed feedback

This is the real invention point of the architecture.

## Why This Is The Hard Part

The unresolved hard problem is not:

- how to evaluate one task
- how to decide whether one task looked good

Those can borrow from existing paradigms.

The unresolved hard problem is this:

- in a system that does not update weights and does not use prose memory as the main learning substrate, how do we convert one task's true result into a small, safe, stage-specific, reversible policy change?

That is the core mechanism no existing external paradigm solves for us in finished form.

So the learning spine should be understood like this:

1. external paradigms help us judge and filter
2. our architecture must perform attribution
3. our architecture must define bounded policy mutation

That is the real center of the design.

## The Task Loop

### 1. Task Start

At task start, the system should extract the minimum structure of the request before it executes anything significant.

This is not the final judgment.

It is just:

- what kind of task this is
- what kind of output is wanted
- what level of risk exists
- whether discovery is likely needed
- whether execution is likely needed

This becomes the `TaskFingerprint`.

### 2. Decision

Once the task fingerprint exists, the runtime decides:

- `direct` or `worker`
- discovery depth
- whether capability attach is likely useful
- whether bounded programmatic execution is justified
- what verification posture is needed

This is where the brain acts.

### 3. Execution

The system then executes through the normal runtime path:

- discovery
- capability attach
- ordinary tools
- `execute_code_plan` when needed

This layer produces evidence.

It does not produce learning by itself.

### 4. Evaluation

After execution, the system must decide what really happened.

This is the most important missing step in many feedback systems.

The evaluation should answer:

- did the task actually succeed
- was the success partial or fragile
- did verification pass
- did the user correct the result
- was the route wasteful
- was discovery insufficient or excessive
- did the execution path look justified in hindsight

This becomes the `EvaluatedOutcome`.

### 5. Learning Update

The evaluated outcome should then produce a minimal update to future policy.

That update should say:

- strengthen this tendency
- weaken this tendency
- add caution here
- require verification here next time
- avoid this route under these conditions

This becomes the `PolicyDelta`.

### 6. Reuse

When a later task arrives, the system should not only remember facts.

It should begin with slightly better priors because of the old policy delta.

That is the real reuse.

## How The Closed Loop Actually Works

A closed loop is not created merely by storing history.

A real closed loop exists only when the result of one task can alter the way the next similar task is processed.

That requires a specific chain of mechanisms.

### 1. Bounded action space

The first precondition is that the runtime has explicit decision boundaries.

In the current desktop runtime, those boundaries already exist:

- route choice: `direct` vs `worker`
- capability discovery: `search_sdk`
- request-scoped specialization: `attach_capability`
- bounded programmatic execution: `execute_code_plan`

This matters because the system cannot learn from an opaque blob of behavior.

It can only learn when there are identifiable stages whose quality can later be judged.

In other words:

- no explicit boundary
- no clear attribution
- no reliable learning

### 2. Task fingerprinting before action

Before the runtime commits to a path, it needs a compact representation of what kind of task it is facing.

That is why the loop begins with `TaskFingerprint`.

This step matters because learning should attach to task shape, not to one literal prompt string.

Without fingerprinting, the system cannot recognize that two superficially different requests actually belong to the same decision family.

### 3. Controlled execution with observable evidence

Once the task is fingerprinted, the runtime chooses a path and executes it.

The critical requirement here is not merely execution.

It is observability.

The system must be able to observe:

- which route was chosen
- whether discovery happened
- whether capability attach happened
- whether `execute_code_plan` was used
- how many retries or errors occurred
- whether execution looked heavy or light for the task

This is what turns action into usable evidence.

If execution is not observable, it cannot become learning data.

### 4. Strict post-task evaluation

This is the true center of the loop.

The system must judge what really happened after execution, not merely what looked successful locally.

This is where `EvaluatedOutcome` comes from.

The learning loop becomes real only if the system can distinguish:

- local execution success vs user-goal success
- apparent completion vs verified completion
- route correctness vs execution correctness
- environment blockage vs method failure

This is the point where raw history is converted into usable judgment.

Without this step, the system only accumulates traces.

It does not learn.

### 5. Attribution of success and failure

A strong closed loop does not stop at saying "this task failed" or "this task succeeded."

It asks:

- what part of the chain deserves credit
- what part of the chain deserves blame

Examples:

- the fingerprint was wrong, so the route was doomed from the start
- the route was correct, but discovery was too shallow
- discovery was correct, but attach was unnecessary overhead
- execution was correct, but verification was too weak
- the whole chain looked good until delayed user correction arrived

This attribution step is what prevents the system from learning the wrong lesson.

### 6. Policy update instead of prose accumulation

Once outcome and attribution exist, the system should not primarily write a recap.

It should compute a `PolicyDelta`.

That is the point where the loop becomes adaptive.

A policy delta is the mechanism that lets the system say:

- next time do discovery earlier
- next time trust this route less
- next time require stronger verification
- next time do not escalate into execution so quickly

This is the actual engine of self-improvement.

The reason this matters is simple:

prose remembers the past, but policy changes the future.

### 7. Persistence with confidence and decay

A closed loop also needs temporal discipline.

If every outcome rewrites the brain equally, the system becomes unstable.

So learning requires two additional mechanisms:

- confidence: how strongly should this task influence future policy
- decay: how quickly should stale evidence weaken over time

This is what lets the system evolve instead of oscillate.

Without confidence, the system overreacts.

Without decay, it calcifies around old evidence.

### 8. Delayed revision

True self-learning cannot rely only on the immediate end of a task.

Some of the strongest feedback arrives later:

- the user corrects the answer in the next turn
- the same route fails again on a similar task
- a previously expensive path turns out to be the only reliable one

So the loop needs a delayed revision mechanism.

That means the brain must be able to revisit an earlier judgment and revise the policy delta if later evidence contradicts it.

This is what makes the loop self-correcting rather than self-reinforcing in the wrong direction.

## What Makes This Self-Learning Rather Than Mere Logging

The system becomes self-learning only when all of the following are true:

1. tasks are abstracted into repeatable decision families
2. execution paths are observable
3. outcomes are evaluated, not merely recorded
4. success and failure are attributed to specific stages
5. the result becomes a policy delta
6. that delta is applied to future similar tasks
7. later evidence can revise the delta

If any one of these is missing, the loop degrades:

- without abstraction, it becomes prompt memorization
- without evaluation, it becomes trace storage
- without attribution, it becomes noisy reward hacking
- without policy delta, it becomes recap generation
- without delayed revision, it becomes brittle self-confidence

## Why This Can Count As Self-Evolution

Within this architecture, "self-learning" does not mean updating model weights.

It means the system's effective behavior changes because it is re-entering future tasks with a modified policy substrate.

That modification can affect:

- route priors
- discovery priors
- capability priors
- execution priors
- verification priors

Over time, that is a form of self-evolution.

Not because the base model changed.

But because the decision system around the model became more selective, more skeptical, more calibrated, and more efficient.

## The Three Canonical Artifacts

### 1. `TaskFingerprint`

This is the structured description of what kind of task the current request appears to be.

It should be compact and decision-oriented.

Examples of what belongs here:

- task family
- desired output type
- risk level
- batch scope
- analysis vs execution pressure
- discovery need
- environment sensitivity

It should answer:

- what kind of thing is this
- what kind of path is likely appropriate

It should not answer:

- whether the task succeeded
- what should be learned afterward

### 2. `EvaluatedOutcome`

This is the structured judgment of what really happened after execution.

It should be stricter than raw tool success.

Examples of what belongs here:

- final status: success / partial / failed / blocked
- whether verification passed
- whether user correction happened
- retry count
- tool error count
- route regret or route justification
- discovery regret or sufficiency
- execution cost / latency class

It should answer:

- did the system really do the job
- what kind of failure or fragility was exposed

### 3. `PolicyDelta`

This is the only thing that should directly change the future brain.

It is not a recap.

It is a structured change request to future policy.

Examples:

- increase prior for `direct` on this task family
- require `search_sdk` earlier on this pattern
- reduce confidence in capability attach for this fingerprint
- require stronger verification for this route
- discourage `execute_code_plan` for this shape unless batch scope is present

It should answer:

- what should change next time

## Why This Three-Object Model Matters

The reason to separate `TaskFingerprint`, `EvaluatedOutcome`, and `PolicyDelta` is that each answers a different kind of question.

If they are collapsed together, the system becomes vague in exactly the way many "memory" systems become vague.

### `TaskFingerprint` answers classification

This is about:

- what the task looks like before execution
- which family it belongs to
- which path is plausible

It is forward-looking.

### `EvaluatedOutcome` answers judgment

This is about:

- what actually happened after execution
- whether the path was good, bad, fragile, or wasteful

It is retrospective.

### `PolicyDelta` answers adaptation

This is about:

- what future behavior should change because of the judgment

It is future-shaping.

This separation is important because most weak learning loops fail in one of two ways:

1. they store a lot of history without converting it into policy change
2. they overreact to one noisy outcome because they never separated task type from task judgment

The three-object split prevents both.

## Learning Eligibility: Not Every Task Should Update The Brain

One of the strongest ideas in your Hermes research is selective learning.

That idea should stay central here.

The brain should not update itself after every completed request.

It should update itself only when the task crosses a learning threshold.

### Good candidates for learning

- the task required real choice between multiple paths
- the system had to search, retry, or recover
- the user corrected the method
- the verification result contradicted the initial apparent success
- the final path was meaningfully better or worse than expected
- the same task family has now appeared multiple times

### Bad candidates for learning

- one-shot trivial answers
- requests that succeeded without any real decision pressure
- output that looked successful but was never evaluated
- interactions dominated by temporary environment noise
- cases where the task itself was too ambiguous to classify reliably

This means the learning loop needs a concept like `learning_eligibility`, even if the exact storage form is left undecided.

The system should prefer no update over a low-quality update.

## Deeper View Of `TaskFingerprint`

`TaskFingerprint` should not be a bag of tags.

It should be the smallest stable abstraction of the task that is still useful for future policy.

The key word is stable.

If the fingerprint is too literal, the system cannot generalize.

If it is too abstract, different tasks collapse into the same bucket and pollute each other.

### A good fingerprint should capture

- the kind of outcome the user wants
- the kind of reasoning pressure involved
- the kind of operational risk involved
- the likely need for capability discovery
- the likely need for execution vs answer-only behavior

### A good fingerprint should avoid

- user-specific prose details that do not affect method
- raw message wording when intent shape is what matters
- one-off file paths unless environment sensitivity is itself part of the task
- logging noise and incidental tool chatter

### Useful conceptual dimensions

- `goal_shape`: answer, transform, investigate, repair, produce, orchestrate
- `task_pressure`: direct answer, bounded execution, broad multi-step work
- `risk_class`: low, approval-sensitive, destructive, high-regret
- `scope_shape`: single target, multiple targets, batch, open-ended
- `environment_dependency`: low, medium, high
- `verification_demand`: weak, normal, strict

These do not need to be the exact field names.

They do show the right kind of abstraction level.

## Deeper View Of `EvaluatedOutcome`

`EvaluatedOutcome` is the hardest object in the loop.

This is where many systems lie to themselves.

The danger is treating the following as equivalent:

- tool call success
- model confidence
- user silence
- actual task completion

These are not equivalent.

The purpose of `EvaluatedOutcome` is to force the system to make a stricter judgment.

### An evaluated outcome should distinguish

- apparent success vs verified success
- fast success vs expensive success
- completed success vs fragile success
- blocked by environment vs blocked by method
- wrong route vs wrong execution vs wrong verification

### Example

Suppose the system calls a capability, gets a 200 response, and returns an answer.

That is not necessarily a successful task.

If the user later says "that ignored the real requirement," then the true outcome was not success.

It was at best a superficially plausible partial failure.

Without a structure that can represent that distinction, the brain will reward the wrong path.

### Outcome should include regret, not just status

This is important.

The system should be able to say things like:

- the route was correct but discovery was too shallow
- the execution was correct but verification was too weak
- the result was correct but the chosen path was unnecessarily expensive

That kind of regret signal is what makes future decisions sharpen.

## Evaluator Boundary: What `EvaluatedOutcome` May And May Not Judge

The evaluator has one job only:

- transform raw execution signals into structured judgment

It is not allowed to become:

- a policy optimizer
- a retrospective strategist
- a counterfactual oracle

If it exceeds that boundary, `EvaluatedOutcome` will contaminate `PolicyDelta`.

### Allowed judgments

#### 1. Terminal judgment

Allowed:

- `success`
- `partial`
- `failed`
- `blocked`

These judgments must rest on observable facts:

- tool results
- verification outcomes
- user response signals

Model confidence alone is not a success criterion.

#### 2. Verification judgment

Allowed:

- `passed`
- `weak_pass`
- `failed`
- `unverified`

These must remain distinct.

The evaluator must not collapse:

- no error occurred
- and
- the user goal was actually verified

`weak_pass` is especially important because many systems mistakenly treat it as `passed`.

#### 3. Path-quality judgment

Allowed:

- `route_judgment`
- `discovery_judgment`
- `execution_judgment`

These judgments must be relative to the task fingerprint, not based on absolute hindsight.

Examples:

- `wasteful` means disproportionate to `scope_shape` and `risk_class`
- `shallow` means insufficient for the discovery pressure this task required
- `unnecessary` means the action layer appears avoidable given the achieved result

#### 4. Cost and retry judgment

Allowed:

- cost class
- retry profile
- error profile

These are close to raw observations and should stay observational rather than speculative.

#### 5. User response signal

Allowed:

- `accepted`
- `corrected`
- `rejected`
- `silent`
- `unknown`

Important rule:

- `silent` is not the same thing as `accepted`

At most it can later become a weak acceptance signal if the delayed feedback window closes without contradiction.

### Forbidden judgments

#### Forbidden 1: using outcome to declare the fingerprint correct or incorrect

`EvaluatedOutcome` must not say:

- the fingerprint was wrong

Why:

- fingerprint quality is not reliably inferable from one completed task
- otherwise all failures start looking like task-classification failures
- and all successes start looking like confirmation of the original fingerprint

That creates survivorship bias.

#### Forbidden 2: counterfactual path claims

`EvaluatedOutcome` must not say:

- if we had used another route, it would have succeeded

The evaluator only owns observed reality.

It does not own counterfactual simulation.

#### Forbidden 3: equating tool success with task success

The evaluator must not promote:

- 200 response
- no exception
- file written

into:

- task success

Task success must be judged at the task level, not the tool-return level.

#### Forbidden 4: generating future method advice

`EvaluatedOutcome` must not contain:

- next time do X
- avoid Y in the future

That is `PolicyDelta` territory.

If outcome and update advice merge together, the architecture loses its causal staging.

#### Forbidden 5: path-quality judgment under environment blockage

When the dominant profile is `environment_blocked`, the evaluator should not emit strong path-quality blame.

Why:

- the causal chain from method to result is broken by an external factor

In such cases, judgment should stay weak or inconclusive.

## Deeper View Of `PolicyDelta`

`PolicyDelta` should be narrow and conservative.

It should not be a free-form summary of "things we learned."

It should be a limited set of permitted changes to future behavior.

That constraint matters because unconstrained updates eventually turn into drift.

### `PolicyDelta` should target priors, not raw behavior scripts

Examples of good deltas:

- raise prior for early discovery on this task family
- lower prior for capability attach under this fingerprint
- increase verification strictness for this route and output shape
- decrease willingness to escalate into bounded programmatic execution for small-scope cases

Examples of bad deltas:

- "always do X"
- "never use Y again"
- storing a whole prose lesson as if it were policy

The brain should move by gradients, not by brittle absolutes.

## What Should Actually Improve Over Time

The brain should get better in these specific ways.

### Better route priors

The system should improve at deciding:

- `direct` vs `worker`
- single-step vs multi-step
- answer-first vs execute-first

### Better discovery priors

The system should improve at deciding:

- when `search_sdk` is necessary
- how much search is enough
- when weak search results should be refined

### Better capability priors

The system should improve at deciding:

- whether capability attach is likely useful
- which capability family is promising
- when attach is overhead instead of leverage

### Better execution priors

The system should improve at deciding:

- when `execute_code_plan` is justified
- when ordinary direct tools are enough
- when execution is too expensive for the expected value

### Better verification priors

The system should improve at deciding:

- when verification is mandatory
- what kind of success is too weak to trust
- which task families need stricter completion checks

These are the real intelligence gains.

## Immediate Feedback vs Delayed Feedback

Another strong idea in your Hermes research is that learning quality depends on time horizon.

Immediate feedback is important, but it is not enough.

### Immediate feedback tells you

- whether the task looked successful at completion time
- whether verification passed in the same run
- whether the chosen route seemed justified

### Delayed feedback tells you

- whether the user later corrected the answer
- whether the same pattern failed again
- whether the supposed success was actually brittle
- whether a route that looked expensive was nevertheless the only reliable one

This means the brain should conceptually support two update windows:

- `online update`: a small immediate delta
- `delayed revision`: a later correction or reinforcement of that delta

Without delayed revision, the system overfits to flashy local wins.

## Positive and Negative Learning Signals

The brain should learn from both success and failure, but not in the same way.

### Positive signals

- verified completion
- low retry count
- low error count
- user acceptance without correction
- route efficiency relative to task shape

### Negative signals

- route mismatch
- shallow discovery that caused later correction
- unnecessary escalation into execution
- verification miss that allowed false confidence
- repeated attachment or execution patterns that add cost without improving outcome

### Important rule

Negative feedback should not only punish the last action.

It should locate where the reasoning chain went wrong:

- fingerprint error
- route error
- discovery error
- execution error
- evaluation error

Otherwise the system learns the wrong lesson.

## Attribution: Learn The Earliest Deviation, Not The Loudest Failure

This is one of the hardest parts of the whole architecture.

Errors cascade.

If `TaskFingerprint` is wrong, then route, discovery, and execution can all fail downstream. If the system blames only the most visible failure at the end of the chain, it will correct the wrong layer and repeat the same upstream mistake on the next similar task.

So the first rule of attribution is:

- find the earliest meaningful deviation
- not the loudest visible failure

That is the only way the loop improves the real cause instead of its downstream symptom.

### Why attribution is structurally hard

The chain is layered:

- fingerprint shapes route
- route shapes discovery intensity
- discovery shapes whether execution has enough information
- execution produces evidence that evaluation judges

If the system only asks "what failed?", it will often land on execution because that is where failure becomes visible.

But the more important question is:

- where did the path stop being well-founded?

That may be much earlier.

### Stage-separated signals

To attribute correctly, each stage must have its own observable success or failure conditions.

Without stage-local signals, attribution collapses into a generic failure label.

#### Fingerprint error signals

- the system is forced to pivot mid-task into a fundamentally different path
- `route_judgment == wrong` while `execution_judgment == justified`
- the same apparent fingerprint family repeatedly succeeds only after radically different downstream paths

Interpretation:

- execution may have been reasonable given the selected route
- but the route itself should never have been selected
- which points further upstream to task classification

#### Route error signals

- `final_status == success` but `route_judgment == wasteful`
- `cost_class == disproportionate` for a narrow or single-target task
- the task succeeded, but the chosen route clearly overshot the required complexity

Interpretation:

- the system got the job done
- but learned the wrong path shape

This is route error, not execution error.

#### Discovery error signals

- `discovery_judgment == shallow` and execution fails or is fragile
- execution errors are recoverable and look like missing preconditions rather than bad action logic
- `discovery_judgment == excessive` with high cost and no corresponding value gain

Interpretation:

- the direct upstream cause is information quality or search discipline
- not necessarily route selection and not necessarily execution logic

#### Execution error signals

- `discovery_judgment == sufficient` but execution still fails
- retries are heavy even though required information was already present
- the route and discovery posture were plausible, but the action layer could not reliably complete

Interpretation:

- the system knew enough
- it just failed to turn knowledge into correct action

#### Evaluation error signals

- `verification_result == passed` but later `user_response_signal == corrected`
- the system marked success too early
- delayed evidence exposes that the completion criteria were wrong or too weak

Interpretation:

- the deepest problem is not route or execution
- it is the evaluator's success standard

### Primary blame must be singular

Many tasks will have multiple bad properties.

Even so, the loop should assign one `primary_blame_stage` for learning purposes.

Why:

- if multiple stages all receive the same blame, every prior moves at once
- the system becomes noisy and over-reactive
- downstream stages get punished for upstream mistakes

The correct default is:

- choose one primary blame stage
- prefer the earliest justified stage
- treat later-stage issues as secondary annotations, not primary update targets

### Practical attribution rule

The loop should not ask:

- where did failure become visible

It should ask:

- what is the earliest stage we have enough evidence to blame

That means a reasonable operational order is:

1. check for verification or evaluation failure first
2. then check whether route was wrong while execution remained justified
3. then check whether discovery was insufficient or excessive
4. only then blame execution itself

This keeps downstream failure from absorbing blame that belongs upstream.

### Misattribution guards

Two guards are especially important.

#### Guard 1: Do not treat environment blockage as method failure

If the error profile is dominated by environment failure, method priors should usually not update.

Otherwise the system learns:

- "this task family is bad"

when the real lesson is only:

- "that environment instance was bad"

Environment noise must be isolated from method learning.

#### Guard 2: Do not treat result correctness as path correctness

A successful final result does not prove the path was good.

The loop must preserve regret even on successful tasks:

- success with disproportionate cost
- success with unnecessary escalation
- success after obviously avoidable exploration

Otherwise the system becomes overconfident in wasteful methods.

## Which Blame Types Are Allowed To Move Priors

Not every blame type should update future priors.

For a blame type to move a prior, it should satisfy both:

- it reflects a repeatable decision-quality problem
- there is a clear prior dimension the system can actually adjust

If either condition fails, the signal should remain secondary evidence only.

### Blame types that may move priors

#### Route blame -> route prior

Allowed when:

- `route_judgment == wasteful` with clear scope mismatch
- or `route_judgment == wrong` with direct observable justification

This should move route preference only modestly unless repetition confirms it.

#### Discovery blame -> discovery prior

Allowed when:

- `discovery_judgment == shallow` and downstream fragility or failure follows from that lack
- or `discovery_judgment == excessive` with disproportionate cost and low added value

Discovery blame should only move priors when the causal chain from discovery quality to outcome quality is visible.

#### Execution blame -> execution prior

Allowed when:

- `execution_judgment == unnecessary` and the task still succeeded
- or execution failed even though discovery looks sufficient
- or retries are heavy despite sufficient upstream information

This adjusts willingness to escalate into bounded execution, not whether execution exists at all.

#### Verification blame -> verification prior

Allowed when:

- verification looked adequate locally but later user correction proved otherwise
- or repeated weak-pass patterns show that the current completion standard is too lax

This is the prior most naturally driven by delayed feedback.

### Blame types that should stay secondary evidence

#### Fingerprint blame

Fingerprint blame should usually not directly move priors from a single task.

Why:

- task classification quality is a cross-task question
- single-task hindsight creates survivorship bias

Fingerprint concerns should accumulate as secondary evidence until a pattern is clear enough for a more deliberate schema review.

#### Environment-blocked blame

Environment failure should not directly mutate method priors.

Otherwise the system learns to distrust task families that may be perfectly sound.

#### Single dramatic failure without corroboration

One striking failure should usually mark a task family as high-observation, not immediately push a large delta.

#### Evaluator-internal blame

If the issue is that the evaluator itself made the wrong judgment, that should trigger scrutiny of the evaluation layer, not arbitrary mutation of route or execution priors.

## PolicyDelta Update Law

The second hardest part of the architecture is not what a delta says, but how large it is allowed to be.

This is where many systems turn into noise amplifiers.

The update law should be conservative by default and evidence-weighted.

### Core update shape

Conceptually, a prior update should be driven by three factors:

- a small base step
- confidence in the evaluated outcome
- repetition weight from aligned evidence within the same task family

In words:

- one event should move the prior only a little
- trustworthy outcomes should move it more than weak outcomes
- repeated aligned evidence should matter more than isolated drama

A useful shorthand is:

`Delta(prior) = base_step * outcome_confidence * repetition_weight`

This is not a fixed final formula.

It is the right shape.

### Base step must stay small

A single task should almost never have the power to strongly rewrite future behavior.

That means:

- single-task updates should be weak
- large deltas should require corroboration

This keeps the system adaptive without making it twitchy.

### Confidence must scale the update

Not every evaluated outcome deserves equal weight.

Low-confidence cases include:

- unverified apparent success
- ambiguous user response
- unclear blame stage
- noisy or environment-dominated failures

Those cases should produce very small deltas or no delta at all.

### Repetition should matter more than intensity

Aligned evidence from repeated similar tasks should strengthen a delta more than one dramatic event.

This is important because:

- one spectacular failure may be noise
- repeated medium-strength failures are much stronger evidence of a structural problem

The system should prefer cumulative confirmation over one-shot drama.

## Cases Where The Brain Should Not Update At All

There are at least three important no-update cases.

### 1. `learning_eligibility == false`

Do not update when:

- there was no real decision pressure
- the task was trivial
- the task was too ambiguous to classify confidently
- the run does not teach anything reusable

### 2. Environment noise dominates

If the dominant explanation is environmental blockage, do not mutate method priors.

### 3. Strong isolated event with no history

Even a dramatic failure should usually not produce a large prior move if this is the first meaningful event in that task family.

## When The Brain Should Not Update

A serious learning system must know when not to learn.

Three cases are especially important.

### 1. No real learning eligibility

Do not update when:

- the task was trivial
- no real choice or pressure existed
- the task was too ambiguous to classify reliably
- the outcome does not teach anything reusable

### 2. Environment noise dominates

Do not update method priors when the main failure driver is environmental blockage.

Otherwise the system will learn to fear task families that are actually fine.

### 3. The event is strong but isolated

Even a dramatic failure should not create a large delta if it is the first data point for that task family.

The architecture should be biased toward skepticism on first contact.

## Provisional vs Confirmed Learning

A useful way to think about deltas is in two stages:

- `provisional`
- `confirmed`

### Provisional delta

This is the default after a single task.

Characteristics:

- low magnitude
- easy to revise
- treated as tentative evidence

This is the right default after a single task.

### Confirmed delta

This happens only after repeated corroboration.

Characteristics:

- larger magnitude
- slower to reverse
- treated as stable policy evidence

This two-stage design creates a healthy asymmetry:

- early learning is cheap and correctable
- mature learning is stronger but demands proof

## Delayed Feedback Reversal Discipline

Delayed feedback should not reverse all learning equally.

### Weak provisional delta

One later strong contradiction may be enough to reverse it.

### Medium-confidence delta

It should take more than one contradictory signal, or one contradiction plus further aligned weakness.

### Strong mature delta

It should require sustained opposing evidence over time before reversal.

This keeps the system corrigible early and stable later.

## Delayed Feedback Revision Rules

Delayed feedback should not be an afterthought.

It is the main defense against false confidence.

### Weak provisional deltas

If an earlier delta was weak and provisional, one strong contradiction may be enough to reverse it.

Examples:

- immediate pass, later explicit user correction
- first success, then immediate repeat failure on same family

### Medium-confidence deltas

If the delta has some corroboration, it should take more than one contradiction to reverse.

Examples:

- multiple later corrections
- one correction plus another aligned failure signal

### Strong deltas

If the delta has strong repeated support, reversal should require persistent counter-evidence over time.

This prevents the brain from discarding valid experience because of one outlier.

## Decay

Not all learning should live forever.

If a task family goes stale, its influence should gradually weaken.

Why:

- environments change
- tool availability changes
- previously expensive paths may become cheap
- previously reliable paths may become obsolete

Decay prevents the brain from becoming a fossilized record of old conditions.

## Asymmetry Between Positive and Negative Learning

Positive and negative learning should not be perfectly symmetric.

### Positive updates

Positive signals should require repetition before they become strong.

Why:

- apparent success is often easier to fake than it seems
- one good run does not prove a path is robust

### Negative updates

Negative signals should first reduce confidence before they ban or strongly suppress a path.

Why:

- a route may fail for contingent reasons
- prematurely banning a path can close off useful future options

So the architecture should be conservative in both directions, but in different ways:

- positive learning needs proof before strong promotion
- negative learning should weaken gradually before it forbids

## Attribution -> PolicyDelta Interface Contract

This is the critical handoff.

`EvaluatedOutcome` should output:

- structured fields only
- no method advice
- no counterfactual claims
- no direct fingerprint verdict

`Attribution` should output:

- one `primary_blame_stage`
- zero or more `secondary_evidence` notes

Only the primary blame stage is allowed to generate a `PolicyDelta`.

Secondary evidence is retained for future corroboration, schema review, or evaluator review, but it does not move priors immediately.

`PolicyDelta` should only accept:

- an allowed blame type
- an outcome with sufficient confidence
- evidence that maps cleanly onto an adjustable prior dimension

If any of those are missing, the correct output is:

- no delta

## What Hermes Gets Right At The Thought Level

The useful lesson from Hermes is not its exact storage or skill format.

The useful lesson is that intelligence growth needs a high-signal, selective, post-task update path.

Three thought-level takeaways matter here.

### 1. Not every interaction deserves learning

A real learning loop should not treat every turn as equally valuable.

Learning should be more likely when:

- the task was non-trivial
- the system had to search or retry
- the user corrected the method
- the final path was clearly better than the initial path
- the result was verified, not merely produced

This means the learning loop needs a high-signal extraction rule, not a blanket transcript hoarding rule.

### 2. Evaluation matters more than narration

The system should not confuse:

- describing what happened
- with judging what should be learned

A strong system learns from evaluated outcomes, not from verbose summaries.

That means post-task processing should focus on:

- what was the true result
- what was wasteful
- what was misleading
- what improved the odds of success

### 3. Learning should update method, not only content

The most valuable sediment from a task is often not a new fact.

It is a change in method.

Examples:

- discovery should happen earlier
- this route should be avoided for this task shape
- verification should be stricter here
- capability attach usually helps only after search result confidence crosses a threshold

This is why `PolicyDelta` matters more than a recap paragraph.

## The Real Unit Of Learning Is Decision Quality

This is the key architectural principle.

The system is not trying to maximize:

- number of stored memories
- number of summaries
- number of reusable notes

The system is trying to maximize:

- future decision quality under uncertainty

That reframes the whole loop.

The correct question after a task is not:

- what should we remember

It is:

- what future decision should now become easier, earlier, safer, or more accurate

That is the right interpretation of becoming smarter.

## What Should Not Be The Primary Sediment

The following may still be useful for observability or human audit, but they should not be treated as the primary learning product:

- raw full transcripts
- tool logs by themselves
- recap markdown
- generic note accumulation
- one-off environment clutter

These may preserve information.

They do not automatically improve future judgment.

## The Role Of Code Mode

`code mode` is still important, but only as one execution surface inside the task loop.

Its role here is:

- provide a bounded programmatic path
- expose rich evidence when complex execution happens
- make success and failure more legible than pure answer-only turns

Its non-role is:

- defining what learning is
- being the center of the loop
- deciding what the system should remember

So for this document, `code mode` matters only because it can enrich `EvaluatedOutcome`.

It is not the learning subject.

## What The Brain Needs To Retain

If we ignore storage format and only think conceptually, the brain needs to retain:

- task-family tendencies
- route tendencies
- discovery tendencies
- capability tendencies
- verification tendencies
- failure signatures
- confidence and decay

This is policy-shaped memory, not prose-shaped memory.

## What Already Exists In The Current Runtime

The current repo already has several fragments that resemble a future learning loop.

### Existing route boundary

Already present:

- `LocalRouteKind::{Direct, Worker}`

This gives a real route decision surface that future policy can improve.

### Existing discovery gate

Already present:

- `search_sdk` as the capability-discovery primitive

This gives a real discovery behavior that can become more or less aggressive over time.

### Existing execution surface

Already present:

- `attach_capability`
- `execute_code_plan`

These give real execution choices that can be reweighted by later outcomes.

### Existing local feedback fragments

Already present:

- `router:prompt` bandit selection
- `search_feedback`
- `tool_query_affinity`

These are not yet the full learning loop, but they prove the runtime already has places where policy-like adaptation exists.

## Failure Modes To Avoid

### 1. Transcript hoarding

The system stores everything, then calls that learning.

This increases weight, not intelligence.

### 2. Tool-success illusion

The system rewards successful execution primitives even when the user goal was missed.

This creates brittle self-confidence.

### 3. Overreaction to one outcome

The system applies a large delta after one noisy task.

This makes policy unstable.

### 4. Mixing facts with priors

The system stores facts, preferences, and route tendencies in one bucket.

This makes it impossible to know what should decay and what should remain stable.

### 5. No delayed correction path

The system never revises early judgments after later evidence arrives.

This causes persistent false learning.

## What Is Missing Right Now

### Missing 1: A stable `TaskFingerprint`

The runtime still needs a canonical way to say:

- what kind of task this is before execution

Without this, similar tasks cannot be grouped reliably.

### Missing 2: A canonical `EvaluatedOutcome`

The system still lacks one stable judgment object that says:

- what really happened after the task completed

Without this, learning remains split across raw tool metadata, local heuristics, and scattered traces.

### Missing 3: An explicit `PolicyDelta`

The system still needs a first-class way to say:

- what future default should change because of this outcome

Without this, there is storage and telemetry, but not real intelligence growth.

### Missing 4: Delayed feedback

The brain should not learn only from the immediate final turn.

It should also care about:

- user correction in later turns
- repeated failure on the same task family
- later confirmation that the result was truly good

Without delayed feedback, the loop will over-trust flashy but brittle successes.

### Missing 5: Separation between content memory and policy learning

Facts and preferences are not the same thing as decision priors.

If these are mixed together, the brain becomes heavier, not sharper.

## Minimal Direction

The clean next-step direction is:

1. define the minimum `TaskFingerprint`
2. define the minimum `EvaluatedOutcome`
3. define the allowed `PolicyDelta` categories
4. make future learning operate only through those deltas

## Immediate Next Questions

The next serious design questions are now narrower and better formed:

1. What is the minimum stable field set for `TaskFingerprint`?
2. What makes an `EvaluatedOutcome` strong enough to update policy?
3. Which policy priors are allowed to move, and which must stay hard-coded?
4. How large can a `PolicyDelta` be after one task?
5. How should delayed feedback revise earlier deltas?

That keeps the learning loop narrow, high-signal, and actually useful.

## Field Philosophy For `TaskFingerprint`

The most important question is not "what can we extract?"

It is:

- what must remain stable across superficially different phrasings
- what actually affects method choice
- what will still matter after the literal wording is forgotten

That leads to four field rules.

### Rule 1: Prefer method-relevant fields over content-rich fields

Good fingerprint fields change execution policy.

Examples:

- whether the task is answer-oriented or execution-oriented
- whether the task is low-risk or approval-sensitive
- whether the task is narrow-scope or batch-scope

Bad fingerprint fields merely preserve text.

Examples:

- full natural-language request body
- arbitrary quotes from the prompt
- incidental filenames that do not affect policy

### Rule 2: Prefer low-cardinality abstractions

If a field can take too many values, it becomes a hidden transcript.

For learning, fields should usually compress into a small set of categories.

Examples:

- `risk_class`: `low | approval_sensitive | destructive | high_regret`
- `scope_shape`: `single | multi | batch | open_ended`
- `goal_shape`: `answer | investigate | transform | repair | orchestrate`

This helps the system generalize across requests instead of memorizing one prompt at a time.

### Rule 3: Separate intent shape from environment shape

Two tasks may have the same abstract goal but very different environmental constraints.

The fingerprint should preserve that distinction.

Examples:

- same goal, different environment dependency
- same repair task, different approval sensitivity
- same transformation task, different verification demand

If intent and environment are collapsed together, the system learns noisy priors.

### Rule 4: Keep the fingerprint pre-outcome

`TaskFingerprint` should describe the task before the system knows whether it succeeded.

This prevents hindsight from leaking into the task classifier.

That separation matters because:

- otherwise route errors get hidden inside the task definition
- failed tasks look like different task families after the fact

## Proposed Minimum `TaskFingerprint` Shape

A strong minimum fingerprint likely needs only a small set of fields.

Not final schema names, but the right conceptual fields are:

- `goal_shape`
- `output_shape`
- `scope_shape`
- `risk_class`
- `execution_pressure`
- `discovery_pressure`
- `environment_dependency`
- `verification_demand`

### Suggested semantics

`goal_shape`

- what the user is fundamentally trying to do
- examples: answer, investigate, transform, repair, produce, orchestrate

`output_shape`

- what kind of result the user expects back
- examples: explanation, action taken, changed state, artifact, comparison, diagnosis

`scope_shape`

- how wide the task is
- examples: single target, multiple targets, batch, open-ended

`risk_class`

- how much regret the wrong move would create
- examples: low, approval-sensitive, destructive, high-regret

`execution_pressure`

- whether the task naturally wants action rather than analysis
- examples: low, medium, high

`discovery_pressure`

- how necessary capability or environment discovery is before acting
- examples: low, medium, high

`environment_dependency`

- how much the right method depends on local runtime truth
- examples: low, medium, high

`verification_demand`

- how strong the completion standard should be
- examples: weak, normal, strict

## Field Philosophy For `EvaluatedOutcome`

If `TaskFingerprint` is about stable task identity, `EvaluatedOutcome` is about disciplined judgment.

Its fields should not merely describe activity.

They should support diagnosis.

### Rule 1: Outcome fields must distinguish apparent success from true success

This is the central rule.

The system needs to represent at least:

- raw execution succeeded
- task goal actually succeeded
- goal was only partially met
- result was later contradicted

If those collapse into one `success=true`, the loop becomes self-deceptive.

### Rule 2: Outcome fields must support blame localization

The loop should be able to infer where the failure lived:

- fingerprint problem
- route problem
- discovery problem
- execution problem
- evaluation problem

Not every failed task is an execution failure.

Sometimes execution worked and the route was wrong.

Sometimes the route was right and verification was weak.

### Rule 3: Outcome fields must represent quality, not just status

Binary success/failure is too crude.

The outcome should preserve:

- fragility
- wastefulness
- avoidable retries
- unnecessary cost
- user dissatisfaction despite nominal completion

### Rule 4: Outcome must accept later revision

The first evaluation should not be treated as final truth forever.

If delayed feedback arrives, the outcome model should conceptually allow:

- downgrade
- reinforcement
- correction

That protects the brain from early false confidence.

## Proposed Minimum `EvaluatedOutcome` Shape

A strong minimum outcome likely needs these conceptual fields:

- `final_status`
- `verification_result`
- `user_response_signal`
- `route_judgment`
- `discovery_judgment`
- `execution_judgment`
- `cost_class`
- `retry_profile`
- `error_profile`
- `confidence`

### Suggested semantics

`final_status`

- success, partial, failed, blocked

`verification_result`

- unverified, passed, weak_pass, failed

`user_response_signal`

- accepted, silent, corrected, rejected, unknown

`route_judgment`

- good, acceptable, wasteful, wrong

`discovery_judgment`

- sufficient, shallow, excessive, skipped_when_needed

`execution_judgment`

- justified, unnecessary, fragile, failed

`cost_class`

- low, medium, high, disproportionate

`retry_profile`

- none, light, heavy, looping

`error_profile`

- none, recoverable, structural, environment_blocked

`confidence`

- how strongly this outcome should be allowed to influence future policy

## Field Philosophy For `PolicyDelta`

`PolicyDelta` is where discipline matters most.

If it is too weak, no intelligence accumulates.

If it is too broad, the brain drifts.

### Rule 1: A delta should only move policy, not rewrite identity

It should change tendencies.

It should not redefine the whole agent.

### Rule 2: A delta should target one or a small number of priors

Good deltas are local.

Examples:

- bump route prior
- lower attach prior
- strengthen verification prior

Bad deltas are sprawling and unfalsifiable.

Examples:

- broad narrative lessons
- vague "be more careful" style updates

### Rule 3: A delta should have bounded magnitude

No single task should be allowed to radically rewrite future behavior unless the evidence is extremely strong.

The system should conceptually prefer:

- small updates after one event
- stronger updates after repeated confirmation
- reversibility when later evidence disagrees

### Rule 4: A delta should be traceable back to outcome evidence

Every policy shift should be explainable in terms of outcome evidence.

Otherwise the system cannot tell learning from drift.

## Allowed `PolicyDelta` Categories

A disciplined first version should only allow a narrow set of delta categories.

### Route deltas

- strengthen or weaken `direct`
- strengthen or weaken `worker`

### Discovery deltas

- require earlier `search_sdk`
- reduce unnecessary discovery on stable task families
- increase refinement pressure when weak results are common

### Capability deltas

- strengthen or weaken attach likelihood
- strengthen or weaken confidence in a capability family under a fingerprint

### Execution deltas

- strengthen or weaken escalation into `execute_code_plan`
- raise the threshold for programmatic execution when simpler paths repeatedly suffice

### Verification deltas

- require stronger checks before return
- allow lighter verification only when repeated evidence supports it

These categories are intentionally narrow.

They make the loop learn method without pretending it has solved the whole problem of intelligence.

## Update Discipline

To keep the brain stable, updates should obey a few simple principles.

### Small by default

Single-task updates should usually be weak.

### Repetition beats intensity

Repeated similar evidence should outweigh one dramatic event.

### Negative evidence should decay confidence before banning behavior

The system should usually weaken a prior before it forbids a path.

### Delayed correction should outrank immediate apparent success

If the user later corrects the result, that later evidence should be able to revise the earlier delta.

### Unknown should stay unknown

When the task was too ambiguous or the outcome too weakly evaluated, the best update may be no update.

## Why This Matters For The Next Design Phase

Once these field philosophies are explicit, the next phase stops being vague.

We can then ask more concrete questions:

- which of these conceptual fields already exist implicitly in current runtime metadata
- which ones need new explicit structure
- which ones should be hard-coded policy instead of learned policy
- which ones should be updated online vs only after delayed confirmation

That is the point where the design can move from architectural theory into a trustworthy learning contract.

## Correct Implementation Form: Layered Decision Injection

The right implementation shape is not:

- one central prompt containing all priors
- one central agent that remembers everything
- one reflective pass that writes a narrative summary

The right implementation shape is:

- each prior takes effect at the layer where the original decision is made

That is the core reason this architecture can stay sharp.

If all prior knowledge is injected through one general prompt, the LLM can ignore it, reinterpret it, or dilute it inside broader reasoning. The learning signal becomes advisory rather than structural.

The stronger design is:

- route priors act in the router
- discovery priors act at discovery gate points
- capability priors act at capability-attach gate points
- execution priors act at escalation gate points
- verification priors act at completion judgment gates

This is layered decision injection.

## Layer 1: Router-Level Injection

Route choice happens before the main LLM execution loop.

So route prior should not be presented as prompt advice.

It should be consumed directly by router logic.

Conceptually:

`task arrives`
`-> TaskFingerprint`
`-> policy_store.query(fingerprint, route)`
`-> route prior influences direct vs worker selection`

This is the cleanest form because:

- route is already an infrastructure-layer decision
- the router already owns this boundary
- letting the LLM reinterpret route prior would weaken attribution

This layer should remain deterministic or near-deterministic.

The LLM does not need to be asked whether a route prior exists.

The infrastructure should already know.

## Layer 2: Tool-Gated Policy Query During Execution

Discovery, capability attach, and execution escalation all happen inside the runtime loop, after the task has already entered the LLM-driven phase.

These decisions should not be hard-coded blindly, and they should not be buried inside a large system prompt either.

The correct form here is:

- a policy query tool the agent can call at specific decision points

Conceptually:

- `query_task_policy(fingerprint, discovery)`
- `query_task_policy(fingerprint, capability_attach)`
- `query_task_policy(fingerprint, execution_escalation)`

This returns structured priors, not prose.

Why this is correct:

- the query itself is observable
- the decision point is explicit
- the returned prior is attributable
- the downstream agent choice can be inspected against that prior

This is much better than prompt injection because it preserves the learning trace:

- what did the agent ask
- what prior did it receive
- what did it do next

That trace is exactly what future attribution needs.

## Layer 3: Verification Gate Injection

Verification prior should not act like route prior.

It does not decide which path to run.

It decides what counts as enough evidence to call the task done.

So it belongs after execution and before final completion marking.

Conceptually:

`execution completes`
`-> query verification policy`
`-> enforce strictness`
`-> only then allow final success`

This should be implemented as a structured completion gate, not as soft language advice.

That is especially important because many false-learning loops begin by over-trusting weak completion signals.

If verification prior lives only in prompt text, it is too easy for the LLM to smooth over a weak result and still label the task as done.

## Shared Foundation: Policy Store

All of these layers require one common substrate:

- a `policy_store`

The policy store is the persistent carrier of priors.

Its conceptual key is:

- `fingerprint_family x decision_point`

Its conceptual value needs at least:

- prior weight
- confidence
- evidence count
- last updated time
- decay behavior
- whether the prior is still provisional

This store is the persistent part of the brain.

It should not be confused with:

- generic memory
- transcript logs
- prose recap

Its job is not to remember what happened in narrative form.

Its job is to preserve how much the next decision should be biased.

## Read Path And Write Path

The store has two different paths.

### Read path

At decision time:

- compute fingerprint
- query policy store for the relevant decision point
- apply decay
- inject the resulting prior into the decision layer

### Write path

At task end:

- generate `EvaluatedOutcome`
- run attribution
- compute `PolicyDelta`
- update the relevant decision-point prior

This read/write split matters because it prevents learning from becoming a loose side effect.

The brain is only allowed to change through the write path.

## Full Execution Flow

The resulting architecture looks like this:

### Task start

- task arrives
- fingerprint is generated

### Pre-LLM route decision

- router queries route prior
- direct vs worker is chosen with infrastructure-level logic

### In-loop policy-sensitive decisions

During agent execution:

- before discovery: query discovery prior
- before capability attach: query attach prior
- before escalation into `execute_code_plan`: query execution prior

The agent does not receive one giant policy sermon.

It receives decision-local priors at the point where they actually matter.

### Completion gate

After execution:

- verification policy is queried
- strictness of completion judgment is enforced

### Post-task learning

- raw trace is transformed into `EvaluatedOutcome`
- attribution produces primary blame and secondary evidence
- `PolicyDelta` is computed
- policy store is updated

This gives a full closed loop where learning changes the exact layers that generated the original decisions.

## Where LLM Should And Should Not Participate

This part is critical.

Not every step should involve the model.

### LLM should not own:

- route prior lookup
- policy store reads/writes
- delta computation
- decay application
- final blame-to-prior mapping

These should remain mechanical and inspectable.

### LLM may participate in:

- generating certain judgment fields inside `EvaluatedOutcome`

This is where a constrained evaluator call can be useful.

Examples of fields that may benefit from constrained classification:

- `route_judgment`
- `discovery_judgment`
- `execution_judgment`

But even here, the role of the LLM must stay narrow:

- classification
- under strict schema
- using observable trace input
- with no method advice
- with no counterfactual speculation

This is not a second planner.

It is a constrained evaluator.

## Why Prompt Injection Is The Wrong Primary Mechanism

A central prompt that says:

- this task family usually prefers direct
- be careful with discovery
- do not escalate too early

looks tempting, but it is the wrong default implementation form.

Why:

- prompt influence is diffuse
- compliance is hard to attribute
- the model can reinterpret or ignore it
- multiple priors get blended into one fuzzy reasoning space

Layered decision injection is stronger because the prior acts exactly where the decision happens.

This keeps learning structural rather than rhetorical.

## Why This Implementation Shape Preserves Learning Integrity

This design has three major advantages.

### 1. Attribution remains clean

Because each prior acts at its native decision layer, later failure can be traced back more precisely.

### 2. Learning cannot be easily washed out by general reasoning

A route prior used in router logic is harder to dilute than a sentence in a prompt.

### 3. The system stays inspectable

At every stage we can ask:

- what prior was read
- where it was applied
- what decision followed
- what outcome resulted

That is exactly what a trustworthy self-learning architecture needs.

## Constrained Evaluator Call Design

The only place where an LLM should participate in the learning loop itself is inside a narrow evaluator step.

Even there, the model must not be treated as:

- a planner
- a strategist
- a route optimizer
- a memory writer

It should be treated as a constrained classifier operating over observable traces.

## Why A Constrained Evaluator Is Needed

Some `EvaluatedOutcome` fields are easy to generate mechanically.

Examples:

- retry count
- tool error count
- whether verification happened
- whether user correction arrived
- whether `execute_code_plan` was called

But some judgment fields are not trivial to derive from pure rules alone.

Examples:

- was discovery merely shallow or actually sufficient
- was the route merely acceptable or genuinely wasteful
- was execution justified or unnecessary

These are classification questions over structured evidence.

This is where a constrained evaluator call is useful.

## What The Evaluator May Read

The evaluator should consume only structured, observable evidence.

Examples of allowed inputs:

- `TaskFingerprint`
- route taken
- discovery steps taken
- capability attach attempts
- tool-call sequence
- retry count
- error profile
- verification signals
- user response signals
- high-level execution trace summary

This input should be prepared mechanically before the model sees it.

That keeps the evaluator grounded in runtime truth rather than free-form narrative.

## What The Evaluator May Output

The evaluator should output only structured judgment fields.

Typical examples:

- `route_judgment`
- `discovery_judgment`
- `execution_judgment`
- evaluator-side `confidence`

These outputs should be restricted to closed enums and numeric bounds.

The evaluator should not be allowed to produce arbitrary prose as the primary result.

## What The Evaluator Must Not Do

The evaluator must be explicitly forbidden from:

- giving method suggestions
- recommending future behavior
- deciding `PolicyDelta`
- judging fingerprint correctness directly
- making counterfactual claims about paths not taken
- inventing hidden causes not supported by the trace

Its task is not:

- what should we do next time

Its task is only:

- how should this observed path be classified

## Why This Is Not A Second Planner

This distinction matters.

If the evaluator starts producing strategy or advice, the architecture collapses:

- `EvaluatedOutcome` becomes mixed with `PolicyDelta`
- attribution loses clean inputs
- delayed feedback cannot reliably revise earlier judgments

A planner asks:

- what should happen next

A constrained evaluator asks:

- how should this already-finished trace be classified

Those are fundamentally different roles.

## Strict Schema Requirement

The evaluator output should be schema-constrained.

That means:

- no free-text explanation as the primary payload
- enums for judgment fields
- bounded confidence value
- invalid outputs rejected or repaired mechanically

The architecture should treat evaluator output the same way it treats any other untrusted model output:

- parse
- validate
- reject if malformed

This is especially important because the evaluator is feeding a learning loop.

If malformed or overcreative evaluator output is accepted, the system will learn from hallucinated structure.

## Recommended Evaluator Contract

Conceptually, a minimal evaluator contract looks like:

- input: fingerprint + route/discovery/execution trace + verification/user signals
- output:
  - `route_judgment`
  - `discovery_judgment`
  - `execution_judgment`
  - `confidence`

All other outcome fields should remain mechanical where possible.

This keeps LLM participation narrow and localized.

## Mechanical First, LLM Second

The default philosophy should be:

- if a field can be generated mechanically, do not ask the LLM
- only ask the evaluator for fields that genuinely require trace-level classification

That keeps the loop:

- cheaper
- more stable
- easier to debug
- less prone to self-deceptive learning

## How This Fits The Full Loop

The full sequence should now be understood as:

1. runtime executes task
2. mechanical trace summary is built
3. constrained evaluator classifies a narrow set of judgment fields
4. full `EvaluatedOutcome` is assembled
5. attribution consumes that outcome
6. only then can `PolicyDelta` be computed

That ordering is important.

It means the evaluator is upstream of attribution, but downstream of execution truth.

It never directly touches the learning substrate.

## End-of-Task Learning Pipeline

At this point the architecture can be described as one full post-task pipeline.

This is the cleanest way to see how the loop closes.

### Step 1: Build `TaskFingerprint`

Before meaningful execution begins, the runtime builds the task fingerprint.

This gives the system:

- task family
- scope shape
- risk class
- discovery pressure
- execution pressure
- verification demand

This is the reference frame for all later judgment.

### Step 2: Make route and execution decisions with layered priors

The runtime uses current policy priors at the correct decision layers:

- router-level route priors
- in-loop policy queries for discovery, capability attach, and execution escalation
- verification priors at completion gate time

This produces a concrete execution path.

### Step 3: Collect raw trace

During execution, the system records raw observable evidence:

- route chosen
- tools called
- discovery attempts
- capability attach attempts
- retries
- errors
- execution duration/cost class
- verification signals
- user response signals

This is still not learning data.

It is only raw material.

### Step 4: Build mechanical trace summary

Before any evaluator call happens, the runtime should condense raw trace into a structured summary.

This step should remain mechanical.

Why:

- it keeps evaluator inputs grounded
- it reduces noise
- it prevents the LLM from seeing unnecessary raw transcript clutter

The trace summary should be just rich enough to support classification.

### Step 5: Run constrained evaluator on judgment fields only

The constrained evaluator is invoked only for narrow classification questions.

It should classify:

- `route_judgment`
- `discovery_judgment`
- `execution_judgment`
- evaluator confidence

It should not produce:

- advice
- policy changes
- fingerprint verdicts
- counterfactual claims

This step enriches the outcome without taking over the loop.

### Step 6: Assemble `EvaluatedOutcome`

Now the runtime combines:

- mechanical outcome fields
- constrained evaluator judgments
- verification and user-response signals

into one complete `EvaluatedOutcome`.

This is the first point where the system has a legitimate, learning-grade account of what happened.

### Step 7: Check `learning_eligibility`

Before attribution or delta computation, the system asks:

- should this task update the brain at all?

If the answer is no, the pipeline stops here.

This is a critical guardrail.

It prevents:

- trivial tasks
- ambiguous tasks
- environment-dominated failures
- weakly evaluated pseudo-successes

from entering the learning channel.

### Step 8: Run attribution

If the task is learning-eligible, attribution consumes the evaluated outcome and chooses:

- one `primary_blame_stage`
- zero or more `secondary_evidence` annotations

Only the primary blame stage is allowed to influence priors directly.

This is what keeps the loop from amplifying every downstream symptom.

### Step 9: Decide whether delta is `none`, `provisional`, or `confirmed`

At this stage the system should decide not just what direction a delta points in, but what maturity level it has.

Possible outcomes:

- `none`
- `provisional`
- `confirmed`

This depends on:

- outcome confidence
- evidence count
- repetition
- delayed correction status

This is the transition point between judgment and learning.

### Step 10: Compute `PolicyDelta`

Only now does the system compute the bounded prior mutation.

That delta should be:

- small by default
- confidence-weighted
- repetition-sensitive
- tied to one decision point
- decay-aware
- revisable later

This is the actual learning payload.

### Step 11: Update `policy_store`

The delta is written into the policy store at:

- fingerprint family
- decision point

The write should preserve:

- updated weight
- confidence
- evidence count
- provisional/confirmed state
- timestamp for future decay

This is how the brain persists change.

### Step 12: Re-open for delayed revision

The pipeline should not treat the write as final forever.

Later signals may:

- reinforce the delta
- downgrade it
- reverse it
- leave it untouched

This delayed revision path is what prevents the loop from hardening too early around incomplete evidence.

## Why This Pipeline Closes The Loop

This pipeline closes the loop because every stage has a defined role:

- fingerprint defines task identity
- execution produces observable evidence
- evaluator classifies only what requires judgment
- outcome consolidates truth
- eligibility protects the channel
- attribution localizes blame
- delta computes bounded learning
- store persists bias for future decisions
- delayed revision keeps the system corrigible

That is a genuine self-learning loop.

Not because the model changes itself.

But because the runtime re-enters the next similar task with altered decision priors produced by the previous one.

## Current Desktop Feedback Gap

The desktop chat UI already exposes explicit user feedback through thumbs up and thumbs down.

That is important, because delayed user correction and post-response evaluation are central to the learning loop.

However, the current desktop-local implementation is only partially connected.

### What exists today

The current chain is roughly:

- chat message actions render like/dislike controls
- the frontend reads `trace_id` from assistant message metadata
- the frontend submits `create_local_trace_feedback`
- the local store writes a `trace_feedback` row
- the frontend updates local `feedback_score` in message meta for UI state

This means the system already has:

- explicit user feedback capture
- trace-linked local persistence
- local UI reflection of the feedback state

### What is missing today

The desktop-local runtime does **not** yet appear to connect that feedback into the learning spine defined in this document.

In particular, the current local thumbs feedback does not yet flow into:

- `EvaluatedOutcome` revision
- delayed feedback-based verification correction
- attribution re-evaluation
- `PolicyDelta` recomputation
- `policy_store` updates for route/discovery/capability/execution/verification priors

So, at present, desktop thumbs feedback behaves more like:

- feedback capture

not yet:

- feedback-driven learning

### Why this matters

In this architecture, one of the strongest signals is delayed user correction.

Thumbs down is exactly the kind of signal that should be able to say:

- the apparent success was not a true success
- verification may have been too weak
- the path may have been wasteful or misleading

But if feedback stops at persistence, none of that learning happens.

The runtime records sentiment without revising future behavior.

### What this implies for the architecture

The current desktop thumbs feature should be treated as:

- an existing signal source
- not yet an integrated learning mechanism

It already solves the first half of the problem:

- explicit user feedback collection

It does not yet solve the second half:

- feeding that signal back into the post-task learning pipeline

### Architectural consequence

When this signal is eventually integrated, it should not bypass the learning spine.

It should enter at the delayed-feedback layer and influence the loop through the same path as any other correction signal:

- `trace_feedback`
-> delayed revision of `EvaluatedOutcome`
-> possible attribution revision
-> possible `PolicyDelta` revision
-> updated prior in `policy_store`

That keeps thumbs feedback inside the same causal structure as the rest of the architecture instead of creating a parallel ad hoc learning path.
