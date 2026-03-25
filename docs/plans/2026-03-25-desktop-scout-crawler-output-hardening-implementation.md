# Desktop Scout Crawler Output Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the desktop-local `web.fetch -> official.skills.crawler -> Scout` pipeline so high-frequency document fetching no longer fails on zero-width characters or machine-local code pages, and so the Scout/crawler contract preserves `title` and normalized markdown consistently.

**Architecture:** Fix the chain in three layers. First, make Scout return a stable normalized output contract with top-level `title` and normalization metadata. Second, upgrade `official.skills.crawler` from a bare print-based script into a stable UTF-8 JSON emitter plus Scout contract adapter. Third, enforce UTF-8 Python I/O defaults in desktop local skill runtime so every Python skill gets the same host-level guarantee instead of inheriting the machine locale.

**Tech Stack:** FastAPI Scout service, Python 3 local official skills, Tauri Rust desktop runtime, unit tests in Python and Rust, existing `web.fetch` desktop capability, existing `official.skills.crawler` tool binding path.

---

### Task 1: Add Scout-side text normalization utilities and contract fields

**Files:**
- Create: `scout/app/services/text_normalization.py`
- Modify: `scout/app/services/crawler.py`
- Modify: `scout/app/api/endpoints.py`
- Test: `scout/tests/test_text_normalization.py`
- Test: `scout/tests/test_api_endpoints.py`

**Step 1: Write the failing test**

- Add unit tests for a new normalization helper that:
  - removes `U+200B`, `U+200C`, `U+200D`, `U+FEFF`
  - normalizes `\r\n` and `\r` to `\n`
  - preserves ordinary Unicode text
- Add API-level assertions that `/v1/scout/inspect` returns:
  - top-level `title`
  - normalized `markdown`
  - `metadata.normalization`

**Step 2: Run test to verify it fails**

Run: `cd /data/Deeting/scout && PYTHONPATH=. pytest -q tests/test_text_normalization.py tests/test_api_endpoints.py -c /dev/null`

Expected: FAIL because the helper does not exist and the API contract does not yet expose the new fields.

**Step 3: Write minimal implementation**

- Create `scout/app/services/text_normalization.py` with a helper such as:
```python
ZERO_WIDTH_TRANSLATION = {
    ord("\u200b"): None,
    ord("\u200c"): None,
    ord("\u200d"): None,
    ord("\ufeff"): None,
}

def normalize_crawled_markdown(markdown: str | None) -> tuple[str, dict]:
    text = str(markdown or "")
    removed_bom = text.startswith("\ufeff")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    before = len(normalized)
    normalized = normalized.translate(ZERO_WIDTH_TRANSLATION)
    removed = before - len(normalized)
    return normalized, {
        "removed_zero_width_chars": removed,
        "removed_bom": removed_bom,
        "normalized_newlines": True,
    }
```
- In `scout/app/services/crawler.py`, normalize `result.markdown` before returning it.
- Preserve the original extracted title and return it as top-level `title`.
- In `scout/app/api/endpoints.py`, extend `ScoutResponse` with `title: str | None = None` and include the normalization metadata in the returned `metadata`.

**Step 4: Run test to verify it passes**

Run: `cd /data/Deeting/scout && PYTHONPATH=. pytest -q tests/test_text_normalization.py tests/test_api_endpoints.py -c /dev/null`

Expected: PASS

### Task 2: Harden the crawler skill output adapter and Scout contract fallback

**Files:**
- Modify: `packages/official-skills/crawler/main.py`
- Test: `packages/official-skills/crawler/test_main.py`

**Step 1: Write the failing test**

- Add tests that simulate Scout responses containing:
  - top-level `title`
  - only `metadata.title`
  - markdown containing `U+200B`
- Add tests for a new emitter helper that serializes a result to JSON text without losing Unicode content.

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/crawler/test_main.py`

Expected: FAIL because the skill does not yet expose a dedicated emitter or title fallback logic.

**Step 3: Write minimal implementation**

- Add helpers in `packages/official-skills/crawler/main.py` such as:
```python
def configure_stdio_utf8() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")

