# Desktop TTS Provider Dispatch Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor desktop-local `text_to_speech` execution so OpenAI, MiniMax, and Volcengine TTS run through one stable entrypoint with provider-specific adapters, while explicitly limiting phase one to pure text-to-speech synthesis only.

**Architecture:** Introduce a new `voice/` module under the Tauri runtime that owns TTS dispatch, shared provider resolution, and provider-specific synthesis adapters. Keep the external TTS contract narrow (`text`, `voice`, `response_format`, `extra_params`) and route requests by the selected provider model's bound preset/runtime mode rather than model-name heuristics. Preserve the existing chat-first `audio.result` output contract and reuse the current audio storage path.

**Tech Stack:** Rust (Tauri desktop runtime), serde_json, reqwest, existing provider store/runtime, existing audio asset storage, targeted Rust tests, `cargo check --lib`.

---

## Runtime configuration conventions

To keep dispatch deterministic across presets and models, phase one should use these metadata conventions:

- `model.config_override.voice_runtime`
  - preferred value when a single model needs explicit routing
  - accepted values:
    - `openai_tts`
    - `minimax_tts`
    - `volcengine_tts`
- `instance.meta.voice_runtime`
  - use when the whole provider instance should route to one adapter
- `preset.provider`
  - fallback only; useful for simple presets such as `openai`, `minimax`, or `volcengine_tts`

Recommended provider-side setup for phase one:

- OpenAI-compatible preset
  - `preset.provider = "openai"`
  - `model.config_override.voice_runtime = "openai_tts"` only when explicit override is needed
- MiniMax preset
  - `preset.provider = "minimax"`
  - `model.config_override.voice_runtime = "minimax_tts"` when mixed-provider instances could exist
- Volcengine preset
  - `preset.provider = "volcengine_tts"` or `volcengine`
  - `model.config_override.voice_runtime = "volcengine_tts"` recommended
  - `app_id` and `resource_id` should live in `instance.meta`

### Task 1: Freeze the phase-one capability boundary around pure TTS synthesis

**Files:**
- Create: `docs/plans/2026-03-25-desktop-tts-provider-dispatch-refactor.md`
- Modify: `deeting/src-tauri/src/modules/voice_capabilities/types.rs`
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/voice_config.rs`
- Modify: `deeting/lib/ai/capability-settings.ts` only if labels/help text need alignment

**Step 1: Write the failing test**

- Add or update targeted type/unit tests asserting:
  - `TtsRequest` remains text-first and does not require uploaded audio
  - phase-one TTS config only covers synthesis-safe fields such as `voice`, `response_format`, and simple extra params
  - no reference-audio-only field becomes required in the active TTS contract

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: either existing compile/tests show missing guardrails, or new assertions fail until the contract comments/tests are updated.

**Step 3: Write minimal implementation**

- Add concise comments/docs around `TtsRequest` and voice config helpers clarifying:
  - this path is for pure synthesis only
  - reference-audio cloning is a future capability, not part of `text_to_speech`
- Keep the wire contract unchanged unless a tiny cleanup is needed for clarity.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 2: Introduce a dedicated `voice/` runtime module with shared dispatch types

**Files:**
- Create: `deeting/src-tauri/src/modules/voice/mod.rs`
- Create: `deeting/src-tauri/src/modules/voice/types.rs`
- Create: `deeting/src-tauri/src/modules/voice/shared.rs`
- Create: `deeting/src-tauri/src/modules/voice/dispatch.rs`
- Modify: `deeting/src-tauri/src/modules/mod.rs`

**Step 1: Write the failing test**

- Add targeted Rust tests asserting:
  - the new `voice` module exposes a single TTS entrypoint
  - shared context resolution can load provider model, instance, preset, and credential
  - dispatch mode can be determined without reading model-name substrings

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the new module tree and exported types exist.

**Step 3: Write minimal implementation**

- Add `voice/types.rs` for small shared structs such as:
  - `ResolvedTtsContext`
  - `VoiceRuntimeMode`
- Add `voice/shared.rs` helpers for:
  - resolving provider model / instance / preset / connection
  - normalizing runtime mode from model/instance/preset metadata
  - converting provider-specific responses into `AudioResultPayload`
- Add `voice/dispatch.rs` with one public entrypoint, for example:
  - `request_text_to_speech(...)`
- Register the module in [mod.rs](/data/Deeting/deeting/src-tauri/src/modules/mod.rs).

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 3: Move the current generic OpenAI-compatible TTS path into a provider-specific adapter

**Files:**
- Create: `deeting/src-tauri/src/modules/voice/tts/mod.rs`
- Create: `deeting/src-tauri/src/modules/voice/tts/openai.rs`
- Modify: `deeting/src-tauri/src/modules/voice_capabilities/tts.rs`
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - the old OpenAI-compatible request body shape is preserved
  - audio byte-stream and direct-URL response handling still work
  - the adapter returns the same `AudioResultPayload` contract as today

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the logic is moved and wired through the new adapter path.

**Step 3: Write minimal implementation**

- Move the existing body-building and raw-response handling from [tts.rs](/data/Deeting/deeting/src-tauri/src/modules/voice_capabilities/tts.rs#L15) into `voice/tts/openai.rs`.
- Keep using `prepare_provider_request(...)` and `send_prepared_request_raw(...)`.
- Reduce `voice_capabilities/tts.rs` to either:
  - a compatibility shim delegating to `voice::dispatch`, or
  - a thin wrapper retained temporarily to minimize churn.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 4: Add MiniMax pure TTS adapter

**Files:**
- Create: `deeting/src-tauri/src/modules/voice/tts/minimax.rs`
- Modify: `deeting/src-tauri/src/modules/voice/tts/mod.rs`
- Modify: `deeting/src-tauri/src/modules/voice/dispatch.rs`
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`

