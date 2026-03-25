# Deeting Public Docs Fumadocs Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public `/docs` documentation section to the existing Deeting Next.js app using Fumadocs, with initial public-facing content and locale-aware routing that coexists with `next-intl`.

**Architecture:** Keep the docs center inside the existing `deeting/` Next.js application rather than creating a separate site. Use Fumadocs for MDX content loading, docs layout, page tree generation, and page rendering, while preserving Deeting's existing `[locale]` App Router structure and `next-intl` middleware/layout model.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `next-intl`, Fumadocs (`fumadocs-ui`, `fumadocs-core`, `fumadocs-mdx`), Bun.

---

### Task 1: Add dependency and MDX infrastructure

**Files:**
- Modify: `deeting/package.json`
- Modify: `deeting/next.config.ts`
- Create: `deeting/source.config.ts`
- Create: `deeting/lib/source.ts`

**Step 1: Write the failing verification**

Run: `bun x tsc --noEmit`
Expected: It fails once new imports are referenced before packages/config are in place.

**Step 2: Install minimal dependencies**

Run: `bun add fumadocs-ui fumadocs-core fumadocs-mdx`
Expected: lockfile and `package.json` update cleanly.

**Step 3: Enable Fumadocs MDX generation**

Add `createMDX()` wrapping to `deeting/next.config.ts`, create `source.config.ts`, and add a minimal `lib/source.ts` that uses the generated Fumadocs source with locale-aware loading.

**Step 4: Verify infrastructure**

Run: `bun x tsc --noEmit`
Expected: MDX/source imports resolve, or failures narrow to missing route/layout usage.

### Task 2: Add public docs routing and layout

**Files:**
- Create: `deeting/app/[locale]/docs/layout.tsx`
- Create: `deeting/app/[locale]/docs/[[...slug]]/page.tsx`
- Modify: `deeting/i18n/routing.ts`
- Modify: `deeting/messages/en/common.json`
- Modify: `deeting/messages/zh-CN/common.json`

**Step 1: Write the failing verification**

Run: `bun x tsc --noEmit`
Expected: Missing route/layout/page symbols or unresolved docs layout options.

**Step 2: Add the public docs route**

Create a docs layout using Fumadocs `DocsLayout`, connect it to the locale page tree, and add the catch-all docs page that renders MDX content with metadata and static params. Update pathnames/messages only as needed to keep locale navigation coherent.

**Step 3: Verify route typing**

Run: `bun x tsc --noEmit`
Expected: docs route compiles without new type errors in modified files.

### Task 3: Seed initial public docs content

**Files:**
- Create: `deeting/content/docs/index.mdx`
- Create: `deeting/content/docs/getting-started/index.mdx`
- Create: `deeting/content/docs/desktop-features/index.mdx`
- Create: `deeting/content/docs/developer-guide/index.mdx`
- Create: `deeting/content/docs/integration/index.mdx`
- Create: `deeting/content/docs/release-notes/index.mdx`
- Create: `deeting/content/docs/ideas-rfc/index.mdx`

**Step 1: Write the failing verification**

Run: `bun x tsc --noEmit`
Expected: Route exists but has no source pages or index resolution is incomplete.

**Step 2: Add minimal user-facing content**

Create concise frontmatter-backed MDX pages for the top-level docs sections, keeping `Ideas / RFC` explicitly marked experimental.

**Step 3: Verify generated params/content resolution**

Run: `bun x tsc --noEmit`
Expected: No missing page/content loader issues.

### Task 4: Verify the integrated docs surface

**Files:**
- Test/Verify only

**Step 1: Run targeted diagnostics**

Run: file-level diagnostics on all modified TS/TSX files.
Expected: zero errors on changed files.

**Step 2: Run project-level validation**

Run: `bun x tsc --noEmit`
Expected: no new type failures from the docs integration, or pre-existing unrelated failures documented.

**Step 3: Run lint on modified frontend files if feasible**

Run: `bun x eslint app/[locale]/docs lib/source.ts next.config.ts i18n/routing.ts`
Expected: no new lint issues in changed code.

**Step 4: Summarize verification boundaries**

Report exactly what was verified, what remains unverified (for example, visual polish), and any follow-up items like adding search or edit-on-GitHub links.
