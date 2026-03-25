# Chat Voice Capability Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a modular voice capability foundation that keeps `TTS` and `STT` inside the chat-only architecture, with `TTS` as the first implemented capability and `STT` contract/module boundaries defined for future rollout.

**Architecture:** Introduce audio-specific storage and render-block modules, evolve custom task agents from hardcoded business enums toward `chat | single_capability`, add an `audio.result` chat block/view, and land a first `text_to_speech` execution path that produces playable audio assets and persists them through the existing conversation block system.

**Tech Stack:** Rust (Tauri desktop runtime), TypeScript/React 19, existing provider runtime, asset/object storage helpers, chat block renderer, Zustand chat state, serde_json, targeted Jest tests, `cargo check --lib`.

---

### Task 1: Define shared audio result and voice capability types

**Files:**
- Create: `deeting/src-tauri/src/modules/audio/types.rs`
- Create: `deeting/src-tauri/src/modules/voice_capabilities/types.rs`
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/types.rs`
- Modify: `deeting/lib/chat/message-protocol.ts`

**Step 1: Write the failing test**

- Add targeted type/unit tests asserting:
  - task agent execution model can represent `single_capability`
  - voice capabilities enumerate `text_to_speech` and `speech_to_text`
  - `audio.result` is a valid UI block contract

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: compile/type failures until the new structs/enums are introduced and wired.

**Step 3: Write minimal implementation**

- Add audio output structs shared by runtime and view rendering.
- Evolve task agent invocation modeling away from image-only business enum growth.
- Extend chat message protocol typing to support `audio.result`.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 2: Add audio asset storage and `audio.result` render helpers

**Files:**
- Create: `deeting/src-tauri/src/modules/audio/storage.rs`
- Create: `deeting/src-tauri/src/modules/audio/result_blocks.rs`
- Modify: `deeting/src-tauri/src/modules/audio/mod.rs`
- Modify: `deeting/src-tauri/src/modules/providers/commands.rs` only if shared object-storage helpers need exports

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - generated audio can be persisted to the same asset/object storage strategy used by chat/image assets
  - an `audio.result` block can be built from persisted audio metadata

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the new audio storage/result modules exist.

**Step 3: Write minimal implementation**

- Reuse the existing asset/object-storage primitives where possible.
- Build a small helper that turns audio metadata into a standard render block payload.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 3: Implement first-pass `TTS` capability runtime

**Files:**
- Create: `deeting/src-tauri/src/modules/voice_capabilities/tts.rs`
- Modify: `deeting/src-tauri/src/modules/providers/request_runtime.rs` if capability wiring is needed
- Modify: `deeting/src-tauri/src/modules/providers/protocols/bridge.rs`
- Modify: `deeting/src-tauri/src/modules/providers/commands.rs`

**Step 1: Write the failing test**

- Add Rust tests asserting:
  - a `text_to_speech` provider request can be built from canonical input
  - `voice`, `response_format`, and provider-specific extra params survive render context
  - response handling yields an audio asset reference suitable for block rendering

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the TTS execution path exists.

**Step 3: Write minimal implementation**

- Add canonical `TTS` execution entrypoint.
- Reuse provider request runtime rather than inventing a separate HTTP stack.
- Keep support narrow: few providers / OpenAI-compatible path are acceptable for phase one.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 4: Integrate `TTS` with custom task agents as `single_capability`

**Files:**
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/image_config.rs` or split into capability-scoped config modules
- Create: `deeting/src-tauri/src/modules/custom_task_agents/voice_config.rs`
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/store.rs` only if validation constraints change

**Step 1: Write the failing test**

- Add targeted tests asserting:
  - a voice-capable task agent can hold default `TTS` params
  - preview execution of a `TTS` task agent returns audio-oriented payload, not image/text fallback

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL because task agents do not yet know how to execute a voice capability path.

**Step 3: Write minimal implementation**

- Add capability-scoped config helpers similar to image config.
- Route `single_capability:text_to_speech` task agents into the new `TTS` runtime.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 5: Add `audio.result` frontend rendering

**Files:**
- Create: `deeting/components/views/audio-result-view.tsx`
- Modify: `deeting/components/views/registry.ts`
- Create: `deeting/components/audio/audio-result-panel.tsx`
- Modify: `deeting/components/chat/messages/ai-response-bubble.tsx` only if block-specific polish is needed

**Step 1: Write the failing test**

- Add frontend tests asserting:
  - `audio.result` view type resolves through the registry
  - the panel renders playable metadata and handles asset URLs

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --runTestsByPath 'components/chat/messages/__tests__/ai-response-bubble.test.tsx'`

Expected: FAIL until the new audio view exists and is registered.

**Step 3: Write minimal implementation**

- Mirror the current `image.result` view pattern.
- Keep UI lean: title, model/voice, duration when available, and play control.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand --runTestsByPath 'components/chat/messages/__tests__/ai-response-bubble.test.tsx'`

Expected: PASS

### Task 6: Define `STT` contract and module boundary without full UX rollout

**Files:**
- Create: `deeting/src-tauri/src/modules/voice_capabilities/stt.rs`
- Modify: `deeting/src-tauri/src/modules/voice_capabilities/mod.rs`
- Modify: `deeting/lib/ai/capability-settings.ts`
- Modify: `deeting/src-tauri/src/modules/custom_task_agents/voice_config.rs`

**Step 1: Write the failing test**

- Add targeted type/runtime tests asserting:
  - canonical STT request struct exists
  - provider/runtime config accepts language, response_format, timestamp_granularities
  - STT runtime returns transcript-oriented result shape

**Step 2: Run test to verify it fails**

Run: `cargo check --lib`

Expected: FAIL until the `STT` module and contract are defined.

**Step 3: Write minimal implementation**

- Define the module, types, and placeholders for STT runtime invocation.
- Do not yet wire a full recorder/product flow.
- Make sure future provider integration can plug in without touching chat architecture again.

**Step 4: Run test to verify it passes**

Run: `cargo check --lib`

Expected: PASS

### Task 7: Verification

**Files:**
- Test: `deeting/components/views/registry.ts`
- Test: `deeting/src-tauri/src/modules/custom_task_agents/runtime.rs`
- Test: `deeting/src-tauri/src/modules/voice_capabilities/*.rs`

**Step 1: Run targeted frontend tests**

Run: `npm test -- --runInBand --runTestsByPath 'components/chat/messages/__tests__/ai-response-bubble.test.tsx' 'components/chat/console/__tests__/controls-container.test.tsx'`

Expected: PASS

**Step 2: Run targeted task-agent/frontend foundation tests**

Run: `npm test -- --runInBand --runTestsByPath 'hooks/chat/task-agent-mention.test.ts' 'app/[locale]/dashboard/user/task-agents/components/task-agent-image-config.test.ts' 'app/[locale]/dashboard/user/task-agents/components/task-agents-client.test.tsx'`

Expected: PASS

**Step 3: Run Rust compile verification**

Run: `cargo check --lib`

Expected: PASS

**Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: voice/audio modules, chat view registry/rendering, task-agent runtime/config, and plan docs only.
