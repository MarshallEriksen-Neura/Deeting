# Desktop TTS Provider Runtime Correction Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct the desktop-local TTS architecture so OpenAI, MiniMax, and Volcengine each use provider-accurate runtime adapters while preserving one shared `text_to_speech` invocation contract for task-agent/chat flows.

**Architecture:** Keep the upper-layer TTS invoke contract unified (`provider_model_id`, `text`, `voice`, `response_format`, `extra_params`) but stop forcing provider instance fields into a fake common schema. Use preset/provider/protocol as the routing anchor, store user secrets in provider credentials, store non-secret instance-specific provider fields in `instance.meta`, and let each adapter translate from the same resolved instance/model context into its own upstream HTTP protocol.

**Tech Stack:** Rust (Tauri desktop runtime), TypeScript/React, provider presets + provider instances + provider credentials, reqwest, serde_json, existing audio asset storage, targeted Rust/TS diagnostics, `cargo check --lib`.

**Provider doc references used to validate the architecture boundary:**
- OpenAI TTS: `POST /v1/audio/speech`
- MiniMax TTS: `POST /v1/t2a_v2`
- Volcengine OpenSpeech TTS: `POST /api/v3/tts/unidirectional` with `X-Api-App-Id`, `X-Api-Access-Key`, `X-Api-Resource-Id`

---

## Target truths

### Shared truths

- `preset` defines provider family, default base URL, protocol shape, and default protocol profiles.
- `provider instance` stores user-scoped non-secret instance fields in `meta`.
- `provider credential` stores the user secret.
- `task agent` only sends unified TTS invoke parameters and never owns provider-instance secrets or instance-specific headers.

### Provider-specific truths

- **OpenAI-compatible**
  - secret: provider credential `secret_key`
  - instance meta: usually none
  - runtime: generic provider request runtime can stay primary

- **MiniMax**
  - secret: provider credential `secret_key`
  - instance meta: none for phase one unless a later official requirement proves otherwise
  - runtime: dedicated MiniMax adapter
  - invoke mapping: `voice -> voice_setting.voice_id`

- **Volcengine OpenSpeech**
  - secret: provider credential `secret_key` -> `X-Api-Access-Key`
  - instance meta:
    - `app_id` -> `X-Api-App-Id`
    - `resource_id` -> `X-Api-Resource-Id`
  - runtime: dedicated Volcengine adapter

## Non-goals

- Do not add voice cloning.
- Do not add reference-audio upload.
- Do not force all provider instance fields into one generic voice form.
- Do not require `custom`-style connection testing for official presets.

---

### Task 1: Replace the incorrect “shared voice instance fields” assumption with provider-accurate config boundaries

**Files:**
- Modify: `docs/plans/2026-03-25-desktop-tts-provider-dispatch-refactor.md`
- Modify: `docs/plans/2026-03-25-desktop-tts-provider-config-reference.md`
- Create: `docs/plans/2026-03-25-desktop-tts-provider-runtime-correction.md`

**Step 1: Write the failing validation note**

- Record the architectural mismatches discovered during review:
  - Volcengine adapter was built against the wrong upstream protocol
  - `appkey` was treated as if it were a stable cross-provider field
  - provider-specific instance configuration was drifting away from the existing provider-instance model

**Step 2: Verify current mismatch evidence**

Run: inspect the existing adapter docs and current implementation side-by-side

Expected: clear evidence that Volcengine OpenSpeech needs `X-Api-App-Id`, `X-Api-Access-Key`, and `X-Api-Resource-Id`, while MiniMax and OpenAI do not share those fields

**Step 3: Write the correction plan**

- Preserve one unified invoke contract
- Re-anchor runtime routing on provider/preset/protocol
- Re-anchor user configuration on provider instance + credential

**Step 4: Confirm the new plan is the source of truth**

Run: `git diff -- docs/plans/2026-03-25-desktop-tts-provider-runtime-correction.md`

Expected: the new plan clearly supersedes the mistaken assumptions from the earlier draft

