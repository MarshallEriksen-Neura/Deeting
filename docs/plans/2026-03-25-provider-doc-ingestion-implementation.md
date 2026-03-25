# Provider Documentation Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated `provider_doc_ingestion` official skill that fetches provider documentation, extracts evidence-first protocol fields into a structured report, drafts a provider preset candidate, and hands that candidate off to the existing provider verification lane without changing `provider_registry` into a crawler.

**Architecture:** Create a new local official skill package under `packages/official-skills/` that uses existing desktop host capabilities for document fetching and keeps all extraction logic in a schema-driven, evidence-first JSON contract. Keep `provider_registry` focused on schema alignment, verification, and publishing; the new skill stops at candidate generation plus readiness scoring.

**Tech Stack:** Python 3 official skill runtime, existing Deeting skill manifest format, desktop `web.fetch` host capability, optional Scout/crawler fallback, JSON schema-style extraction contracts, existing `provider_registry` tools for downstream verification.

---

### Task 1: Create the new official skill package skeleton

**Files:**
- Create: `packages/official-skills/provider_doc_ingestion/deeting.json`
- Create: `packages/official-skills/provider_doc_ingestion/SKILL.md`
- Create: `packages/official-skills/provider_doc_ingestion/llm-tool.yaml`
- Create: `packages/official-skills/provider_doc_ingestion/main.py`
- Create: `packages/official-skills/provider_doc_ingestion/requirements.txt`

**Step 1: Write the failing test**

- Add a new test file that imports the package entrypoint and asserts the new tool names are exposed and dispatch correctly.

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: FAIL because the package and entrypoint do not exist yet.

**Step 3: Write minimal implementation**

- Add the new official skill manifest with runtime `local`.
- Define these tools in `llm-tool.yaml`:
  - `collect_provider_doc_evidence`
  - `draft_provider_candidate`
  - `score_provider_candidate_readiness`
- Implement a minimal stdin JSON dispatcher in `main.py`.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

### Task 2: Add the extraction schema and evidence model

**Files:**
- Create: `packages/official-skills/provider_doc_ingestion/extraction_schema.json`
- Create: `packages/official-skills/provider_doc_ingestion/prompt_template.md`
- Modify: `packages/official-skills/provider_doc_ingestion/main.py`
- Test: `packages/official-skills/provider_doc_ingestion/test_main.py`

**Step 1: Write the failing test**

- Add tests that assert the extraction layer normalizes a report with:
  - `provider_identity`
  - `auth`
  - `capabilities`
  - `evidence`
  - `gaps`
- Add assertions that `explicit_or_inferred` and `confidence` are preserved.

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: FAIL because the schema-driven report builder does not exist yet.

**Step 3: Write minimal implementation**

- Add a JSON schema-like contract file for `ProviderExtractionReport`.
- Add a prompt template that instructs the model to extract fields instead of writing summaries.
- Implement helper functions in `main.py` that normalize raw extraction items into the report shape.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

### Task 3: Wire host-powered document acquisition without changing `provider_registry`

**Files:**
- Modify: `packages/official-skills/provider_doc_ingestion/main.py`
- Modify: `packages/official-skills/provider_doc_ingestion/SKILL.md`
- Optional modify: `packages/official-skills/provider_doc_ingestion/requirements.txt`
- Test: `packages/official-skills/provider_doc_ingestion/test_main.py`

**Step 1: Write the failing test**

- Add tests for `collect_provider_doc_evidence` that mock `deeting.call_tool(...)` and assert:
  - `web.fetch` is called for each supplied URL
  - raw page content is preserved alongside the source URL
  - fetch failures are surfaced in a structured `fetch_errors` field

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: FAIL because host-powered acquisition is not implemented yet.

**Step 3: Write minimal implementation**

- Use `deeting.call_tool("web.fetch", ...)` when the SDK is available.
- Keep the acquisition output separate from extracted protocol fields.
- Do not call `provider.template.verify` or publish tools in this step.
- Document in `SKILL.md` that this package is an ingestion lane, not a publishing lane.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

### Task 4: Draft provider candidates from structured evidence

