# Desktop Image Generation Provider Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add form-first desktop image-generation provider configuration so image models can submit direct or async-poll requests using model-level protocol settings instead of hardcoded OpenAI-style defaults, while establishing a canonical request that already covers both text-to-image and image-to-image flows.

**Architecture:** Extend the model editor and provider update payload to carry image-generation config into `config_override`, pass the full canonical image task payload including `image_url` into the provider runtime, and reuse the existing Rust async-poll machinery in `image.rs` by wiring it to model-configured request and extraction settings. Keep the primary UX structured and form-first, with advanced JSON as a fallback.

**Tech Stack:** Next.js/React 19, TypeScript, Zod schemas, Tauri Rust runtime, serde_json, existing provider request runtime, Rust tests, React component tests where already present.

---

### Task 1: Expand API and view-model types to carry image config

**Files:**
- Modify: `deeting/lib/api/providers.ts`
- Modify: `deeting/components/models/types.ts`
- Modify: `deeting/lib/platform/adapters/desktop/types.ts`
- Modify: `deeting/lib/platform/adapters/desktop/mappers.ts`

**Step 1: Write the failing test**

- Add or update TypeScript tests around model mapping/schema parsing so a desktop provider model with `config_override.image_generation` survives API parsing and mapping into the UI model.

**Step 2: Run test to verify it fails**

Run: `bun test deeting/store/__tests__/image-generation-store.test.ts`

Expected: existing test harness stays green, and any new mapping-focused test fails until the new image config fields are exposed.

**Step 3: Write minimal implementation**

- Add typed image protocol config structures to the frontend provider model types.
- Extend `ProviderModelResponseSchema` / `ProviderModelUpdateSchema` to include `config_override`.
- Ensure desktop mapper preserves `config_override` into the UI model.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/store/__tests__/image-generation-store.test.ts`

Expected: PASS, plus new parsing/mapping assertions pass.

### Task 2: Add image-generation form state and payload building in model editor

**Files:**
- Modify: `deeting/components/models/model-config-panel.tsx`
- Modify: `deeting/components/models/model-accordion.tsx` if prop plumbing changes
- Modify: `deeting/messages/en/models.json`
- Modify: `deeting/messages/zh-CN/models.json`

**Step 1: Write the failing test**

- Add component tests for the model config panel that verify:
  - image-capable models show an Image Provider Configuration section
  - switching `direct` / `async_poll` updates local form state
  - save payload includes `config_override.image_generation`

**Step 2: Run test to verify it fails**

Run: `bun test deeting/components/models --runInBand`

Expected: FAIL because the image config section and payload logic do not exist yet.

**Step 3: Write minimal implementation**

- Add structured form state for image provider config:
  - submit mode
  - submit path override if needed
  - template engine
  - reference-image support toggle / hint
  - request template
  - default headers
  - async poll fields
  - advanced JSON fallback
- Merge the image config into `payload.config_override`.
- Keep chat-specific request mode behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `bun test deeting/components/models --runInBand`

Expected: PASS

### Task 3: Pass the full canonical image task payload into runtime

**Files:**
- Modify: `deeting/src-tauri/src/modules/image_generation/commands.rs`
- Modify: `deeting/src-tauri/src/modules/ai_upstream/image.rs`
- Modify: `deeting/src-tauri/src/modules/image_generation/store.rs`
- Modify: `deeting/src-tauri/src/modules/image_generation/types.rs` if helper structs are useful

**Step 1: Write the failing test**

- Add Rust tests asserting that image-generation runtime receives and renders:
  - `negative_prompt`
  - `aspect_ratio`
  - `num_outputs`
  - `steps`
  - `cfg_scale`
  - `seed`
  - `response_format`
  - `image_url`
  - `extra_params`

**Step 2: Run test to verify it fails**

Run: `cargo test prepare_provider_request_preserves_prompt_for_image_generation_custom_provider --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL or incomplete assertions until the canonical payload includes the extra image fields.

**Step 3: Write minimal implementation**

- Change `request_provider_image_generation(...)` to accept a richer image request payload instead of only `model` and `prompt`.
- Persist and load `image_url` in the local image task store so img2img/reference-image requests survive async execution.
- Build `request_data` from the full local image task record.
- Preserve `prompt` support while threading all other image task fields into render context.

**Step 4: Run test to verify it passes**

Run: `cargo test prepare_provider_request_preserves_prompt_for_image_generation_custom_provider --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS, subject to any unrelated pre-existing workspace failures being explicitly called out.

### Task 4: Wire image config into provider runtime resolution

**Files:**
- Modify: `deeting/src-tauri/src/modules/providers/request_runtime.rs`
- Modify: `deeting/src-tauri/src/modules/providers/protocols/bridge.rs`
- Modify: `deeting/src-tauri/src/modules/providers/store/models.rs` only if normalization helpers are required

**Step 1: Write the failing test**

- Add Rust tests covering:
  - `config_override.image_generation.request_template` is used for image capability
  - `async_config` under image capability yields submit + poll behavior
  - direct image result extraction still works

**Step 2: Run test to verify it fails**

Run: `cargo test image_generation --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because image-specific config is not yet resolved from the model override path in a structured way.

**Step 3: Write minimal implementation**

- Make image capability config read from the model-level override contract expected by the form.
- Keep the general provider runtime generic; do not branch on provider name.
- Reuse the existing `async_config` contract instead of inventing a second poller.

**Step 4: Run test to verify it passes**

Run: `cargo test image_generation --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS, or PASS for the targeted tests if unrelated workspace failures still block the full pattern.

### Task 5: Add image request test/debug surface in the model editor

**Files:**
- Modify: `deeting/components/models/model-config-panel.tsx`
- Modify: `deeting/lib/platform/core/types.ts`
- Modify: `deeting/lib/platform/adapters/desktop/provider-service.ts`
- Modify: `deeting/src-tauri/src/modules/providers/commands.rs`
- Modify: `deeting/src-tauri/src/modules/providers/types.rs`

**Step 1: Write the failing test**

- Add UI or command-level tests for a new image model test action that returns:
  - resolved URL
  - rendered request body
  - submit response
  - async poll status/result when applicable
  - optional `image_url` debug input for reference-image verification

**Step 2: Run test to verify it fails**

Run: `cargo test provider_model_test --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: FAIL because the existing model test surface only knows the generic prompt-based probe.

**Step 3: Write minimal implementation**

- Extend the model test command to support image-capable models with debug output.
- Surface the debug response in the model editor UI without changing the existing chat test path.

**Step 4: Run test to verify it passes**

Run: `cargo test provider_model_test --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS for the targeted image test path, with any unrelated pre-existing failures called out separately.

### Task 6: Verification

**Files:**
- Test: `deeting/src-tauri/src/modules/ai_upstream/image.rs`
- Test: `deeting/src-tauri/src/modules/providers/request_runtime.rs`
- Test: `deeting/components/models/model-config-panel.tsx`

**Step 1: Run targeted frontend tests**

Run: `bun test deeting/components/models --runInBand`

Expected: PASS

**Step 2: Run targeted Rust tests**

Run: `cargo test image_generation --manifest-path deeting/src-tauri/Cargo.toml -- --nocapture`

Expected: PASS for the added image-generation tests, or explicit evidence of unrelated existing failures.

**Step 3: Run formatting**

Run: `cargo fmt --manifest-path deeting/src-tauri/Cargo.toml`

Expected: PASS

**Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: model editor, provider API/types, image runtime, and plan docs only.
