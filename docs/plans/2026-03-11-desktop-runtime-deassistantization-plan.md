# Desktop Runtime De-assistantization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove assistant as a desktop chat runtime actor and replace it with a fixed user persona plus dynamic capability attach plus separate skill-doc retrieval.

**Architecture:** Desktop chat stops reading assistant identity as the primary runtime state. The Tauri local orchestrator always injects a persisted persona prompt from desktop config, while JIT / expert routing only attaches capability hints, tools, and skill recipes. Assistant remains an asset-layer object for authoring and metadata, but no longer drives runtime identity.

**Tech Stack:** Next.js 16, React 19, Jest, Tauri v2, Rust, SQLite desktop config/state, local capability discovery

---

### Task 1: Add fixed desktop persona config

**Files:**
- Modify: `deeting/lib/api/desktop-config.ts`
- Modify: `deeting/app/[locale]/settings/components/agent-settings-card.tsx`
- Modify: `deeting/messages/zh-CN/settings.json`
- Modify: `deeting/messages/en/settings.json`
- Test: `deeting/components/chat/console/__tests__/controls-container.test.tsx`

**Step 1: Add a desktop config key**

Add a new key next to `maxAgenticRounds`, for example:

```ts
export const DESKTOP_CONFIG_KEYS = {
  maxAgenticRounds: "max_agentic_rounds",
  personaPrompt: "chat.persona_prompt",
  authToken: "auth.token",
  scoutBaseUrl: "scout.base_url",
} as const;
```

**Step 2: Extend the desktop settings card**

Add a multiline persona prompt editor to `AgentSettingsCard` using `getDesktopConfig` / `setDesktopConfig`. Keep this field desktop-only and clearly label it as the fixed reply style / persona prompt.

**Step 3: Add copy in i18n files**

Add title, description, placeholder, help text, save success, and save failure keys for the new persona prompt field.

**Step 4: Add a focused UI test**

Write or extend a Jest test that renders the settings card, mocks desktop config reads/writes, edits the persona text, and verifies the save action uses `DESKTOP_CONFIG_KEYS.personaPrompt`.

**Step 5: Run the focused frontend test**

Run:

```bash
cd /data/Deeting/deeting && npm test -- --runTestsByPath components/chat/console/__tests__/controls-container.test.tsx
```

Expected: existing chat console tests still pass, or the new settings test file passes if you add a dedicated test path.

---

### Task 2: Remove assistant selection from desktop chat state

**Files:**
- Modify: `deeting/components/chat/console/controls-container.tsx`
- Modify: `deeting/components/common/hud/hud-container.tsx`
- Modify: `deeting/hooks/chat/use-chat-agent.ts`
- Modify: `deeting/hooks/use-chat-service.ts`
- Possibly modify: `deeting/store/chat-store.ts`
- Test: `deeting/components/chat/console/__tests__/controls-container.test.tsx`

**Step 1: Stop creating desktop conversations with assistant identity**

In desktop mode, stop passing `assistant_id` from the chat console when creating a conversation.

**Step 2: Remove desktop active assistant as runtime chat state**

Refactor desktop-only paths so HUD and chat state no longer depend on a selected assistant as the active runtime identity. Preserve any cloud-only behavior if needed.

**Step 3: Keep UI affordances only if they are asset-market related**

If some assistant list or card still exists for market/asset management, keep it out of chat runtime state. Do not let it set chat persona.

**Step 4: Update or add focused tests**

Add assertions that desktop chat does not send `assistant_id` in the conversation creation path.

**Step 5: Run the focused frontend test**

Run:

```bash
cd /data/Deeting/deeting && npm test -- --runTestsByPath components/chat/console/__tests__/controls-container.test.tsx
```

Expected: desktop conversation creation tests pass without assistant selection.

---

### Task 3: Switch local orchestrator from assistant prompt injection to persona injection

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/local_orchestrator.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/store/mod.rs` only if a helper is needed for config access
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs` or a new targeted Rust test module

**Step 1: Replace assistant prompt injection semantics**

Change the local `AssistantPromptInjectionStep` so it no longer reads `ctx.assistant_id` and local assistant `system_prompt` as the chat identity source. Instead, fetch the persisted desktop persona prompt from desktop config and inject it if present.

**Step 2: Rename internals for clarity**

