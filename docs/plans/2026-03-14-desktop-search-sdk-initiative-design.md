# Desktop Conditional Search SDK Initiative Design

**Date:** 2026-03-14
**Scope:** `desktop local`

## Problem

The desktop-local assistant already exposes `search_sdk` in Direct and Worker lanes, but the current base prompt is still soft enough that the model can act as if the visible tool list is the whole universe. That creates a lazy failure mode: if the right capability is not already named in the prompt context, the model may answer from assumption or say it cannot verify something instead of discovering the capability first.

## Goal

Make the desktop-local prompt explicitly distinguish between:

- requests that can be answered directly without capability discovery; and
- requests that depend on unknown runtime capabilities, installed skills, plugins, MCP tools, or system actions, where `search_sdk` should be the first discovery step.

The change must not turn `search_sdk` into a mandatory preflight for every request.

## Recommended Approach

Use a two-layer prompt adjustment:

1. Strengthen the base router prompt in `src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs`.
2. Add route-level guidance in `src-tauri/src/modules/mcp/commands/runtime/route_selector.rs` for Direct and Worker lanes.

This keeps the behavior prompt-driven and low-risk. It avoids control-plane auto-discovery, preserves cheap direct answers, and makes the “unknown capability -> search first” rule visible both globally and inside the selected route.

## Rules To Encode

- If the blocker is uncertainty about what capabilities exist, whether a capability is installed, or which tool matches the request, do one discovery step before answering from assumption.
- When available, `search_sdk` is the default discovery tool for capability uncertainty.
- Do not call `search_sdk` for requests that can already be answered directly from the conversation, repo context, or existing prompt assets.
- Do not say a capability is unavailable just because it was not prelisted in the prompt.

## Verification

- Add string-level regression coverage for the new base prompt wording.
- Add route-prompt regression coverage so Worker guidance also mentions conditional `search_sdk` discovery.