### Task 2: Make provider protocol detection accurate enough to route official presets correctly

**Files:**
- Modify: `deeting/lib/providers/protocol.ts`
- Modify: `deeting/lib/providers/__tests__/protocol.test.ts`
- Modify: `deeting/src-tauri/src/modules/providers/store/instances.rs` only if protocol normalization needs extension

**Step 1: Write the failing test**

- Add protocol helper assertions for:
  - `minimax` -> `minimax`
  - `volcengine` / `sami` / `bytedance` -> `volcengine`

**Step 2: Run test to verify it fails**

Run: TS diagnostics or targeted Jest for `lib/providers/__tests__/protocol.test.ts`

Expected: FAIL until provider inference no longer collapses everything non-anthropic into `openai`

**Step 3: Write minimal implementation**

- Extend provider protocol inference so official MiniMax and Volcengine presets resolve to provider-accurate protocol hints.
- Keep explicit protocol override precedence intact.

**Step 4: Run test to verify it passes**

Run: targeted diagnostics/Jest for `protocol.test.ts`

Expected: PASS

### Task 3: Extend provider instance create/edit flow for Volcengine OpenSpeech instance metadata

**Files:**
- Modify: `deeting/lib/api/providers.ts`
- Modify: `deeting/lib/platform/adapters/desktop/provider-service.ts`
- Modify: `deeting/lib/platform/adapters/desktop/mappers.ts`
- Modify: `deeting/components/providers/connect-provider-drawer.tsx`
- Modify: `deeting/components/providers/providers-list.tsx`
- Modify: `deeting/messages/en/providers.json`
- Modify: `deeting/messages/zh-CN/providers.json`
- Modify: `deeting/src-tauri/src/modules/providers/types.rs`
- Modify: `deeting/src-tauri/src/modules/providers/store/instances.rs`

**Step 1: Write the failing test / diagnostics**

- Add or use diagnostics showing:
  - `ProviderInstanceCreate/Update/Response` do not yet expose Volcengine-specific instance fields
  - the drawer cannot round-trip those fields for edit/save

**Step 2: Run verification to show the gap**

Run: TS diagnostics on:
- `components/providers/connect-provider-drawer.tsx`
- `lib/api/providers.ts`
- `components/providers/providers-list.tsx`

Expected: current implementation either lacks fields or cannot round-trip them until the schema/UI/store changes are made

**Step 3: Write minimal implementation**

- Add instance-level fields for Volcengine:
  - `app_id`
  - `resource_id`
- Keep them in instance metadata, not preset auth config
- Only show them in the drawer when the selected preset/provider resolves to Volcengine OpenSpeech
- Ensure edit mode rehydrates those fields from instance meta

**Step 4: Run verification**

Run: TS diagnostics on the edited files

Expected: PASS

### Task 4: Correct the Volcengine adapter to match the official OpenSpeech protocol

