# Desktop Conditional Search SDK Initiative Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Teach the desktop-local assistant to proactively call `search_sdk` when the real blocker is unknown runtime capability discovery, without making `search_sdk` a mandatory preflight for ordinary requests.

**Architecture:** Keep the change prompt-driven. Update the shared desktop-local base prompt to encode conditional capability-discovery rules, then reinforce the same behavior in route-specific guidance for Direct and Worker lanes. Cover both changes with focused string regression tests.

**Tech Stack:** Rust, Tauri desktop runtime, cargo test

---

### Task 1: Tighten the base desktop-local router prompt

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs`

**Step 1: Write the failing test**

Add assertions to the existing prompt regression test for:

- unknown capability requests should trigger `search_sdk`
- direct-answer requests should not trigger unnecessary `search_sdk`

**Step 2: Run test to verify it fails**

Run: `cargo test render_local_router_base_prompt_includes_tool_initiative_rules`
Expected: FAIL until the new wording exists

**Step 3: Write minimal implementation**

Extend `LOCAL_ROUTER_BASE_PROMPT_TEMPLATE` with explicit conditional-discovery language that:

- treats `search_sdk` as the default discovery step for unknown capability questions when available
- forbids turning `search_sdk` into a default preflight for requests that can already be answered directly

**Step 4: Run test to verify it passes**

Run: `cargo test render_local_router_base_prompt_includes_tool_initiative_rules`
Expected: PASS

### Task 2: Reinforce the rule inside route-specific guidance

**Files:**
- Modify: `deeting/src-tauri/src/modules/mcp/commands/runtime/route_selector.rs`
- Test: `deeting/src-tauri/src/modules/mcp/commands/runtime/route_selector.rs`

**Step 1: Write the failing test**

Add a Worker-route regression asserting the route prompt mentions conditional `search_sdk` discovery when capability uncertainty blocks the answer.

**Step 2: Run test to verify it fails**

Run: `cargo test render_local_route_prompt_mentions_worker_search_sdk_discovery_rule`
Expected: FAIL until the route guidance is updated

**Step 3: Write minimal implementation**

Update the Direct and Worker route guidance strings so they:

- prefer direct reasoning when no discovery is needed
- instruct the model to use `search_sdk` once when tool/capability uncertainty is the blocker

**Step 4: Run test to verify it passes**

Run: `cargo test render_local_route_prompt_mentions_selected_route render_local_route_prompt_mentions_worker_search_sdk_discovery_rule`
Expected: PASS

### Task 3: Verify the combined behavior

**Files:**
- Verify: `deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs`
- Verify: `deeting/src-tauri/src/modules/mcp/commands/runtime/route_selector.rs`

**Step 1: Run targeted tests**

Run: `cargo test render_local_router_base_prompt_includes_tool_initiative_rules render_local_route_prompt_mentions_selected_route render_local_route_prompt_mentions_worker_search_sdk_discovery_rule`
Expected: PASS

**Step 2: Review the diff**

Run: `git diff -- deeting/src-tauri/src/modules/mcp/commands/runtime/prompt_plan.rs deeting/src-tauri/src/modules/mcp/commands/runtime/route_selector.rs docs/plans/2026-03-14-desktop-search-sdk-initiative-design.md docs/plans/2026-03-14-desktop-search-sdk-initiative-implementation.md`
Expected: only prompt wording, route guidance, tests, and the two plan docs changed
