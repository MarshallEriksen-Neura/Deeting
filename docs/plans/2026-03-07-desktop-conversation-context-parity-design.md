# Desktop Conversation Context Parity Design
Updated: 2026-03-07

## Goal
- Make desktop local chat follow cloud-style conversation context semantics without Redis.
- Keep SQLite as the desktop persistence layer.
- Align runtime prompt assembly, summary generation, and summary scheduling around one shared active-window definition.

## Production Approach
- Keep full conversation history in `conversation_message`.
- Add a dedicated desktop runtime window loader that returns:
  - latest assistant binding
  - latest active-window messages
  - latest summary payload
  - runtime meta
- Use this runtime window as the prompt source for both the desktop local orchestrator and the local summary worker.

## Context Assembly
- Build runtime chat context in a cloud-like shape:
  - base desktop orchestrator system prompt
  - assistant/system guidance
  - summary as a separate `[SUMMARY]` system message
  - optional semantic memory / persona hint as separate system messages
  - active-window chat messages
- Avoid packing all context fragments into one giant synthetic prompt block.

## Summary Scheduling
- Keep summary scheduling attached to message append.
- Every append should:
  - update idle-summary task
  - run threshold-based flush check
- Summary workers summarize the same active window that runtime prompt loading uses.

## Verification
- Add focused Rust tests for:
  - runtime window loading returns latest bounded messages plus summary
  - summary worker persists `covered_from_turn` / `covered_to_turn` for the actual runtime window
