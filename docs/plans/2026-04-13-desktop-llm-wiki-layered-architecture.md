# Desktop LLM Wiki Layered Architecture

**Lane:** `desktop local / runtime / retrieval kernel / custom task agent / managed corpus`

## Goal

Define the correct architectural split for a Deeting-managed LLM Wiki inside a user's Obsidian vault.

This document answers one core question:

Where should LLM Wiki automation actually live?

Specifically:

- should vault ingest write directly into user memory
- should LLM Wiki maintenance live inside the main runtime
- should it become part of the main knowledge product surface
- should custom task agents own the write path

## Short Answer

Use a layered model.

Do not collapse LLM Wiki automation into a single subsystem.

Recommended split:

- `shared retrieval kernel` owns chunking, embedding, BM25, hybrid ranking, and lifecycle mechanics
- `llm wiki corpus` is a dedicated managed corpus / namespace, not a child of the main knowledge surface
- `custom task agent` owns corpus reads, workspace writes, and maintenance work
- `main runtime` owns delegation only
- `wiki workspace` owns user-visible markdown artifacts
- `user memory` only receives explicitly promoted long-lived conclusions

The safe pipeline is:

`vault scan -> llm wiki corpus indexing -> delegated wiki-maintainer agent retrieval + maintenance -> wiki workspace write -> optional memory promotion`

Not:

- `vault ingest -> user memory`
- `vault ingest -> main runtime default retrieval injection`
- `vault ingest -> main knowledge surface ownership`

## Why This Split Matters

If all vault ingest flows directly into user memory:

- raw notes and polished conclusions mix together
- duplicate content accumulates quickly
- unstable or low-confidence observations get over-promoted
- the user loses the distinction between source material and maintained knowledge

If all wiki maintenance lives inside the main runtime:

- ordinary chat turns become implicit write operations
- ownership becomes hard to explain
- automatic edits become hard to audit
- it becomes difficult to keep writes bounded and intentional

If everything is attached to the main knowledge surface:

- retrieval works
- but the domain boundary gets blurred
- LLM Wiki content can start interfering with the main assistant's default retrieval and product semantics
- ownership becomes harder to reason about

If LLM Wiki becomes only a hidden custom-agent implementation detail:

- the user loses a visible managed workspace
- the product becomes too implicit
- the wiki stops feeling like a first-class artifact

The layered model avoids all three failure modes.

## Layer Model

### 1. Vault Layer

This is the user's actual Obsidian vault.

It includes:

- legacy notes
- attachments
- clipped sources
- existing manually-authored wiki pages
- the new Deeting-managed LLM Wiki workspace

Default behavior:

- read the full connected vault
- write only to the managed workspace

This layer is the user's visible filesystem truth.

## 2. Shared Retrieval Kernel

This layer is infrastructure, not product surface.

Responsibilities:

- parse content into indexable units
- chunk documents
- generate embeddings
- maintain BM25 / lexical retrieval inputs
- maintain semantic search inputs
- fuse lexical and semantic ranking
- maintain vitality / decay / retention mechanics
- maintain snapshots / rollback primitives
- expose reusable corpus-level retrieval APIs

This layer answers:

- how data is indexed
- how data is ranked
- how lifecycle scores evolve
- how audit / rollback works

Not:

- which product surface owns the content
- whether content should be written back to markdown
- whether content should enter the main assistant context by default

This is the piece that should be reused across systems so Deeting only maintains one retrieval/lifecycle engine.

## 3. LLM Wiki Corpus Layer

This is a dedicated corpus / namespace built on top of the shared retrieval kernel.

Responsibilities:

- scan the user's vault for LLM Wiki purposes
- maintain LLM Wiki-specific indexed documents
- keep vault-derived material isolated from the main assistant's default retrieval scope
- expose a controlled search surface for the maintainer agent

This layer is intentionally **not** the same thing as the main `knowledge` product surface.

That is the key architecture decision.

It may reuse the same retrieval engine and even some storage mechanics, but it should remain a separate ownership boundary.

What belongs here:

- old vault notes used as context for wiki maintenance
- managed wiki pages
- raw source files
- imported extracted text
- LLM Wiki-specific retrieval metadata

What does not belong here:

- automatic main assistant retrieval injection
- general-purpose dashboard knowledge ownership
- direct user memory writes

This layer answers:

- what the wiki maintainer agent can search
- what evidence exists for wiki synthesis
- what files belong to the managed wiki universe

## 4. Main Runtime Layer

This is the main Deeting decision and orchestration layer.

Responsibilities:

- deciding whether to delegate to the LLM Wiki maintainer agent
- surfacing maintenance suggestions to the user
- deciding whether a result should remain ephemeral or become a delegated maintenance request
- accepting delegated outputs back into the user-visible workflow

