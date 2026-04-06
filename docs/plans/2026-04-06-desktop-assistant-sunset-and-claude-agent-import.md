# Desktop Assistant Sunset and Claude Agent Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant desktop `assistant` product surface, promote `custom_task_agent` to the only user-facing delegated-agent object, and add a Claude-style agent importer that turns external markdown agent directories into local custom task agents.

**Architecture:** Keep desktop runtime truth on `persona + custom_task_agent + capability/skill bindings`. Desktop chat already no longer depends on assistant selection as its primary runtime identity, so the remaining work is to remove the now-redundant assistant page and related desktop entry points, then add a new importer that treats Claude-agent markdown files as profile sources and materializes them directly into `custom_task_agent` records. Imported agents inherit Deeting-owned tool/skill bindings through the existing custom-task-agent binding model rather than bringing a separate runtime contract.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, SWR, Tauri v2, Rust, SQLx, SQLite, existing desktop custom task agent runtime/store/indexing.

---

### Task 1: Lock the new desktop product boundary in docs first

**Files:**
- Create: `/data/Deeting/docs/plans/2026-04-06-desktop-assistant-sunset-and-claude-agent-import.md`
- Reference: `/data/Deeting/docs/plans/2026-03-11-desktop-runtime-deassistantization-design.md`
- Reference: `/data/Deeting/docs/plans/2026-03-24-dashboard-agent-creation-redesign.md`

**Step 1: Record the object model explicitly**

Write down the desktop-local object split:

- `persona`: fixed main-assistant identity
- `custom_task_agent`: delegated local agent profile
- `capability/skill`: callable tools and guidance layers
- `assistant`: no longer a desktop product-surface object

Expected: future work no longer treats `assistant` and `custom_task_agent` as parallel first-class desktop concepts.

**Step 2: Record the migration rule**

State the product rule clearly:

- desktop runtime does not read assistant selection
- desktop users create/manage delegated agents only in task agents
- external agent ecosystems import into task agents, not assistants

Expected: every downstream task can be judged against one stable desktop model.

