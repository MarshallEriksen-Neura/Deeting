# Public Docs Fumadocs Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public Deeting documentation center under the existing Next.js app using Fumadocs, seeded with public-facing content and wired to the current locale-aware routing.

**Architecture:** Keep docs as code inside the existing `deeting/` app. Use Fumadocs MDX for content loading and page generation, mount the docs experience under `app/[locale]/docs`, and keep `next-intl` as the app-level i18n source of truth. Reuse the app shell boundary only where it does not fight the docs layout.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, Bun, Fumadocs (`fumadocs-ui`, `fumadocs-core`, `fumadocs-mdx`), Jest

---

### Task 1: Add a failing test for the public docs route contract

**Files:**
- Create: `deeting/app/[locale]/docs/[[...slug]]/page.test.tsx`
- Modify: none

**Step 1: Write the failing test**

Write a focused test that imports the docs page module, mocks the docs source, and expects the page to render title/description for the root docs page.

**Step 2: Run test to verify it fails**

Run: `bun test` is not the repo test runner here; use `bun x jest deeting/app/[locale]/docs/[[...slug]]/page.test.tsx --runInBand`

Expected: FAIL because the docs route does not exist yet.

### Task 2: Install Fumadocs and wire MDX generation

**Files:**
- Modify: `deeting/package.json`
- Modify: `deeting/next.config.ts`
- Create: `deeting/source.config.ts`
- Create: `deeting/lib/source.ts`

**Step 1: Install dependencies**

Run: `bun add fumadocs-ui fumadocs-core fumadocs-mdx`

**Step 2: Update Next config**

Wrap the existing next-intl config with Fumadocs MDX support via `createMDX`.

**Step 3: Define docs content source**

Create the Fumadocs source config and source loader pointing at `content/docs`.

### Task 3: Build the docs route and layout

**Files:**
- Create: `deeting/app/[locale]/docs/layout.tsx`
- Create: `deeting/app/[locale]/docs/[[...slug]]/page.tsx`
- Create: `deeting/app/[locale]/docs/page.tsx`

**Step 1: Write minimal route implementation**

Use `DocsLayout`, `DocsPage`, and the generated source object to render the docs tree and pages inside the locale segment.

**Step 2: Keep i18n explicit**

Use the existing `[locale]` route param and `setRequestLocale(locale)` pattern so docs stay consistent with the rest of the app.

### Task 4: Seed public docs content

**Files:**
- Create: `deeting/content/docs/index.mdx`
- Create: `deeting/content/docs/getting-started/index.mdx`
- Create: `deeting/content/docs/desktop-features/index.mdx`
- Create: `deeting/content/docs/developer-guide/index.mdx`
- Create: `deeting/content/docs/integration/index.mdx`
- Create: `deeting/content/docs/release-notes/index.mdx`
- Create: `deeting/content/docs/ideas/index.mdx`

**Step 1: Add concise public-facing content**

Seed realistic Deeting content covering desktop app, chat, knowledge, plugins, MCP, release notes, and explicitly experimental RFC/ideas.

### Task 5: Verify route, diagnostics, and build health

**Files:**
- Verify modified files only

**Step 1: Re-run the docs test**

Run: `bun x jest app/[locale]/docs/[[...slug]]/page.test.tsx --runInBand`

Expected: PASS

**Step 2: Run targeted diagnostics**

Run LSP diagnostics on changed TS/TSX files.

**Step 3: Run a targeted production proof**

Run: `bun run build`

Expected: successful build or clearly documented pre-existing blocker outside the docs diff.
