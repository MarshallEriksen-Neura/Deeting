# Create Deeting Plugin Template Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize `create-deeting-plugin` and the default plugin template so newly scaffolded plugins match the current Deeting local skill runtime contract.

**Architecture:** Use `packages/templates/default-plugin` as the canonical template, update it to the current `tools:` manifest plus stdin-driven backend protocol, and make the CLI consistently scaffold from that source. Add lightweight checks so future drift is caught early.

**Tech Stack:** TypeScript CLI, Python template backend, YAML manifest files, static HTML UI template.

---

### Task 1: Add a failing contract check for the scaffold template

**Files:**
- Create: `packages/create-deeting-plugin/scripts/verify-template.mjs`

**Step 1: Write the failing check**

- Assert the template contains:
  - `runtime: ["local"]`
  - `execution.timeout_seconds`
  - `tools:` in `llm-tool.yaml`
  - stdin-based `main.py` protocol markers

**Step 2: Run check to verify it fails**

Run: `node packages/create-deeting-plugin/scripts/verify-template.mjs`

Expected: FAIL on the current outdated template shape.

**Step 3: Write minimal implementation**

- Update template files until the check passes.

**Step 4: Run check to verify it passes**

Run: `node packages/create-deeting-plugin/scripts/verify-template.mjs`

Expected: PASS

### Task 2: Update the canonical default plugin template

**Files:**
- Modify: `packages/templates/default-plugin/SKILL.md`
- Modify: `packages/templates/default-plugin/deeting.json`
- Modify: `packages/templates/default-plugin/llm-tool.yaml`
- Modify: `packages/templates/default-plugin/main.py`

**Step 1: Update manifest and docs**

- Make the template describe the current local runtime contract rather than the old wrapper flow.

**Step 2: Update backend entrypoint**

- Replace the old `invoke(...)` pattern with stdin-driven request handling.

**Step 3: Keep the example behavior minimal**

- Preserve a simple “hello” example, but ensure it is valid under the current runtime.

### Task 3: Fix create-deeting-plugin template resolution

**Files:**
- Modify: `packages/create-deeting-plugin/src/index.ts`
- Modify: `packages/create-deeting-plugin/package.json`

**Step 1: Make the CLI always target `templates/default-plugin`**

- Keep npm-packed and monorepo-local lookup behavior aligned.

**Step 2: Refresh packaged template copy**

- Ensure the package bundles the canonical template directory instead of stale flat files.

### Task 4: Verification

**Files:**
- Test: `packages/create-deeting-plugin/scripts/verify-template.mjs`

**Step 1: Run template verification**

Run: `node packages/create-deeting-plugin/scripts/verify-template.mjs`

Expected: PASS

**Step 2: Run Python syntax validation**

Run: `python3 -m py_compile packages/templates/default-plugin/main.py`

Expected: PASS