**Files:**
- Modify: `packages/official-skills/provider_doc_ingestion/main.py`
- Create: `packages/official-skills/provider_doc_ingestion/examples/volcengine_las_report.json`
- Create: `packages/official-skills/provider_doc_ingestion/examples/volcengine_las_candidate.json`
- Test: `packages/official-skills/provider_doc_ingestion/test_main.py`

**Step 1: Write the failing test**

- Add tests that feed a Volcengine-like extraction report and assert:
  - candidate `base_url`
  - candidate `auth_type`
  - candidate `protocol_profiles.chat.transport.path`
  - `verification_ready` remains false when response mapping gaps remain

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: FAIL because the candidate synthesis logic does not exist yet.

**Step 3: Write minimal implementation**

- Implement `draft_provider_candidate`.
- Normalize full endpoint examples into `base_url + transport.path` when evidence is sufficient.
- Preserve `verification_gaps` instead of overcommitting the final profile.
- Add the Volcengine LAS example files as fixtures and documentation anchors.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

### Task 5: Score candidate readiness and document the handoff to `provider_registry`

**Files:**
- Modify: `packages/official-skills/provider_doc_ingestion/main.py`
- Modify: `packages/official-skills/provider_doc_ingestion/SKILL.md`
- Modify: `packages/official-skills/provider_registry/SKILL.md`
- Test: `packages/official-skills/provider_doc_ingestion/test_main.py`

**Step 1: Write the failing test**

- Add tests that assert `score_provider_candidate_readiness` returns:
  - `evidence_ready`
  - `candidate_ready`
  - `verify_ready`
  - a list of missing fields or unresolved gaps

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: FAIL because readiness scoring does not exist yet.

**Step 3: Write minimal implementation**

- Add readiness scoring helpers.
- Update the new skill doc so it explicitly instructs the operator or AI to:
  1. collect evidence
  2. draft candidate
  3. pass candidate into `provider_registry.get_unified_schema`
  4. run `provider_registry.verify_provider_template`
  5. publish only after verification
- Update `provider_registry/SKILL.md` with a short note that crawling is upstream of this skill.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

### Task 6: Ensure the new official skill is visible to the seeded skill registry

**Files:**
- Modify: `deeting/content/docs/en/desktop-skills-storage.mdx`
- Test: `deeting_core/tests/tasks/test_skill_registry_seed_builtins.py`

**Step 1: Write the failing test**

- Add or update seed-builtins expectations so the official skill list can include `provider_doc_ingestion`.

**Step 2: Run test to verify it fails**

Run: `cd /data/Deeting/deeting_core && pytest tests/tasks/test_skill_registry_seed_builtins.py -q`

Expected: FAIL if the seed expectations are fixed to the previous builtin list.

**Step 3: Write minimal implementation**

- Update the desktop skills storage doc to list the new official skill.
- Adjust tests if they assert an exact builtin set.

**Step 4: Run test to verify it passes**

Run: `cd /data/Deeting/deeting_core && pytest tests/tasks/test_skill_registry_seed_builtins.py -q`

Expected: PASS, subject to local test environment health.

### Task 7: Verification

**Files:**
- Test: `packages/official-skills/provider_doc_ingestion/test_main.py`
- Test: `deeting_core/tests/tasks/test_skill_registry_seed_builtins.py`
- Modify if needed: `packages/official-skills/provider_doc_ingestion/examples/volcengine_las_report.json`
- Modify if needed: `packages/official-skills/provider_doc_ingestion/examples/volcengine_las_candidate.json`

**Step 1: Run the new skill unit tests**

Run: `python3 -m unittest packages/official-skills/provider_doc_ingestion/test_main.py`

Expected: PASS

**Step 2: Run the backend builtin seeding test**

Run: `cd /data/Deeting/deeting_core && pytest tests/tasks/test_skill_registry_seed_builtins.py -q`

Expected: PASS, or explicit evidence of unrelated local environment failures.

**Step 3: Manually inspect the example fixture output**

Run: `sed -n '1,220p' packages/official-skills/provider_doc_ingestion/examples/volcengine_las_candidate.json`

Expected: the candidate is evidence-backed, verify-ready only when gaps are actually closed, and does not claim publish readiness prematurely.

**Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: new `provider_doc_ingestion` package files, docs updates, and tightly scoped test changes only.