The runtime should be the trigger and routing brain only.

It should not own LLM Wiki retrieval as a default background source.

Examples of runtime-owned decisions:

- "delegate this source to the wiki maintainer"
- "ask the wiki maintainer for supporting material"
- "run a wiki maintenance pass now"
- "turn this thread into a crystallization request"

The runtime should not:

- automatically pull LLM Wiki corpus results into ordinary chat by default
- mutate wiki pages itself
- treat LLM Wiki as equivalent to the main knowledge product surface

## 5. Custom Task Agent Layer

This is the correct owner for most markdown maintenance work.

Responsibilities:

- retrieve from the dedicated LLM Wiki corpus
- update wiki pages
- create source summaries
- revise entity and concept pages
- add cross-links
- append maintenance logs
- generate analysis pages
- perform bounded lint / repair tasks
- decide how managed markdown should change within its write scope

Why custom task agents should own this:

- page maintenance is a distinct task, not just a retrieval side effect
- it can run with a clear write scope
- it keeps the main runtime clean
- it gives users a more understandable mental model: "Deeting delegated wiki maintenance"

This is also the cleanest way to keep LLM Wiki high-cohesion and low-coupling.

Recommended agent role:

- one dedicated `wiki-maintainer` style custom task agent

Optional future roles:

- `wiki-linter`
- `source-ingestor`
- `analysis-crystallizer`

V1 does not need multiple agents. One bounded maintainer is enough.

## 6. Wiki Workspace Layer

This is the user-visible maintained markdown artifact.

Responsibilities:

- present structured knowledge
- hold summaries, entities, concepts, and analyses
- remain browsable in Obsidian
- be understandable without Deeting internals

This layer should stay intentionally human-readable.

It should not become a dump of raw embeddings metadata or internal runtime state.

Recommended workspace structure:

```text
Deeting Wiki/
  README-LLM-Wiki.md
  AGENTS.md
  Home.md
  index.md
  log.md
  raw/
  wiki/
```

The workspace is the visible product outcome.

## 7. User Memory Layer

This layer should remain narrower than the wiki.

Responsibilities:

- store high-value long-lived facts
- store durable preferences
- store repeated stable patterns
- store procedural guidance

This layer should not be the immediate landing zone for all vault ingest.

The right rule is:

- `all memory-worthy wiki knowledge is not immediate memory`
- `some wiki conclusions may later be promoted into memory`

In other words:

- `wiki` is broader, more user-visible, and more revisable
- `memory` is narrower, more stable, and more strongly promoted

## Lifecycle Split

Three lifecycle concepts should remain separate even when they reuse one engine:

- `retrieval lifecycle`: indexing, retrieval, vitality, candidate dedup, access-touch
- `wiki maintenance lifecycle`: markdown updates, lint, crystallization, supersession review
- `memory promotion lifecycle`: stronger filtering for repeated stable conclusions entering local memory

This means:

- retrieval vitality is not the same thing as claim confidence
- generic write-guard merge is not page merge policy
- crystallization and promotion are related but distinct operations

## Machine-Readable Lifecycle Ledger

The shared retrieval kernel and llm wiki corpus should preserve machine-readable lifecycle metadata in Deeting internals rather than burying it in markdown prose.

Minimum internal fields:

- `workspace_id`
- `page_id`
- `claim_id`
- `source_refs`
- `repeat_count`
- `confidence`
- `last_validated_at`
- `superseded_by`
- `promotion_state`
- `manual_override`
- `pinned`

These fields are the durable bridge between:

- lint and supersession review
- promotion decisions
- audit and rollback
- future confidence semantics

## Ownership by Operation

### Operation: Connect and Scan Vault

Owner:

- llm wiki corpus layer

Runtime role:

- trigger and progress orchestration only

Write target:

- no immediate memory write
- optional initial scan reports into the managed wiki workspace

### Operation: Ingest New Source

Owner:

- llm wiki corpus for extraction and retrieval preparation
- custom task agent for wiki updates

Flow:

1. source appears
2. source is parsed and indexed
3. runtime decides whether to delegate
4. custom task agent retrieves from the llm wiki corpus
5. agent updates source summaries and related wiki pages
6. runtime may later mark promotion candidates for memory

### Operation: User Query

Owner:

- main runtime for delegation decisions
- custom task agent for corpus-aware wiki retrieval when invoked

Flow:

1. ordinary chat stays on its normal retrieval path
2. if the user or runtime explicitly needs LLM Wiki material, delegate to the maintainer agent
3. the maintainer agent retrieves from the llm wiki corpus
4. if the result is crystallizable, the maintainer agent can update the workspace

