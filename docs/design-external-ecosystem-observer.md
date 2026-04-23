# Deeting External Ecosystem Observer Model

Updated: 2026-04-22
Status: proposed architecture
Scope: desktop local runtime, product boundary, external ecosystem ingestion

## 1. Positioning

This document defines how Deeting should relate to external agent ecosystems such as EvoMap, future agent marketplaces, friend-shared skills, or other user-chosen capability networks.

It is intentionally narrowed to one question:

- how Deeting should absorb external experience without becoming an external ecosystem client, authority, or dependency

It does not define:

- Deeting-operated marketplace features
- Deeting-operated community ranking or external asset publication
- deep protocol participation as a first milestone
- cloud-owned federation or backend-managed ecosystem sync

## 2. Core Decision

Deeting is an observer and absorber of user-owned external ecosystems.

Deeting is not:

- the operator of those ecosystems
- the default gateway into those ecosystems
- structurally dependent on those ecosystems for routing, memory, or identity

The intended product boundary is:

1. the user chooses whether to connect, browse, or import from an external ecosystem
2. Deeting observes imported or discoverable external assets as foreign signals
3. Deeting translates those foreign signals into Deeting-native observations and provisional priors
4. only local execution and local verification can promote those priors into stronger Deeting behavior

This means the actual learning loop still closes inside Deeting:

`external candidate experience -> boundary translation -> provisional local prior -> local execution -> local verification -> local revision`

## 3. Why This Boundary Exists

There are two different problems:

1. `user intelligence`
   - what this specific user prefers, trusts, repeats, corrects, rejects, and cares about
2. `task intelligence`
   - what kinds of strategies, tools, decompositions, and validation patterns tend to work for a class of tasks

External ecosystems can help with the second problem.

They cannot replace the first problem.

If Deeting tries to solve missing user-specific information by delegating authority to an external ecosystem, it will become better at generic task patterns while still not understanding the actual user. That is the wrong trade.

## 4. Product Principle

The product principle is:

`user-owned external ecosystems, Deeting-owned judgment`

Practical consequences:

1. users may freely connect or bring back external assets
2. Deeting should make import and local reuse easy
3. Deeting should not require users to leave Deeting for every task
4. Deeting should not force users into any one external ecosystem
5. removing an external source must not reduce core Deeting functionality below its local baseline

## 5. Architecture Principle

The architecture principle is:

`foreign formats stay foreign until translated at the boundary`

The runtime sovereignty charter already establishes the correct shape:

- external sources enter only through `ingress/sources/<name>.rs`
- foreign type names stay inside the boundary file
- canonical runtime types remain Deeting-owned
- external sources are observations, not authority

This document extends that charter with a product-facing rule:

- external ecosystems are optional user-selected inputs
- the core runtime must never require a specific external ecosystem to function

## 5.1 Existing Code Anchors

This proposal is grounded in code that already exists:

- sovereignty charter: `deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md`
- ingress contract: `deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/ingress.rs`
- canonical task-learning types: `deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs`
- local prior application: `deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs`
- local evaluation and revision: `deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs` and `revision.rs`

This document does not invent a new learning system.

It defines how external ecosystems should feed the existing one.

## 6. Deeting's Job

When external ecosystems exist, Deeting should do exactly three things well.

### 6.1 Receive

Deeting receives external material through user-owned actions such as:

- connecting an external account or source
- importing a skill, capsule, guide, or plan
- referencing an external asset during a task
- subscribing to a source feed the user explicitly enabled

### 6.2 Translate

Deeting translates foreign payloads into Deeting-native structures such as:

- canonical observations
- `TaskFingerprint`
- `EvaluatedOutcome`
- `PolicyDelta`
- local wiki or memory candidates

Translation is anti-corruption work, not passive storage.

### 6.3 Re-evaluate

Deeting re-evaluates every imported signal locally.

External experience can influence behavior only as a provisional hint until Deeting has local evidence. Imported success elsewhere is not equivalent to success here.

## 7. What Deeting Must Not Do

Deeting must not:

