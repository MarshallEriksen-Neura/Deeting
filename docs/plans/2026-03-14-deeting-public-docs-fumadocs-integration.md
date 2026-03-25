# Deeting Public Docs Fumadocs Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public `/docs` documentation center to the existing Deeting Next.js app using Fumadocs and repository-backed MDX content.

**Architecture:** Integrate Fumadocs into the current `deeting/` App Router app rather than building a separate docs site. Keep the docs lane public and locale-aware under `app/[locale]/docs`, use MDX files in `deeting/content/docs`, and reuse the current app shell where practical while isolating docs-specific layout and navigation.

**Tech Stack:** Next.js 16 App Router, next-intl, Fumadocs UI/Core/MDX, Bun, TypeScript, MDX content files

---

### Task 1: Add framework dependencies and source configuration

**Files:**
- Modify: `deeting/package.json`
- Modify: `deeting/next.config.ts`
- Create: `deeting/source.config.ts`
- Create: `deeting/lib/source.ts`

**Step 1: Add a focused failing verification target**

Run: `bun run build`
Expected: FAIL because `/docs` route and Fumadocs source are not implemented yet, establishing the missing feature baseline.

**Step 2: Install the minimal dependency set**

Run: `cd /data/Deeting/deeting && bun add fumadocs-ui fumadocs-core fumadocs-mdx`
Expected: lockfile and package manifest updated without changing unrelated packages.

**Step 3: Wire MDX generation into Next config**

Implement the `fumadocs-mdx/next` wrapper around the existing `next-intl` config so both plugins coexist.

**Step 4: Define the docs content source**

Create `source.config.ts` pointing Fumadocs at `content/docs`, then create `lib/source.ts` with loader options that keep `/docs` as the base URL and align generated params with `[locale]`.

**Step 5: Verify the source layer compiles**

Run: `cd /data/Deeting/deeting && bunx tsc --noEmit`
Expected: TypeScript can resolve the new source files or surfaces only unrelated pre-existing errors.

### Task 2: Add the public docs route and layout

**Files:**
- Create: `deeting/app/[locale]/docs/layout.tsx`
- Create: `deeting/app/[locale]/docs/[[...slug]]/page.tsx`
- Create: `deeting/app/[locale]/docs/page.tsx` or route to canonical slug if needed
- Create: any docs-local support components under `deeting/components/docs/`

**Step 1: Write the failing route verification**

Run: `cd /data/Deeting/deeting && bun run build`
Expected: FAIL on unresolved docs route/layout imports before implementation.

**Step 2: Add docs layout**

Create a docs-specific layout using Fumadocs docs layout primitives, current locale from params, and localized page trees from the source loader.

**Step 3: Add the catch-all docs page**

Render MDX content, metadata, breadcrumbs, table of contents, and footer navigation from the source loader.

**Step 4: Keep locale/static param behavior explicit**

Use `source.generateParams('slug', 'locale')` or equivalent official API so the docs route works with the existing `[locale]` segment.

**Step 5: Verify route typing**

Run: `cd /data/Deeting/deeting && bunx tsc --noEmit`
Expected: new route files type-check or only expose unrelated existing errors.

### Task 3: Seed public docs content

**Files:**
- Create: `deeting/content/docs/...`

**Step 1: Add the docs tree**

Create concise MDX documents for:
- Getting started
- Desktop features
- Developer guide
- Integration
- Release notes
- Ideas/RFC (experimental)

**Step 2: Add navigation metadata**

Use the content-tree/meta shape required by Fumadocs so sidebar ordering and section grouping are deterministic.

**Step 3: Verify source discovery**

Run: `cd /data/Deeting/deeting && bun run build`
Expected: the docs loader can discover and render the seeded content.

### Task 4: Connect public entry points and polish

**Files:**
- Modify: relevant public navigation config if `/docs` should appear in top-level nav
- Modify: locale message files only if new visible labels are required
- Modify/Create: docs-specific small UI helpers only if the default layout is insufficient

**Step 1: Add the minimal public entry point**

Expose the docs section in existing public navigation only if it belongs in the current top-level shell.

**Step 2: Keep copy and layout scoped**

Avoid pulling docs into dashboard/admin lanes; this should stay public.

**Step 3: Verify navigation behavior**

Run: `cd /data/Deeting/deeting && bun run build`
Expected: docs route and public navigation build successfully.

### Task 5: Verify and hand off

**Files:**
- Inspect only

**Step 1: Run diagnostics on changed files**

Run: `lsp_diagnostics` or `bunx tsc --noEmit`
Expected: no new type errors in changed files.

**Step 2: Run focused lint/build verification**

Run: `cd /data/Deeting/deeting && bun run build`
Expected: docs integration builds successfully, or any unrelated pre-existing failures are clearly identified.

**Step 3: Summarize exact verification boundary**

Report which parts were verified locally:
- dependency install
- source generation
- route rendering/build
- content discovery

