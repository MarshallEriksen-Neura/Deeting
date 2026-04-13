# Desktop LLM Wiki Productization Design

**Lane:** `desktop local / dashboard / obsidian vault`

## Goal

Add a standalone desktop dashboard surface that helps users instantiate and maintain an LLM Wiki inside Obsidian, without requiring deep Obsidian integration or a second always-separate knowledge system.

The page should let a user:

- connect an existing Obsidian vault
- scan the vault locally
- create a managed LLM Wiki workspace inside that vault
- seed the first wiki structure and files
- connect the workspace to Deeting custom task agents
- let Deeting maintain the wiki over time using existing local lifecycle machinery

## Product Thesis

The product is not "another note-taking app" and not "an Obsidian plugin clone".

The product is:

- a local maintenance layer
- a guided wiki bootstrapper
- a lifecycle-aware knowledge maintainer

Obsidian remains the user's browsing and editing environment.
Deeting becomes the maintainer that scans, synthesizes, updates, and organizes the LLM Wiki workspace.

## Core Decision

Do not make "create a brand-new dedicated vault" the default.

Default behavior:

- read the user's existing vault
- index the whole vault locally if the user allows it
- write only into a clearly bounded managed workspace

Recommended managed workspace path:

- `Deeting Wiki/`

Alternative advanced path:

- `.deeting/llm-wiki/`

The default should optimize for adoption and low migration cost:

- users keep their existing vault
- users do not need to split their knowledge into a second system
- Deeting can learn from old notes immediately
- Deeting does not silently rewrite arbitrary old notes by default

## User Modes

The page should support three entry modes.

### 1. Connect Existing Vault and Create Managed Workspace

This is the default and recommended mode.

Behavior:

- user selects the Obsidian vault root
- Deeting scans the vault locally
- Deeting creates `Deeting Wiki/` inside the vault
- Deeting writes the initial LLM Wiki scaffold only inside that workspace

### 2. Connect Existing Vault and Adopt Existing Wiki Folder

This is for advanced users who already have a structured notes area they want Deeting to maintain.

Behavior:

- user selects the vault root
- user selects an existing folder to adopt
- Deeting runs a preview / dry-run classification
- Deeting shows what it would treat as sources, wiki pages, and unmanaged notes
- only after confirmation does Deeting begin maintenance

### 3. Create a New Dedicated Vault

This remains available, but should not be the main path.

Suitable for:

- new users without an Obsidian setup
- project-isolated research vaults
- users who explicitly want total separation

## First-Run User Experience

The first-run experience must feel like a product, not a file generator.

The user should finish onboarding and immediately see:

- the vault is connected
- a workspace exists
- the first wiki files were created
- the old vault was scanned into an initial map
- one starter custom task agent can work against the wiki

The first-run loop should be:

`bind vault -> scan vault -> create workspace -> seed wiki -> generate agent handoff`

## What Deeting Should Create

The first version should create the minimum structure needed by the original LLM Wiki pattern.

Recommended scaffold:

```text
Deeting Wiki/
  README-LLM-Wiki.md
  AGENTS.md
  Home.md
  index.md
  log.md
  raw/
    clips/
    docs/
    images/
  wiki/
    entities/
    concepts/
    sources/
    analyses/
```

### File Purposes

`README-LLM-Wiki.md`

- human-readable explanation of what this workspace is
- explains ownership boundaries
- explains how Deeting uses the workspace

`AGENTS.md`

- the schema / maintenance contract for Deeting and custom agents
- describes what can be read, what can be written, and how ingest/query/lint should behave

`Home.md`

- user-facing landing page for the workspace
- concise overview of major themes, current state, and suggested starting points

`index.md`

- content index for the wiki
- grouped by category
- one-line summary per page

`log.md`

- append-only chronological maintenance log
- records ingest, query crystallization, lint, supersession, and migration events

`raw/`

- immutable source layer
- Deeting reads from here but does not rewrite source content

`wiki/`

- LLM-maintained layer
- the primary structured knowledge workspace

## What Happens After Bootstrap

Bootstrap is only the installation step.

After bootstrap, the product should run a persistent maintenance loop.

### 1. Initial Scan

Deeting scans the existing vault and generates:

- a rough map of major topics
- likely source-rich areas
- candidate wiki material
- duplicate or overlapping topic clusters
- potential existing folders worth adopting later

Suggested outputs:

- `analyses/initial-map.md`
- `analyses/open-questions.md`

### 2. Seed Wiki

Deeting generates the first useful pages, not just empty folders.

Minimum seed set:

- `Home.md`
- `index.md`
- several top concepts
- several top entities
- several source summary pages

### 3. Agent Handoff

Deeting helps the user create or bootstrap a custom task agent that:

- reads across the whole vault
- prefers the Deeting Wiki workspace as structured knowledge
- writes by default only into the managed workspace
- can crystallize useful answers back into `wiki/analyses/`

This should hand off into the existing dashboard custom task agent surface rather than re-implementing an agent editor on the LLM Wiki page.

### 4. Daily Maintenance Loop

The intended steady-state product loop is:

- ingest new sources
- answer questions from the wiki
- crystallize valuable answers back into the wiki
- lint and repair the workspace over time

The user should experience Deeting as a maintainer, not just a bootstrap wizard.

## Lifecycle Reuse Decision

The current desktop-local lifecycle machinery should be reused as the backend maintenance kernel.

This repo already has relevant primitives for:

- semantic memory retrieval
- scoped knowledge retrieval
- vitality / access-based decay
- write-guard deduplication
- snapshot / rollback
- session summary generation
- retention cleanup
- document-scoped semantic search

These should not be copied into a separate LLM Wiki engine if the existing local machinery can be generalized.

## Reuse Boundary

Do not equate the current `local_memories` model directly with the user's markdown wiki files.

The right reuse model is:

- keep Obsidian markdown as user-facing source of truth for the wiki workspace
- use Deeting lifecycle services as the maintenance engine behind that workspace

In other words:

- wiki pages live in the vault
- lifecycle metadata, embeddings, retrieval state, and snapshots can live in Deeting's local runtime/storage
- Deeting writes page updates back into the vault

This avoids building a second hidden wiki while still reusing the current lifecycle stack.

## Read / Write Ownership

This distinction must be explicit in the product.

### Read Scope

Default read scope:

- full connected vault

Rationale:

- scanning old vault content is not the main risk in a local-first product
- value comes from learning from the user's accumulated notes
- users should not need to migrate content to gain value

### Write Scope

Default write scope:

- managed LLM Wiki workspace only

Rationale:

- avoids surprising edits to legacy user notes
- keeps Deeting-maintained content bounded and reviewable
- makes rollback and audit simpler

Advanced mode can later allow selective write-back into user-selected legacy folders.

## Lifecycle Model for the Wiki Workspace

The product should map the LLM Wiki maintenance model onto a small set of user-visible operations.

### Ingest

When new material is selected:

- classify whether it belongs in `raw/`
- create or update source summary pages
- update related entity and concept pages
- update `index.md`
- append to `log.md`

### Query

When a user asks a question:

- search the wiki workspace first
- reach back into scanned vault material or raw sources as needed
- generate an answer
- if the answer has persistent value, offer or auto-create an analysis page

### Lint

Periodic health-check should look for:

- stale summaries
- weak or missing links
- duplicate pages
- candidate supersession
- orphan pages
- empty or low-value analyses

### Crystallize

Important conversations or investigations should be converted into:

- `wiki/analyses/*.md`
- extracted facts that strengthen existing pages

## What the Product Should Reuse First

The first version should reuse the existing system in this order:

1. vault scanning and file selection primitives
2. knowledge indexing and chunk retrieval
3. local memory write-guard and vitality scoring
4. snapshot / rollback audit trail
5. conversation summary and retention workers
6. custom task agent handoff

This order keeps the first version useful without requiring a full new graph layer.

## Explicit Non-Goals for V1

- deep Obsidian plugin integration
- live Obsidian graph / Dataview / canvas integration
- typed knowledge graph authoring as a hard requirement
- automatic rewriting of arbitrary legacy notes across the whole vault
- mandatory second vault creation
- a separate bespoke agent editor inside the LLM Wiki page

## Proposed Dashboard Surface

Add a standalone dashboard page:

- `/dashboard/llm-wiki`

This should sit near knowledge / memory / task-agent configuration surfaces rather than inside generic settings.

Reason:

- this is an operational workspace
- it has lifecycle management, not just preference storage
- it will likely grow into scan, maintenance, and agent handoff workflows

## Page Information Architecture

The page should have four main sections.

### 1. Vault Binding

- select vault root
- validate path
- choose mode: managed workspace / adopt folder / dedicated vault
- choose managed workspace path

### 2. Workspace Bootstrap

- preview scaffold
- create files
- create first wiki pages
- show initial ownership boundary

### 3. Maintenance

- rescan vault
- ingest selection
- rebuild index
- run lint
- show recent lifecycle actions

### 4. Agent Handoff

- generate recommended custom task agent prompt / config
- jump into existing task-agent dashboard flow

## Success Criteria

V1 is successful if:

1. a user can connect an existing Obsidian vault without needing to migrate content
2. Deeting creates a bounded managed LLM Wiki workspace inside that vault
3. the user immediately sees first useful pages, not empty scaffolding only
4. Deeting can continue maintaining the workspace through ingest, query, and lint flows
5. existing local lifecycle machinery is reused instead of duplicated into a parallel system
6. users understand that Deeting reads broadly but writes narrowly by default

## Recommended Implementation Sequence

### Phase 1

- add `/dashboard/llm-wiki`
- support vault binding
- support managed workspace scaffold generation
- create initial `README-LLM-Wiki.md`, `AGENTS.md`, `Home.md`, `index.md`, `log.md`

### Phase 2

- add whole-vault scan
- generate initial map and seed pages
- expose first maintenance actions

### Phase 3

- connect lifecycle reuse paths
- add crystallization hooks
- add custom task agent handoff

### Phase 4

- add adopt-existing-folder flow
- add stronger lint / supersession / claim-confidence semantics