1. become a branded client for a specific ecosystem
2. make external identity part of Deeting's core identity model
3. route core decisions based on foreign type names or foreign ranking fields
4. treat external scores as more authoritative than local user feedback
5. let imported signals override destructive-intent or approval-sensitive safety locks
6. require background participation in an ecosystem just to keep Deeting effective

## 8. Trust Model

All external experience is lower-trust than local experience.

Imported signals should default to:

- lower confidence
- lower maturity
- lower authority
- stronger decay
- easy rollback

Recommended default posture:

1. imported deltas start as `provisional`
2. imported confidence is capped below local confirmed priors
3. imported evidence count is not treated as equivalent to local repeated success
4. imported signals decay faster unless revalidated locally

## 9. External Asset Lifecycle

The external asset lifecycle should be:

1. `discover`
   - an external asset is found by the user or by a user-enabled source
2. `ingest`
   - raw payload is stored as a foreign record with source provenance
3. `translate`
   - Deeting maps foreign structure into canonical local candidates
4. `downgrade`
   - translated results enter as provisional priors or candidate knowledge, not as truth
5. `apply`
   - runtime may consult those priors as one hint among many
6. `verify`
   - local execution outcome is recorded through normal Deeting evaluation
7. `promote or decay`
   - only local success can strengthen the imported prior; otherwise it weakens or expires

## 10. Source Adapter Contract

Every external ecosystem adapter should obey the same contract.

Minimum responsibilities:

1. define source-specific fetch or import behavior
2. normalize provenance, version, freshness, and raw payload storage
3. translate foreign schema into Deeting-native observations
4. assign conservative confidence and maturity defaults
5. never leak foreign vocabulary outside the adapter

Suggested boundary shape:

- `ingress/sources/<name>.rs` for translation
- source-specific comments may mention upstream concepts for attribution
- canonical runtime types must not be widened for one source's quirks

## 11. Local Learning Contract

Imported experience should plug into existing task learning rather than bypass it.

That means:

1. matching or synthesizing a `TaskFingerprint`
2. deriving a conservative `PolicyDelta`
3. writing the delta through the same local prior machinery used by native learning
4. relying on local `EvaluatedOutcome` and revision flows for promotion

The imported signal is not the learning system.

It is an input into the learning system.

## 12. Product UX Consequences

The UX should communicate optionality and local ownership.

Recommended product semantics:

1. the user connects or imports external ecosystems explicitly
2. Deeting explains that imported experience is adapted locally
3. imported strategies are shown as candidate help, not guaranteed truth
4. users can disconnect a source without damaging Deeting's core local behavior
5. Deeting can say "learned from imported external experience and revalidated locally" without exposing foreign internals as first-class runtime concepts

Deeting should avoid a UX where:

- the user must understand the external ecosystem's protocol model
- Deeting appears broken without a connected external source
- external ranking numbers are shown as if they were Deeting's own trust metric

## 13. Connector Activation Model

The unit of integration is a `source connector`, not an `API key`.

Deeting should not expose one global "external ecosystem key" switch.

Each external source should have its own lifecycle and activation state.

Minimum connector states:

1. `configured`
   - the source has enough non-secret configuration to exist as a record
2. `authenticated`
   - the source has the required credential, if any
3. `enabled`
   - the user has explicitly allowed Deeting to use the source
4. `healthy`
   - the most recent connection or sync attempt succeeded

This implies:

1. a source may exist without credentials
2. a source may have credentials but still be disabled
3. a source may be enabled but temporarily unhealthy
4. Deeting itself must remain fully usable when any or all connectors are absent

### 13.1 Supported activation modes

The first implementation should support three source modes:

1. `manual_import`
   - user pastes a URL, asset id, file, or package for one-time ingestion
   - no background sync required
2. `public_pull`
   - user enables a read-only public source
   - no secret required
3. `authenticated_pull`
   - user provides a key, token, or future OAuth grant
   - background pull is allowed only after explicit enablement

### 13.2 User flow

Recommended UX flow:

1. user creates a source connector
2. user chooses auth mode: `none`, `api_key`, `oauth`, or `local_path`
3. if credentials are needed, user saves them
4. Deeting runs `test connection`
5. user explicitly toggles `enable`
6. user chooses `manual` or `scheduled` sync
7. sync writes raw foreign records before any translation touches runtime learning

