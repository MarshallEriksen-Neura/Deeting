# Desktop / Cloud Sync Boundaries

Date: 2026-03-11

## Summary
This document defines the authoritative boundary between cloud control-plane data and desktop runtime behavior for `assistant`, `skills`, `system_asset`, and Qdrant indexing in Deeting. Its purpose is to prevent future drift where assistant, skills, and tool/runtime concepts get mixed back together.

## Core Rule

Cloud is the **control plane / arsenal**.  
Desktop is the **runtime / execution plane**.

Cloud decides:
- what exists
- what is approved
- what metadata/version/artifact/checksum should sync

Desktop decides:
- fixed persona
- what is installed locally
- what is indexed locally
- what executes locally

## Object Model

### 1. Persona
Desktop-only fixed reply style.

Responsibilities:
- tone
- style
- answer format
- stable identity/personality

Storage / truth source:
- desktop local config

Not stored in:
- assistant market install state
- cloud skill registry
- Qdrant assistant collection

### 2. Assistant Templates
Cloud-managed expert templates used for JIT capability routing.

Responsibilities:
- expert system prompt template
- expert summary / tags / presentation metadata
- semantic routing target for desktop

Storage / truth source:
- cloud `assistant`
- cloud `assistant_version`
- cloud `system_asset` projection with `registry_entity=assistant`

Sync behavior:
- system assistants always sync to desktop
- approved user assistants also sync to desktop
- no desktop install required

Qdrant role:
- optional semantic routing acceleration
- not the desktop sync source of truth

### 3. Skill Bundles
Installable local bundles that provide docs, recipes, assets, and executable local packages.

Responsibilities:
- plugin market metadata
- installable artifact references
- local docs/recipe retrieval after install
- local runtime package materialization

Storage / truth source:
- cloud `skill_registry`
- cloud `system_asset` projection with `registry_entity=skill`
- desktop `local_skill_install`
- desktop local skill folder

Sync behavior:
- cloud sync sends metadata/artifact/manifests only
- user must install on desktop before local runtime use

Qdrant role:
- optional cloud semantic index only
- not required for plugin market display
- not required for desktop sync

### 4. Direct Capabilities
Callable MCP / host / bridge tools.

Responsibilities:
- execution
- tool calling
- bridge dispatch

Truth source:
- tool registry / MCP discovery / capability registry

Not derived from:
- skill bundles by default
- assistant templates

## Database Responsibilities

### Cloud Database
Use database tables as the source of truth for:
- assistant metadata and versions
- skill metadata and review state
- system asset sync projections

Do **not** require Qdrant to answer:
- what skills are in plugin market
- what assistant templates are available to sync
- whether a skill is approved
- whether a desktop should be able to see a template or bundle

### Desktop Database / State
Use desktop-local storage for:
- local skill install truth
- local assistant/template sync snapshots
- local chat/runtime state
- local fixed persona config

## Qdrant Responsibilities

### Keep
- assistant template semantic routing
- optional skill semantic search
- optional marketplace semantic acceleration

### Do Not Use As Source Of Truth For
- plugin market canonical listing
- assistant sync feed canonical listing
- approval state truth
- install state truth
- artifact/version truth

## Sync Feeds

### Assistant Feed
Endpoint shape:
- cloud → desktop assistant template sync

Carries:
- assistant metadata
- current version metadata
- summary/tags/icon/share slug/published state

Does not carry:
- install requirements
- desktop persona ownership
- local runtime execution truth

### Skill Feed
Endpoint shape:
- cloud → desktop skill bundle sync

Carries:
- skill metadata
- manifest
- artifact_ref
- checksum

Does not carry:
- user install state
- mandatory cloud semantic lookup dependency
- executable runtime state itself (execution is resolved by local/host tool registry)

## Review Rules

### Assistant Review
- user assistant may be created and submitted for market review
- approved user assistants enter:
  - assistant market visibility
  - assistant template sync feed
  - assistant Qdrant semantic collection

### Skill Review
- user repo submission enters `needs_review`
- no automatic AI/sandbox dry-run after submission
- admin approval changes status to `active`
- approved skills enter:
  - plugin market visibility
  - skill sync feed
  - optional skill Qdrant indexing

## Desktop Runtime Rules

### Desktop Chat
- fixed persona comes from desktop settings
- assistant templates may be JIT matched as expert capability guidance
- skills are capability bundles with docs + metadata + runtime entrypoints
- direct callable abilities must be surfaced through MCP/host tool registry (not by reading docs alone)

### Desktop Install
- assistant templates: no install required
- skill bundles: install required
- local desktop storage is the only install-state truth

### Desktop Self-Heal
- self-heal should focus on local skill install / local indexes
- assistant template sync should not be modeled as install repair

## Anti-Patterns To Avoid

Do not:
- describe assistant sync as an install flow
- require skill Qdrant success for plugin market display
- assume AI can execute skill repo scripts directly without host tool registration
- inject assistant template as desktop fixed persona
- merge assistant and skill feeds back into a single runtime semantic feed
- let desktop runtime depend on cloud unified asset ambiguity

## Practical Decision Table

| Question | Source |
|---|---|
| What assistant templates should desktop see? | cloud `system_asset` assistant projection |
| What skills should plugin market show? | cloud `system_asset` skill projection / `skill_registry` |
| What skills are installed locally? | desktop `local_skill_install` |
| What assistant should be JIT matched? | assistant sync feed + assistant Qdrant |
| What skill docs should desktop search after install? | local skill folder + local index |
| What tools can AI call directly? | direct capability registry / MCP registry |

## Final Principle

Assistants are **cloud-synced expert templates**.  
Skills are **install-required local bundles**.  
Qdrant is **indexing infrastructure**, not market or sync truth.  
Desktop runtime must stay independent from cloud runtime semantics.
