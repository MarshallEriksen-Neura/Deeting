# Desktop Browser Login Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Converge desktop login so the desktop app only launches browser-based web login, while preserving profile account-binding OAuth.

**Architecture:** Add a backend browser-login session/grant flow for desktop start, web completion, and desktop exchange. Remove desktop-login Google/GitHub entrypoints from the frontend login UI, but keep bind-specific desktop OAuth callback handling intact.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js, Zustand, Jest, pytest

---

### Task 1: Lock the target behavior with failing tests

**Files:**
- Modify: `deeting_core/tests/api/test_auth.py`
- Modify: `deeting/lib/api/__tests__/auth-desktop-browser.test.ts`
- Modify: `deeting/components/auth/__tests__/desktop-oauth-listener.test.tsx`
- Modify: `deeting/components/auth/__tests__/login-form.test.tsx` or add a new focused login-form test file if none exists

**Step 1: Write failing backend tests**
- Add tests for `POST /api/v1/auth/desktop/browser/start`
- Add tests for authenticated web completion of the desktop browser session
- Add tests for desktop exchange / replay / unauthorized completion

**Step 2: Run focused backend tests and verify they fail for the expected missing routes / behavior**
- Run: `cd /data/Deeting/deeting_core && uv run pytest tests/api/test_auth.py -q`

**Step 3: Write failing frontend tests**
- Assert desktop browser API client covers the final request contract
- Assert desktop deep-link handling uses browser exchange instead of OAuth exchange
- Assert desktop login UI no longer renders Google/GitHub login buttons

**Step 4: Run focused frontend tests and verify they fail for the expected missing behavior**
- Run: `cd /data/Deeting/deeting && npm test -- --runTestsByPath lib/api/__tests__/auth-desktop-browser.test.ts components/auth/__tests__/desktop-oauth-listener.test.tsx`

### Task 2: Implement backend browser-login session closure

**Files:**
- Create: `deeting_core/app/models/desktop_browser_login.py`
- Modify: `deeting_core/app/models/__init__.py`
- Modify: `deeting_core/app/schemas/auth.py`
- Modify: `deeting_core/app/api/v1/auth_route.py`
- Create: `deeting_core/app/services/users/desktop_browser_login_service.py`
- Modify: `deeting_core/app/services/users/__init__.py`
- Create: `deeting_core/migrations/versions/20260319_01_desktop_browser_login_session.py`

**Step 1: Add DB models and schema DTOs**
- Session table with status, return scheme, auth-completion metadata, expiry, and optional completed user
- Grant table with one-time hashed grant and expiry

**Step 2: Add service methods**
- Start session
- Mark session completed from authenticated web login
- Exchange grant from desktop and issue `TokenPair`

**Step 3: Add FastAPI routes**
- `POST /api/v1/auth/desktop/browser/start`
- `POST /api/v1/auth/desktop/browser/complete`
- `POST /api/v1/auth/desktop/browser/exchange`

**Step 4: Re-run focused backend tests until green**
- Run: `cd /data/Deeting/deeting_core && uv run pytest tests/api/test_auth.py -q`

### Task 3: Converge the frontend to browser-only desktop login

**Files:**
- Modify: `deeting/hooks/use-auth.ts`
- Modify: `deeting/lib/api/auth-desktop-browser.ts`
- Modify: `deeting/components/auth/desktop-oauth-listener.tsx`
- Modify: `deeting/components/auth/login-form.tsx`
- Modify: `deeting/messages/en/auth.json`
- Modify: `deeting/messages/zh-CN/auth.json`

**Step 1: Add browser exchange client method**
- Finalize the request/response shape for the new backend exchange route

**Step 2: Update desktop deep-link listener**
- Branch `provider=browser` to browser exchange
- Keep `intent=bind` desktop OAuth behavior unchanged

**Step 3: Remove desktop-login OAuth entrypoints from the login form**
- Desktop app only shows the external browser login button
- Web login pages carrying `desktop_login_session` should complete the desktop flow after a normal web login

**Step 4: Re-run focused frontend tests until green**
- Run: `cd /data/Deeting/deeting && npm test -- --runTestsByPath lib/api/__tests__/auth-desktop-browser.test.ts components/auth/__tests__/desktop-oauth-listener.test.tsx`

### Task 4: Verify targeted behavior and correct stale memory

**Files:**
- Modify: `/root/.codex/memories/MEMORY.md`

**Step 1: Run targeted verification**
- Backend: `cd /data/Deeting/deeting_core && uv run pytest tests/api/test_auth.py tests/api/test_oauth_google_github_desktop.py -q`
- Frontend: `cd /data/Deeting/deeting && npm test -- --runTestsByPath lib/api/__tests__/auth-desktop-browser.test.ts components/auth/__tests__/desktop-oauth-listener.test.tsx`

**Step 2: Fix any targeted regressions**
- Preserve profile bind OAuth flow while confirming desktop login entry is browser-only

**Step 3: Update stale memory detail**
- Correct the stale backend path reference under the desktop OAuth task group in `MEMORY.md`

**Step 4: Summarize verified closure and residual risks**
- Call out any unverified areas, especially untranslated UI strings or unrelated auth surfaces