Saving a key must not automatically enroll the whole product into an external ecosystem.

It only makes one connector eligible to run.

## 14. Suggested Data Model

The data model should mirror the existing separation Deeting already uses elsewhere:

1. non-secret connector configuration in normal tables
2. secret material in encrypted secret storage
3. raw imported foreign records stored before translation

### 14.1 `external_sources`

Suggested fields:

1. `id`
2. `display_name`
3. `connector_type`
4. `auth_mode`
5. `base_url`
6. `is_enabled`
7. `sync_mode`
8. `sync_interval_minutes`
9. `status`
10. `last_synced_at`
11. `last_error`
12. `trust_level`
13. `metadata_json`
14. `created_at`
15. `updated_at`

This table owns connector lifecycle and scheduling state.

It should not contain plaintext secrets.

### 14.2 `external_source_credentials`

Suggested fields:

1. `id`
2. `source_id`
3. `credential_kind`
4. `secret_ref` or encrypted secret payload
5. `secret_key_version`
6. `created_at`
7. `updated_at`

This should reuse Deeting's existing encrypted secret storage pattern instead of inventing a parallel path.

### 14.3 `external_raw_records`

Suggested fields:

1. `id`
2. `source_id`
3. `source_asset_id`
4. `source_version`
5. `asset_family`
6. `observed_at_unix_ms`
7. `freshness_hint`
8. `content_hash`
9. `raw_payload_json`
10. `translation_status`
11. `translated_at_unix_ms`
12. `translation_error`

This table is the durable boundary ledger.

It exists so Deeting can:

1. retry translation
2. replay translation after adapter changes
3. inspect provenance
4. delete one source without damaging others

### 14.4 Optional translated-candidate table

If the first implementation needs durable staging before priors are applied, add a separate candidate table for translated results such as:

1. `source_record_id`
2. `candidate_kind`
3. `fingerprint_key`
4. `candidate_json`
5. `confidence`
6. `maturity`
7. `applied_at_unix_ms`
8. `expired_at_unix_ms`

This table is optional.

If omitted, translation may write directly into existing local prior and knowledge pipelines, as long as raw foreign records remain preserved.

## 15. Sync And Runtime Semantics

Connector runtime should be conservative.

Recommended rules:

1. no connector runs until the user explicitly enables it
2. saving credentials alone does not activate background sync
3. connector sync writes raw records first
4. translation runs after raw persistence
5. only translated provisional results may reach local learning
6. only local execution and revision may strengthen imported priors

Recommended state machine:

1. `draft`
2. `configured`
3. `ready`
4. `enabled`
5. `syncing`
6. `error`
7. `disabled`

The scheduler should operate per connector, not globally.

If one source fails, Deeting should mark that connector unhealthy and continue functioning normally.

## 16. Existing Implementation Patterns To Reuse

This design should reuse patterns already present in Deeting:

1. encrypted secret storage for provider credentials
2. explicit `is_enabled` semantics for optional integrations
3. source status and `last_synced_at` tracking
4. separate sync and runtime readiness handling

The external ecosystem feature should look like another optional source system, not like a special new exception to the platform.

## 17. Red Lines

These are non-negotiable.

1. external sources cannot become runtime truth
2. external identity cannot become Deeting identity
3. external vocabulary cannot become canonical runtime vocabulary
4. external experience cannot override safety locks
5. deleting all external adapters must leave Deeting locally functional
6. imported success elsewhere cannot be counted as local proof

## 18. Phase Order

If this direction is implemented, the order should be:

1. document the boundary and source-adapter contract
2. add raw foreign-source storage plus provenance and freshness metadata
3. add one adapter that translates into provisional local priors
4. ensure local evaluation and revision remain the promotion authority
5. only later consider deeper ecosystem participation if it creates clear value

This keeps the first implementation aligned with the product boundary instead of drifting into protocol enthusiasm.

## 19. One-Sentence Rule

Deeting allows user-owned external ecosystems, but all imported experience must be translated, downgraded, and revalidated locally before it can shape core behavior.