### Task 2: Remove desktop assistant entry points and route surfaces

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/assistants/*`
- Modify: `/data/Deeting/deeting/components/layout/sidebar/*`
- Modify: `/data/Deeting/deeting/components/common/agent-selection/*`
- Modify: `/data/Deeting/deeting/hooks/chat/use-chat-agent.ts`
- Modify: `/data/Deeting/deeting/hooks/use-chat-service.ts`
- Modify: `/data/Deeting/deeting/store/*` only where desktop assistant UI state still leaks through

**Step 1: Identify every desktop navigation path into assistants**

Inspect and remove desktop-only entry points for:

- assistant page navigation
- sidebar links
- selection overlays
- “new assistant” or “install assistant” CTA copy

Expected: the desktop app no longer invites users into assistant management as a primary flow.

**Step 2: Preserve web/cloud behavior only where intentionally separate**

If assistant pages still exist for cloud or non-desktop contexts, gate them away from desktop instead of leaving mixed behavior in one route.

Expected: desktop does not render assistant product UI, while non-desktop behavior only remains if still intentionally supported.

**Step 3: Redirect user intent to task agents**

Where a desktop user would previously land on assistant creation or assistant management, redirect or replace the affordance with the local task-agent page.

Expected: there is one obvious place to create and manage delegated agents.

### Task 3: Remove remaining desktop assistant language from user-facing copy

**Files:**
- Modify: `/data/Deeting/deeting/messages/zh-CN/*.json`
- Modify: `/data/Deeting/deeting/messages/en/*.json`
- Modify: `/data/Deeting/deeting/components/common/hud/*`
- Modify: `/data/Deeting/deeting/components/chat/*`

**Step 1: Replace desktop assistant identity copy**

Remove desktop-facing copy that still suggests:

- selecting an assistant as the current chat identity
- switching assistant personalities inside chat
- installing assistants as the way to unlock delegated work

Expected: desktop language consistently teaches `persona + task agent`, not `assistant + task agent`.

**Step 2: Keep capability-oriented language where runtime already moved**

Preserve or reinforce language such as:

- enabled capability
- delegated agent
- local task agent
- imported agent profile

Expected: wording matches the actual runtime model instead of historical asset naming.

### Task 4: Define the Claude-agent import contract

**Files:**
- Create: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/import.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/types.rs`
- Modify: `/data/Deeting/deeting/lib/api/custom-task-agents.ts`

**Step 1: Treat Claude agents as profile sources, not runtime packages**

Define an importer contract that accepts:

- local directory path
- local single file path
- repo clone path or repo URL plus optional subdirectory

The importer should read markdown agents and produce `CustomTaskAgentProfile` payloads.

Expected: imported Claude agents enter the existing custom-task-agent control plane directly.

**Step 2: Define the field mapping**

Use a stable mapping such as:

- source filename or frontmatter `name` -> `name`
- frontmatter `description` -> `description`
- normalized markdown body -> `task_prompt`
- directory/category path -> `tags`
- default `invocation_kind = chat`
- default `discoverable = true`
- default `is_enabled = true`

Expected: imported profiles remain simple, inspectable, and editable in the current editor.

**Step 3: Add source metadata without changing runtime semantics**

Store import metadata such as:

- `source_kind = claude_agent`
- `source_path`
- `source_repo`
- `source_ref` or commit if imported from Git
- content hash or updated timestamp

Expected: future sync/update can identify whether an imported agent already exists.

### Task 5: Extend custom-task-agent persistence for imported-source tracking

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/store.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/types.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/setup.rs` if migration wiring is needed

**Step 1: Add optional imported-source fields**

Extend `custom_task_agent` persistence with optional metadata for imported agents, rather than inventing a second imported-agent table unless migration evidence proves it is needed.

Suggested fields:

- `source_kind`
- `source_path`
- `source_repo`
- `source_ref`
- `source_hash`

Expected: importer sync can be idempotent and update-aware.

**Step 2: Keep runtime profile shape backward compatible**

Any new fields should be optional so existing task agents keep working without migration-time behavior changes in the runtime.

Expected: preview, execution, indexing, and selection keep working for existing profiles.

### Task 6: Add importer commands to the Tauri custom-task-agent module

**Files:**
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/commands.rs`
- Create: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/import.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/commands.rs`

**Step 1: Add preview-first import commands**

Add commands for:

- preview Claude agent import from path/repo
- execute import
- resync imported agent set

Expected: the UI can show a proposed import list before creating records.

**Step 2: Reuse existing validation and indexing paths**

Imported agents should still flow through:

- custom task agent payload normalization
- binding validation
- custom task agent indexing

Expected: imported agents behave the same as manually created agents after import.

**Step 3: Keep importer ownership narrow**

Do not make the importer responsible for tool execution, runtime setup, or separate agent orchestration semantics.

Expected: importer only creates or updates profiles; runtime stays unchanged.

### Task 7: Add Claude-agent binding templates on top of existing binding catalogs

**Files:**
- Create: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/import_templates.rs`
- Modify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/commands.rs`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/*`

**Step 1: Define low-risk default templates**

Support optional template assignment based on source path or category naming, for example:

- `engineering/*` -> code/file-oriented MCP tools
- `design/*` -> image/design-oriented bindings
- `research/*` or `analysis/*` -> search/crawler/knowledge bindings

Expected: imported agents feel useful immediately without silently getting an over-broad tool surface.

**Step 2: Fail safe on unknown categories**

If no template matches, import the agent as prompt-only with empty bindings and let the user opt into tools later.

Expected: imported profiles are safe by default.

### Task 8: Build the task-agent import UI inside the existing desktop page

**Files:**
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx`
- Create: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-import-dialog.tsx`
- Modify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/use-task-agents.ts`
- Modify: `/data/Deeting/deeting/lib/api/custom-task-agents.ts`
- Modify: `/data/Deeting/deeting/messages/zh-CN/task-agents.json`
- Modify: `/data/Deeting/deeting/messages/en/task-agents.json`

**Step 1: Add import entry points**

Expose import actions such as:

- import from Claude agents directory
- import from local folder
- import from repo URL

Expected: users do not need a separate settings/debug page to bring external agents in.

**Step 2: Show import preview before save**

Preview should include:

- agent name
- short description
- source path
- inferred tags
- inferred binding template
- conflict/update status

Expected: users can understand what will be created or updated before committing.

**Step 3: Route imported agents into the normal editor after creation**

After import, the user should land back in the normal task-agent editor for further prompt or binding adjustments.

Expected: imported agents are first-class task agents, not a separate management lane.

### Task 9: Keep delegated execution truth unchanged while broadening the source of profiles

**Files:**
- Reference: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- Reference: `/data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/control_plane.rs`
- Reference: `/data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/runtime/execution_plane/worker_handler.rs`

**Step 1: Do not fork a second delegated-agent runtime**

Imported Claude agents must still execute through the existing custom-task-agent runtime.

Expected: main-assistant delegation keeps one execution path regardless of whether a profile was manually created or imported.

**Step 2: Keep host-owned tool access as the only tool truth**

Imported markdown agents do not define executable tools. Only Deeting bindings decide what imported agents can call.

Expected: the Claude-style integration matches Claude’s own model: prompt/profile from the agent file, tools from the host runtime.

### Task 10: Decide what assistant code remains temporarily for compatibility

**Files:**
- Modify: `/data/Deeting/docs/plans/2026-04-06-desktop-assistant-sunset-and-claude-agent-import.md`
- Reference: `/data/Deeting/deeting/src-tauri/src/modules/assistants/*`
- Reference: `/data/Deeting/deeting/src-tauri/src/modules/conversations/store.rs`

**Step 1: Keep data compatibility where it is still cheap**

For this pass, it is acceptable to keep:

- assistant tables
- historical `assistant_id` fields on conversation or memory rows
- non-desktop or asset-layer assistant APIs

Expected: product-surface simplification lands without forcing a risky data migration in the same patch.

**Step 2: Remove desktop reads before deleting tables**

Do not delete assistant storage first. First make sure desktop product surfaces and runtime no longer read it.

Expected: the architecture shrinks in the correct order: product surface, then control-plane reads, then storage cleanup.

### Task 11: Verification

**Files:**
- Verify: `/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/*`
- Verify: `/data/Deeting/deeting/app/[locale]/assistants/*`
- Verify: `/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/*`
- Verify: `/data/Deeting/deeting/src-tauri/src/modules/desktop_runtime/*`

**Step 1: Verify desktop assistant entry points are gone**

Run:

```bash
rg -n "assistants" deeting/app deeting/components deeting/messages | head -n 200
```

Expected:

- no desktop-primary navigation or CTA still points users toward assistant management
- any remaining matches are intentional cloud-only or compatibility references

**Step 2: Verify imported Claude agents become custom task agents**

Run targeted tests and/or command-level checks for:

- import preview
- import create/update
- imported profile indexing
- imported profile listing through `list_custom_task_agents`

Expected: imported profiles are returned by the existing task-agent APIs without special-case reads.

**Step 3: Verify delegated runtime still uses one execution path**

Run focused desktop-local task-agent preview tests plus any new importer tests.

Expected: manual and imported task agents both preview and execute through `custom_task_agent` runtime only.

**Step 4: Verify chat and desktop runtime remain assistant-free**

Run focused tests around:

- chat creation without assistant identity
- persona prompt injection
- worker delegation into explicit or auto-selected task agents

Expected: desktop runtime behavior does not regress while the product surface shrinks.

### Task 12: Commit strategy

**Step 1: Prefer a staged rollout**

Split the work into reviewable commits:

1. docs and product-boundary lock
2. desktop assistant surface removal
3. importer contract and persistence changes
4. importer commands and tests
5. task-agent import UI

Expected: each slice remains reversible and easy to review.

**Step 2: Use Lore commit protocol**

Every commit should explain:

- why assistant surface removal is product simplification, not mere deletion
- why Claude-agent import lands on `custom_task_agent` instead of a new runtime object
- what compatibility debt remains intentionally deferred

---

## Acceptance criteria

- Desktop users no longer see `assistant` as a first-class product object.
- The only desktop-visible delegated-agent object is `custom_task_agent`.
- Claude-style markdown agent directories can be imported into Deeting as local task agents.
- Imported agents use Deeting-owned bindings for tools and skills.
- Main-assistant delegation continues to use one runtime path: `custom_task_agent`.
- No new desktop runtime identity is reintroduced through the importer.

## Risks

- Deleting assistant product routes too early could break hidden desktop links or stale menu entries.
- Importing external markdown too loosely could create noisy or unusable task-agent prompts.
- Over-eager binding templates could accidentally give imported agents broader capabilities than intended.
- Historical `assistant_id` fields may still appear in low-level stores and cause naming confusion if not clearly scoped as compatibility only.

## Design rule

- Persona is the desktop user’s stable main identity.
- Delegation belongs to task agents only.
- Tools belong to the host, not to imported markdown profiles.
- Assistant is not a desktop product surface.
