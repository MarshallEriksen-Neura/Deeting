# HTML Asset Socket V1 Plan

**Goal:** Ship a lightweight desktop-local HTML asset system. Users can create reusable HTML assets, the app can retrieve them on similar future prompts, and chat can render them in the current conversation without building a second runtime, a second chat page, or a heavy snapshot/refresh system.

**Product boundary:**
- `asset` is the reusable unit. The asset is primarily code: `HTML + CSS + JS + manifest`.
- `chat` is the trigger and display surface.
- `dashboard` is the management surface.
- `retrieval` decides whether a new prompt should reuse an existing asset.
- `render_runtime` is only the host/mount layer for `html.v1`, not a product brain.

**V1 principle:** treat HTML as a plug-in block that can be mounted into chat. Do not make V1 depend on snapshot freezing, live channels, generated template builders, or dashboard-driven replay flows.

---

### Target V1 Flow

1. User asks for a UI-capable result in chat.
2. AI can create HTML once, then call a dedicated `save_asset` tool.
3. `save_asset` stores:
   - `asset_id`
   - `name`
   - `match_hints`
   - `html entry`
   - `props_hint`
   - `output_example`
   - `data_mode` (`ai_data` or `self_fetch`)
4. Desktop indexes the asset locally after save.
5. On a future similar prompt, retrieval checks the local asset registry first.
6. If an asset is matched, the runtime feeds that asset contract back into the model.
7. The model returns either:
   - `asset_id + render_data`
   - or `asset_id + props`
8. Chat mounts the matched asset in the current conversation via `html.v1`.

---

### Architecture

**Asset manifest contract**
- `asset_id`: stable local identifier.
- `name`: user-facing title.
- `match_hints`: phrases or intent hints used for retrieval.
- `html_entry`: local asset HTML file path.
- `props_hint`: the parameters the model should extract from user prompts.
- `output_example`: example output shape used to steer future model responses.
- `data_mode`:
  - `ai_data`: model returns structured data for the asset.
  - `self_fetch`: asset JS fetches data itself from user-controlled endpoints.

**Execution modes**
- `ai_data`
  - Retrieval hits an asset.
  - The model is told which asset was matched and what output shape to produce.
  - Chat renders the stored HTML and injects `render_data`.
- `self_fetch`
  - Retrieval hits an asset.
  - The model only extracts `props`.
  - Chat renders the stored HTML and injects `props`.
  - Asset JS owns data fetching.

**Ownership**
- `render_runtime`
  - Owns HTML host rendering and data injection.
  - Does not own business-specific templates.
  - Does not own asset retrieval policy.
- `asset_registry`
  - Owns saved asset metadata and local indexing.
  - Becomes the source of truth for reusable HTML assets.
- `chat`
  - Owns prompt entry, retrieval trigger, and final rendered display.
- `dashboard`
  - Owns listing, editing metadata, pinning, archiving, and opening asset details.

---

### Convergence Rules

These rules keep current work from growing into a heavy parallel system.

**Keep in V1**
- `html.v1` iframe host
- local asset registry
- dashboard asset manager
- retrieval-before-normal-chat path
- `save_asset` tool
- `asset_id + render_data/props` chat rendering contract

**Downgrade to compatibility only**
- `snapshot_html`
- `refresh_spec`
- `pending-refresh`
- `last_refreshed_at`
- `live_channel_id`
- `allow_live_updates`

These fields and modules may remain in code temporarily, but they are not the V1 product path and should not gain new product semantics right now.

**Do not build in V1**
- snapshot freezing rules
- live data channels
- generated template builder
- cache-key strategy beyond what is already needed internally
- dashboard refresh that routes back through historical chat
- template gallery as a primary workflow

---

### Phase 1: Simplify The Runtime Contract

**Files:**
- Modify: `deeting/src-tauri/src/modules/render_runtime/...`
- Modify: `deeting/lib/chat/message-protocol.ts`
- Modify: `deeting/components/views/html-runtime-view.tsx`

**Deliverables:**
- Define the minimal render contract around `asset_id`, `render_data`, and `props`.
- Keep `html.v1` focused on mounting HTML and injecting data.
- Make current advanced fields optional compatibility metadata, not the main path.

**Acceptance criteria:**
- A matched asset can render in chat without replaying old conversations.
- `html.v1` can render user-supplied HTML using injected data or props.
- Runtime metadata stays small and understandable.

---

### Phase 2: Save Asset Tool And Asset Bundle Storage

**Files:**
- Modify: `deeting/src-tauri/src/modules/asset_registry/...`
- Modify: orchestration/tool registration files under `deeting/src-tauri/src/modules/...`

**Deliverables:**
- Add a `save_asset` tool that persists asset metadata plus local HTML bundle files.
- Store `output_example` and `props_hint` with the asset.
- Trigger local indexing automatically after save.

**Acceptance criteria:**
- First-time asset creation does not require manual dashboard setup.
- Saving an asset does not require coupling to one business vertical.
- The registry is storing reusable code assets, not only chat snapshots.

---

### Phase 3: Asset Retrieval And Prompt Backfeed

**Files:**
- Modify: desktop local orchestration path
- Modify: retrieval/indexing path around asset lookup

**Deliverables:**
- Add asset retrieval before the normal local chat/tool route.
- When an asset is matched, build a focused prompt supplement containing:
  - matched `asset_id`
  - `name`
  - `props_hint`
  - `output_example`
  - `data_mode`
- Let the model return only the data or props needed for that asset.

**Acceptance criteria:**
- Similar prompts can reuse the same asset without regenerating HTML.
- The model is guided by stored output shape rather than guessing from scratch.
- Retrieval miss cleanly falls back to the existing chat path.

---

### Phase 4: Chat Mount Path

**Files:**
- Modify: `deeting/components/chat/...`
- Modify: `deeting/hooks/chat/use-chat-messaging-service.ts`

**Deliverables:**
- Render matched assets directly in the current chat.
- Keep chat as the natural invocation surface.
- Avoid introducing a second dedicated runtime page or replay-only execution surface.

**Acceptance criteria:**
- Asset reuse feels like a normal new chat response.
- Users do not need to navigate back to historical messages to use an asset.
- Asset rendering is block-first and consistent with current chat UI.

---

### Phase 5: Dashboard As Manager

**Files:**
- Modify: `deeting/app/[locale]/dashboard/assets/...`
- Modify: local asset APIs as needed

**Deliverables:**
- Dashboard shows saved assets and asset metadata.
- Users can inspect, pin, archive, and manage assets from dashboard.
- Dashboard is not required for execution, only for management.

**Acceptance criteria:**
- Asset management is separate from chat history.
- The dashboard reflects reusable assets as first-class entities.
- Execution semantics stay in chat, not in a dashboard replay flow.

---

### Phase 6: Deferred Work

The following are intentionally deferred:
- snapshot/history freezing
- live update channel
- generated renderer builder
- renderer gallery
- scheduled triggers / subscriptions
- richer asset execution history

These can be layered on later only after the lightweight asset contract is stable.

---

### Verification

**Runtime verification**
- Add tests for the minimal asset render contract.
- Verify `html.v1` renders stored HTML with injected `render_data` or `props`.

**Registry verification**
- Add tests for `save_asset` validation and local persistence.
- Verify indexing runs after asset save.

**Retrieval verification**
- Add tests for matched-asset prompt backfeed.
- Verify retrieval hit and retrieval miss both follow the correct path.

**Manual verification**
- Save a weather-style HTML asset.
- Start a fresh chat and ask a similar weather question.
- Confirm the system reuses the saved HTML asset instead of generating new HTML.
