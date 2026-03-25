# Desktop Account Binding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a desktop-only account binding module on the profile page so the current account can bind Google, GitHub, and email-code login without creating a new account.

**Architecture:** Reuse the existing desktop OAuth start/callback/exchange pattern, but split login and bind intents so bind flows attach identities to the current authenticated user instead of issuing a new login session. Keep `user_account` as the account record, keep `identity` as the source of truth for Google/GitHub/email-code login identities, and reject attempts to bind an identity that already belongs to another account.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js 16, React 19, SWR, Jest, pytest.

---

### Task 1: Add failing backend tests for binding contracts

**Files:**
- Modify: `backend/tests/api/test_oauth_google_github_desktop.py`
- Create: `backend/tests/api/test_account_bindings.py`

**Step 1: Write the failing tests**

- Add coverage for `GET /api/v1/users/me/bindings`.
- Add coverage for desktop OAuth bind start/callback/confirm for Google/GitHub.
- Add coverage for email-code bind send/confirm and conflict rejection.

**Step 2: Run test to verify it fails**

Run: `cd backend && DEBUG=false DATABASE_URL=sqlite+aiosqlite:///:memory: uv run pytest tests/api/test_account_bindings.py tests/api/test_oauth_google_github_desktop.py -q`

**Step 3: Implement the minimal backend to make the tests pass**

- Add schemas/routes/service methods for listing and binding identities.
- Reuse current OAuth provider profile fetch logic.

**Step 4: Run test to verify it passes**

Run the same pytest command and confirm green.

### Task 2: Add desktop profile client tests for binding flow wiring

**Files:**
- Modify: `deeting/components/auth/__tests__/desktop-oauth-listener.test.tsx`
- Create: `deeting/lib/api/__tests__/account-bindings.test.ts`

**Step 1: Write the failing tests**

- Cover parsing/dispatch for desktop deep links carrying bind intent.
- Cover account-binding client API contracts.

**Step 2: Run test to verify it fails**

Run: `cd deeting && npm test -- --runInBand components/auth/__tests__/desktop-oauth-listener.test.tsx lib/api/__tests__/account-bindings.test.ts`

**Step 3: Write minimal implementation**

- Extend deep-link parsing and listener dispatch.
- Add frontend API helpers for listing bindings and confirming email/OAuth binds.

**Step 4: Run test to verify it passes**

Run the same Jest command and confirm green.

### Task 3: Ship the minimal profile UI

**Files:**
- Modify: `deeting/app/[locale]/profile/page.tsx`
- Modify: `deeting/app/[locale]/profile/components/user-security.tsx`
- Create: `deeting/app/[locale]/profile/components/user-account-bindings.tsx`
- Modify: `deeting/messages/zh-CN/profile.json`
- Modify: `deeting/messages/en/profile.json`

**Step 1: Build the bindings card**

- Show Google, GitHub, and Email rows.
- Display current binding state from `/api/v1/users/me/bindings`.
- Offer bind actions and conflict/error feedback.

**Step 2: Hook it to current auth/profile state**

- Reuse existing desktop OAuth listener and auth session plumbing.
- Refresh profile/binding state after successful binds.

**Step 3: Verify the UI code**

Run: `cd deeting && npm test -- --runInBand components/auth/__tests__/desktop-oauth-listener.test.tsx lib/api/__tests__/account-bindings.test.ts`

### Task 4: Final verification

**Files:**
- Review modified backend and frontend files

**Step 1: Run focused diagnostics**

- Backend: file-scoped compile/test checks
- Frontend: file-scoped tests and TypeScript diagnostics where available

**Step 2: Run targeted regression suite**

Run:
- `cd backend && DEBUG=false DATABASE_URL=sqlite+aiosqlite:///:memory: uv run pytest tests/api/test_account_bindings.py tests/api/test_oauth_google_github_desktop.py -q`
- `cd deeting && npm test -- --runInBand components/auth/__tests__/desktop-oauth-listener.test.tsx lib/api/__tests__/account-bindings.test.ts`

**Step 3: Summarize verified constraints**

- Google uses OpenID `sub` as stable external identity.
- GitHub uses `id` as stable external identity and may require `/user/emails` for verified email resolution.
- Binding rejects identities already attached to another account.