**Step 1: Write the failing test**

- Add adapter tests asserting:
  - the MiniMax request shape is built from the common `TtsRequest`
  - provider-specific voice selection maps to the right request field(s)
  - audio byte responses persist correctly into the shared audio asset path

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the MiniMax adapter exists and dispatch can reach it.

**Step 3: Write minimal implementation**

- Implement a MiniMax-specific HTTP request builder using the provider model / instance credential context from `voice/shared.rs`.
- Keep MiniMax mapping isolated in its own file.
- Do not introduce cloning/reference-audio flows in this phase.
- Normalize the final result into the same `AudioResultPayload` used by OpenAI-compatible TTS.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 5: Add Volcengine pure TTS adapter

**Files:**
- Create: `deeting/src-tauri/src/modules/voice/tts/volcengine.rs`
- Modify: `deeting/src-tauri/src/modules/voice/tts/mod.rs`
- Modify: `deeting/src-tauri/src/modules/voice/dispatch.rs`
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`

**Step 1: Write the failing test**

- Add adapter tests asserting:
  - Volcengine request assembly supports its dedicated invoke contract
  - response JSON containing base64 audio can be decoded into persisted audio bytes
  - provider-specific auth data is resolved without polluting the OpenAI-compatible adapter path

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the Volcengine adapter exists and the base64 response path is implemented.

**Step 3: Write minimal implementation**

- Implement a Volcengine-only adapter that does not depend on the generic `prepare_provider_request(...)` assumptions.
- Assemble the request exactly as needed for Volcengine pure TTS.
- Decode returned base64 audio and persist it via the shared audio helper.
- Keep all provider-specific parsing and error extraction inside this file.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 6: Implement runtime-mode dispatch using provider-bound metadata instead of model-name heuristics

**Files:**
- Modify: `deeting/src-tauri/src/modules/voice/dispatch.rs`
- Modify: `deeting/src-tauri/src/modules/voice/shared.rs`
- Modify: `deeting/src-tauri/src/modules/providers/store/models.rs` only if a small helper is needed
- Modify: `deeting/src-tauri/src/modules/providers/types.rs` only if metadata parsing helpers are needed

**Step 1: Write the failing test**

- Add tests asserting dispatch precedence such as:
  - `model.config_override.voice_runtime`
  - `instance.meta.voice_runtime`
  - fallback to `preset.provider`
- Verify that:
  - `openai` routes to `openai_tts`
  - `minimax` routes to `minimax_tts`
  - `volcengine_tts` routes to `volcengine_tts`

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until dispatch precedence and fallback rules are implemented.

**Step 3: Write minimal implementation**

- Define a small runtime-mode resolver with explicit accepted values:
  - `openai_tts`
  - `minimax_tts`
  - `volcengine_tts`
- Prefer metadata-driven dispatch over substring matching on model IDs.
- Keep fallback logic simple and well-commented.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 7: Rewire the custom task-agent TTS callsite to the new dispatch entrypoint

**Files:**
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/voice_capabilities/tts.rs`
- Test: `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`

**Step 1: Write the failing test**

- Add targeted runtime tests asserting:
  - `CustomTaskAgentInvocationKind::TextToSpeech` still returns `audios: [...]`
  - the task-agent path no longer depends directly on the legacy generic TTS module
  - adapter-specific results still serialize cleanly into preview output

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the callsite is rewired to the new dispatch layer.

**Step 3: Write minimal implementation**

- Replace the direct call to [request_provider_text_to_speech](/data/Deeting/deeting/src-tauri/src/modules/voice_capabilities/tts.rs#L52) in [custom_task_agents/runtime.rs](/data/Deeting/deeting/src-tauri/src/modules/custom_task_agents/runtime.rs#L234) with the new `voice::dispatch` entrypoint.
- Preserve the existing `audios` result contract.
- Leave higher-level chat rendering unchanged.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 8: Add regression tests and verification for the three-adapter pure TTS rollout

**Files:**
- Test: `deeting/src-tauri/src/modules/voice/**/*.rs`
- Test: `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- Test: `deeting/src-tauri/src/modules/voice_capabilities/tts.rs`

**Step 1: Run targeted Rust checks**

Run: `cargo check --lib`

Expected: PASS

**Step 2: Run targeted voice/runtime tests**

Run: `cargo test voice --lib -- --nocapture`

Expected: PASS for new dispatch and adapter tests

**Step 3: Inspect changed surface**

Run: `git diff --stat`

Expected: changes concentrated in `src-tauri/src/modules/voice/`, `custom_task_agents/runtime.rs`, and small compatibility edits only

**Step 4: Manual behavior checklist**

- Confirm a provider model bound to OpenAI-compatible TTS still synthesizes normally.
- Confirm a provider model bound to MiniMax resolves through the MiniMax adapter.
- Confirm a provider model bound to Volcengine resolves through the Volcengine adapter and returns a playable audio asset.
- Confirm no part of this phase requires reference-audio upload or voice cloning setup.