Where reasonable, rename local step comments and status metadata from `assistant.selected` semantics to persona-oriented semantics, for example `persona.loaded`.

**Step 3: Preserve platform/base prompt ordering**

Keep the final system prompt order as:
1. platform / router base prompt
2. fixed persona prompt
3. capability hints
4. skill recipe hints

**Step 4: Add a focused Rust test**

Test that:
- with persona config present, the prompt is injected;
- without persona config, the step is a no-op;
- assistant id is no longer required for persona injection.

**Step 5: Run the focused Rust test**

Run:

```bash
cd /data/Deeting/deeting/src-tauri && cargo test persona_prompt -- --nocapture
```

Expected: new persona-focused tests pass.

---

### Task 4: Rewrite expert activation from assistant replace to capability attach

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/activation.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/code_mode_orchestration.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/consult.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Redefine activation payload**

Replace runtime semantics from:

```json
{ "activation_mode": "replace", "system_prompt": "...", "assistant_transition": ... }
```

to a capability-oriented payload, for example:

```json
{
  "activation_mode": "attach_capability",
  "capability_name": "...",
  "skill_tools": [...],
  "capability_hint": "...",
  "reason": "..."
}
```

**Step 2: Stop treating activation as identity replacement**

Keep `skill_tools` resolution, but stop returning assistant `system_prompt` as the next runtime identity prompt.

**Step 3: Update consult wording**

Change user-facing result strings from “activate assistant explicitly” to capability-oriented wording such as “attach expert capability explicitly if needed”.

**Step 4: Add focused Rust tests**

Add or update tests verifying:
- activation payload no longer includes replace-style identity semantics;
- consult wording is capability-oriented;
- attach still resolves `skill_refs` to tools.

**Step 5: Run the focused Rust test**

Run:

```bash
cd /data/Deeting/deeting/src-tauri && cargo test consult_expert_network -- --nocapture
```

Expected: consult and activation tests pass with capability wording.

---

### Task 5: Split skill-doc retrieval into an explicit JIT layer

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/local_orchestrator.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/capability_discovery.rs`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/capability_registry.rs` only if new recipe metadata is needed
- Test: `deeting/src-tauri/src/modules/mcp/commands_parts/tests.rs`

**Step 1: Separate capability hint from recipe hint**

Ensure capability match only contributes a short capability summary, while recipe retrieval contributes short docs-first usage guidance.

**Step 2: Avoid duplicate prompt injection**

Deduplicate repeated assistant / skill descriptions so the runtime prompt does not restate the same capability twice.

**Step 3: Keep `search_sdk` recipe semantics intact**

Do not convert recipes into direct tools. Preserve the existing `capabilities` / `recipes` / `orchestration_primitives` split.

**Step 4: Add focused Rust tests**

Test that:
- capabilities and recipes are both present when appropriate;
- recipe injection is still docs-first;
- capability attach does not implicitly inject a new personality prompt.

**Step 5: Run the focused Rust test**

Run:

```bash
cd /data/Deeting/deeting/src-tauri && cargo test capability_discovery -- --nocapture
```

Expected: capability and recipe discovery tests pass.

---

### Task 6: Update notifications, docs, and cleanup naming

**Files:**
- Modify: `docs/plans/2026-03-11-desktop-runtime-deassistantization-design.md`
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/code_mode_orchestration.rs`
- Modify: any frontend component that renders current expert-network notifications
- Test: targeted Rust and Jest suites from earlier tasks

**Step 1: Reword desktop expert notifications**

Reuse the existing desktop expert-network notification style, but change the copy from assistant-switch semantics to capability-enabled semantics.

**Step 2: Clean runtime names**

Rename the most visible runtime wording from `assistant` to `persona` or `capability` where it affects behavior comprehension. Asset-layer assistant names can remain unchanged.

**Step 3: Re-run focused validation**

Run:

```bash
cd /data/Deeting/deeting && npm test -- --runTestsByPath components/chat/console/__tests__/controls-container.test.tsx
cd /data/Deeting/deeting/src-tauri && cargo test consult_expert_network capability_discovery persona_prompt -- --nocapture
```

Expected: focused desktop frontend and Tauri tests pass.

**Step 4: Optional full sanity pass**

Run:

```bash
cd /data/Deeting/deeting && npm test
cd /data/Deeting/deeting/src-tauri && cargo test
```

Expected: broader suites pass or expose unrelated failures to triage separately.