This keeps normal answering and LLM Wiki maintenance separated by design.

### Operation: Lint / Repair

Owner:

- runtime for scheduling and decision
- custom task agent for page repair

Possible checks:

- stale pages
- weak cross-links
- duplicate summaries
- orphan pages
- candidate supersession

### Operation: Promote to Memory

Owner:

- runtime decision
- memory service write

Rule:

Only promote after a stronger filter than ordinary wiki write.

Examples:

- repeated stable conclusion
- cross-session preference
- high-confidence durable fact
- reusable procedural pattern

Guard boundary:

- promotion dedup must be namespace-aware
- scope at least by workspace or corpus namespace plus category and source
- do not run broad global write-guard merging across unrelated wiki corpora

## Hooks: Where They Should Attach

The "event-driven hooks" from the LLM Wiki v2 idea should be attached to different layers depending on what they do.

### `on vault connected`

Owner:

- runtime trigger

Effect:

- run initial scan job
- seed workspace candidate generation

### `on new source`

Owner:

- llm wiki corpus first
- runtime trigger second

Effect:

- index source
- make the source retrievable by the maintainer agent
- optionally enqueue wiki ingest delegation

### `on session end`

Owner:

- runtime

Effect:

- generate crystallization candidate
- optionally delegate a wiki analysis page write

### `on valuable answer`

Owner:

- runtime

Effect:

- propose or trigger delegation to the maintainer agent

### `on schedule`

Owner:

- runtime scheduler

Effect:

- run lint
- run stale checks
- run vitality/retention passes
- propose supersession candidates

### `on memory write`

Owner:

- memory service and runtime review logic

Effect:

- allow contradiction or supersession checks
- do not automatically rewrite broad wiki content without delegation

## Why Ingest Should Not Directly Enter User Memory

Direct ingest into memory is tempting because the current system already has:

- embeddings
- BM25 / lexical retrieval
- memory lifecycle
- retention
- write guard

But this is still the wrong default for vault-scale content.

Reasons:

1. user notes contain unstable material
2. not every note is a memory-worthy fact
3. source material and canonical conclusions are different layers
4. direct promotion increases duplication and noise
5. future contradiction handling becomes harder

The correct role for memory is:

- promotion target
- not first landing zone

## Why This Should Not Attach to Main Knowledge

Even if the same embedding + BM25 + lifecycle engine is reused, the LLM Wiki should not be owned by the main knowledge product surface.

Reasons:

- the LLM Wiki has a different product boundary
- it is intentionally agent-owned and write-bounded
- it should not silently influence the main assistant's ordinary retrieval
- it is easier to reason about as a dedicated corpus than as a hidden knowledge subfolder

This is the right meaning of high-cohesion, low-coupling here:

- one shared retrieval/lifecycle kernel
- separate corpus ownership
- separate agent ownership
- explicit runtime delegation

## Recommended V1 Architecture

### Read Path

`Vault -> LLM Wiki Corpus Index -> Wiki Maintainer Agent Retrieval`

### Write Path

`Main Runtime Delegation -> Wiki Maintainer Custom Task Agent -> Managed Wiki Workspace`

### Promotion Path

`Wiki Conclusion -> Explicit Filter -> User Memory`

### Audit Path

`Delegated Wiki Write -> log.md + runtime-side audit metadata`

### Main Assistant Path

`Main Runtime -> normal retrieval path`

The main assistant should only touch the LLM Wiki path through explicit delegation, not through default background injection.

## Default Safety Rules

1. Read broad, write narrow.
2. Reuse one shared retrieval/lifecycle kernel, not two parallel engines.
3. Keep LLM Wiki corpus ownership separate from the main knowledge product surface.
4. Delegate markdown maintenance instead of burying it inside chat runtime.
5. Do not inject LLM Wiki retrieval into the main assistant by default.
6. Promote to memory only after stronger confidence filtering.
7. Keep user-visible markdown as the primary wiki artifact.
8. Keep lifecycle metadata and retrieval state in Deeting internals, not in noisy page bodies.

## Product Implications

This architecture means the LLM Wiki page should not be a file browser only.

It should expose:

- vault binding
- corpus scan status
- managed workspace status
- maintenance triggers
- recent delegated actions
- custom agent handoff

The page is effectively a control panel for the layered system.

## Success Criteria

This architecture is successful if:

1. old vault content can inform LLM Wiki retrieval without polluting user memory
2. the managed wiki workspace grows as a visible artifact
3. the main runtime remains understandable and not overburdened with hidden writes
4. the main assistant is not implicitly disturbed by LLM Wiki retrieval
5. custom task agents perform bounded and reviewable wiki maintenance
6. only stable, high-value conclusions are promoted into user memory