def emit_json(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
```
- Call `configure_stdio_utf8()` at process startup.
- Read Scout title with:
```python
title = data.get("title") or data.get("metadata", {}).get("title")
```
- Preserve current output shape:
```python
return {
    "status": "success",
    "title": title,
    "markdown": markdown,
    "content": markdown,
    "metadata": data.get("metadata"),
    "url": url,
}
```
- Replace raw `print(json.dumps(...))` with `emit_json(...)`.
- Add structured serialization fallback in the top-level exception path so encoding/serialization failures return a proper error envelope instead of crashing silently.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/crawler/test_main.py`

Expected: PASS

### Task 3: Enforce UTF-8 Python I/O defaults in desktop skill runtime

**Files:**
- Modify: `deeting/src-tauri/src/modules/skill_runtime/mod.rs`
- Test: `deeting/src-tauri/src/modules/skill_runtime/mod.rs`

**Step 1: Write the failing test**

- Extend runtime env tests to assert Python local skills receive:
  - `PYTHONIOENCODING=utf-8`
  - `PYTHONUTF8=1`
- Keep the existing Scout URL injection assertions intact.

**Step 2: Run test to verify it fails**

Run: `cd /data/Deeting/deeting && cargo test resolve_skill_binding_env_applies_scout_override_and_config_json --lib`

Expected: FAIL because the UTF-8 env vars are not yet injected.

**Step 3: Write minimal implementation**

- In `resolve_skill_binding_env(...)`, when `binding.runtime == "python"`, add:
```rust
env.insert("PYTHONIOENCODING".to_string(), "utf-8".to_string());
env.insert("PYTHONUTF8".to_string(), "1".to_string());
```
- Do not restrict this to `official.skills.crawler`; make it the default host behavior for Python local skills.

**Step 4: Run test to verify it passes**

Run: `cd /data/Deeting/deeting && cargo test resolve_skill_binding_env_applies_scout_override_and_config_json --lib`

Expected: PASS

### Task 4: Improve runtime-side error classification for Python skill failures

**Files:**
- Modify: `deeting/src-tauri/src/modules/skill_runtime/mod.rs`
- Modify: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`

**Step 1: Write the failing test**

- Add a test that simulates a skill failure message containing `UnicodeEncodeError` / `gbk codec can't encode character`.
- Assert the summarized user-visible error identifies the failure as an output encoding or serialization failure rather than a generic crawl failure.

**Step 2: Run test to verify it fails**

Run: `cd /data/Deeting/deeting && cargo test local_orchestrator --lib`

Expected: FAIL because the current error handling treats the output as an opaque string.

**Step 3: Write minimal implementation**

- Add a small classifier helper in runtime or orchestrator code:
```rust
fn classify_skill_failure(detail: &str) -> Option<&'static str> {
    let lower = detail.to_lowercase();
    if lower.contains("unicodeencodeerror") || lower.contains("codec can't encode character") {
        return Some("skill_output_encoding_error");
    }
    None
}
```
- Include the classification in the error block metadata or summary path used by the desktop chat UI.
- Keep the existing generic path as fallback for unrelated failures.

**Step 4: Run test to verify it passes**

Run: `cd /data/Deeting/deeting && cargo test local_orchestrator --lib`

Expected: PASS

### Task 5: Add an end-to-end contract test across Scout response and crawler consumption

**Files:**
- Test: `packages/official-skills/crawler/test_main.py`
- Optional modify: `scout/tests/test_api_endpoints.py`

**Step 1: Write the failing test**

- Add an integration-style Python test that mocks the Scout HTTP response as:
```python
{
    "status": "success",
    "title": "Volcengine Docs",
    "markdown": "abc\u200bdef",
    "metadata": {
        "normalization": {
            "removed_zero_width_chars": 1,
            "removed_bom": False,
            "normalized_newlines": True,
        }
    }
}
```
- Assert the crawler returns:
  - `status == "success"`
  - `title == "Volcengine Docs"`
  - `content == "abcdef"` or the normalized equivalent expected from the Scout fixture

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest packages/official-skills/crawler/test_main.py`

Expected: FAIL because the contract is not yet expressed in tests end-to-end.

**Step 3: Write minimal implementation**

- Reuse the Scout-normalized payload shape in crawler tests.
- Ensure the crawler does not reintroduce removed zero-width characters or drop top-level fields.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest packages/official-skills/crawler/test_main.py`

Expected: PASS

### Task 6: Verification

**Files:**
- Test: `scout/tests/test_text_normalization.py`
- Test: `scout/tests/test_api_endpoints.py`
- Test: `packages/official-skills/crawler/test_main.py`
- Test: `deeting/src-tauri/src/modules/skill_runtime/mod.rs`
- Test: `deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator.rs`

**Step 1: Run Scout verification**

Run: `cd /data/Deeting/scout && PYTHONPATH=. pytest -q tests/test_text_normalization.py tests/test_api_endpoints.py -c /dev/null`

Expected: PASS

**Step 2: Run crawler skill verification**

Run: `python3 -m unittest packages/official-skills/crawler/test_main.py`

Expected: PASS

**Step 3: Run desktop runtime verification**

Run: `cd /data/Deeting/deeting && cargo test resolve_skill_binding_env_applies_scout_override_and_config_json --lib && cargo test local_orchestrator --lib`

Expected: PASS

**Step 4: Inspect the final diff**

Run: `git diff --stat`

Expected: changes only in Scout service/API tests, crawler official skill, desktop skill runtime, and the plan docs for this feature.