**Files:**
- Modify: `deeting/src-tauri/src/modules/voice/tts/volcengine.rs`
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`
- Modify: `deeting/src-tauri/src/modules/voice/types.rs` only if helper typing needs adjustment

**Step 1: Write the failing test**

- Add adapter tests asserting:
  - request URL uses `/api/v3/tts/unidirectional`
  - request headers include:
    - `X-Api-App-Id`
    - `X-Api-Access-Key`
    - `X-Api-Resource-Id`
  - request body matches the OpenSpeech protocol expectation for phase-one pure TTS

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the adapter no longer uses the wrong `api/v1/invoke` path/body

**Step 3: Write minimal implementation**

- Remove the incorrect `appkey/token/namespace/payload` request shape.
- Build the Volcengine request from:
  - credential secret -> `X-Api-Access-Key`
  - `instance.meta.app_id`
  - `instance.meta.resource_id`
- Keep TTS invoke parameters (`text`, `voice`, `response_format`) flowing from the unified request object into the provider-specific body.
- Preserve audio persistence into the shared audio asset path.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 5: Keep MiniMax as a provider-specific adapter, but validate it against the official HTTP doc instead of over-generalizing fields

**Files:**
- Modify: `deeting/src-tauri/src/modules/voice/tts/minimax.rs`
- Modify: `docs/plans/2026-03-25-desktop-tts-provider-config-reference.md`

**Step 1: Write the failing test**

- Add/refresh tests asserting:
  - request path stays `/v1/t2a_v2`
  - auth stays `Bearer`
  - `voice` maps to `voice_setting.voice_id`
  - non-streaming response reads `data.audio` as hex by default

**Step 2: Run verification to confirm assumptions**

Run: local adapter unit tests / `cargo check --lib`

Expected: PASS only if MiniMax remains aligned with the official HTTP API contract

**Step 3: Tighten implementation if needed**

- Keep MiniMax-specific adapter fields limited to what the official doc supports.
- Do not invent fake shared fields just to mirror Volcengine.

**Step 4: Run verification**

Run: `cargo check --lib`

Expected: PASS

### Task 6: Route TTS adapters primarily by provider instance protocol/preset identity, not by a newly invented TTS-specific config scheme

**Files:**
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`
- Modify: `deeting/src-tauri/src/modules/voice/dispatch.rs`
- Modify: `deeting/src-tauri/src/modules/voice/types.rs`

**Step 1: Write the failing test**

- Add tests asserting route resolution precedence:
  - explicit `model.config_override.voice_runtime` may still override in special cases
  - otherwise routing follows resolved instance protocol / preset provider
- Verify:
  - `openai` -> OpenAI adapter
  - `minimax` -> MiniMax adapter
  - `volcengine` -> Volcengine adapter

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the routing logic no longer depends on the mistaken artificial voice config layer

**Step 3: Write minimal implementation**

- Make `voice_runtime` an override, not the default required path.
- Treat provider protocol/preset as the main routing source of truth.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 7: Keep the task-agent voice editor unified, but remove any expectation that it carries provider-instance configuration

**Files:**
- Modify: `deeting/app/[locale]/dashboard/user/task-agents/components/voice-task-agent-editor.tsx`
- Modify: `deeting/app/[locale]/dashboard/user/task-agents/components/task-agent-voice-config.ts`
- Modify: `deeting/components/audio/audio-result-panel.tsx` only if label polish helps

**Step 1: Write the failing test / checklist**

- Verify current voice editor only stores invoke-time values:
  - `voice`
  - `response_format`
  - `speed`
  - `extra_params`

**Step 2: Review for drift**

Run: inspect current editor + config helper against the new provider-instance responsibility boundary

Expected: no provider-instance-only field should be forced into task-agent config

**Step 3: Write minimal implementation**

- Keep the editor unified.
- Update helper text only if it currently implies provider-instance fields belong there.

**Step 4: Verify**

Run: targeted TS diagnostics / component tests if touched

Expected: PASS

### Task 8: Verification and rollback sanity check

**Files:**
- Test: `deeting/src-tauri/src/modules/voice/**/*.rs`
- Test: `deeting/components/providers/connect-provider-drawer.tsx`
- Test: `deeting/lib/providers/protocol.ts`

**Step 1: Run Rust verification**

Run: `cargo check --lib`

Expected: PASS

**Step 2: Run targeted frontend diagnostics**

Run diagnostics for:
- `connect-provider-drawer.tsx`
- `providers-list.tsx`
- `providers.ts`
- `protocol.ts`

Expected: PASS

**Step 3: Inspect diff**

Run: `git diff --stat`

Expected: changes concentrated in:
- provider protocol helpers
- provider instance schema/drawer/mappers
- Volcengine adapter correction
- small routing fixes

**Step 4: Manual architecture checklist**

- Official preset does not require test-connection before save.
- User secret stays in provider credential flow.
- Volcengine instance can store `app_id` + `resource_id`.
- MiniMax does not inherit fake Volcengine fields.
- Task-agent voice config remains provider-agnostic at invoke time.
