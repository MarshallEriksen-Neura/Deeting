# Root README Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the root README into a mixed product-and-open-source landing page with branded local badges, Star History, a Bandit feedback illustration, and concrete capability cards for first-time GitHub visitors.

**Architecture:** Keep the root `README.md` as the primary Chinese-first landing page, replace generic external badge styling with repo-local SVG badges, keep the external Star History embed for open-source proof, add repo-local SVG icons and a feedback-loop diagram under `docs/images/readme/`, and keep developer-facing instructions collapsed so the top half stays product-first.

**Tech Stack:** GitHub Flavored Markdown, inline HTML in Markdown, Star History embed, repo-local SVG assets

---

### Task 1: Replace the root README structure

**Files:**
- Modify: `README.md`
- Reference: `docs/macos-installation.md`
- Reference: `installer/README.md`

**Step 1: Draft the new section order**

Write these sections in order:
- centered title and CTA
- hero image
- quick value proposition
- key features
- visual explanation blocks
- quick start
- roadmap
- developer details

**Step 2: Verify the top half is user-first**

Run:

```bash
sed -n '1,120p' README.md
```

Expected:
- no developer setup in the first screen
- download link appears near the top
- product description appears before local build commands

**Step 3: Add installation guidance**

Include:
- Windows bootstrapper recommendation
- macOS unsigned app note with doc link
- Linux package names
- first-launch configuration checklist

**Step 4: Re-read for tone**

Run:

```bash
rg -n "bun run|npm run|clone|Next.js" README.md
```

Expected:
- developer commands only appear in the lower "For Developers" block

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: turn root readme into product landing page"
```

### Task 2: Add branded badges and Star History

**Files:**
- Modify: `README.md`
- Create: `docs/images/readme/badge-release.svg`
- Create: `docs/images/readme/badge-open-source.svg`
- Create: `docs/images/readme/badge-platform.svg`
- Create: `docs/images/readme/badge-tauri.svg`
- Create: `docs/images/readme/badge-bandit.svg`

**Step 1: Add badge row**

Add a centered badge row near the top for:
- current release
- open-source positioning
- platform support
- Tauri
- Bandit-assisted routing

**Step 2: Add Star History**

Embed the standard Star History chart below the intro section.

**Step 3: Verify badge and chart references**

Run:

```bash
rg -n "badge-release|badge-open-source|badge-platform|badge-tauri|badge-bandit|star-history.com|api.star-history.com" README.md
```

Expected:
- local badge references appear in the header area
- Star History embed and link are both present

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add readme badges and star history"
```

### Task 3: Create the hero SVG

**Files:**
- Create: `docs/images/readme/deeting-hero.svg`
- Reference: `deeting/app/icon0.svg`

**Step 1: Build a hero composition**

Create an SVG that includes:
- dark gradient background
- Deeting-inspired ring motif
- title text
- short product descriptor chips

**Step 2: Verify the asset shape**

Run:

```bash
sed -n '1,220p' docs/images/readme/deeting-hero.svg
```

Expected:
- valid `<svg>` root
- no external asset dependency
- viewBox and fixed width/height present

**Step 3: Verify README link target**

Run:

```bash
rg -n "deeting-hero.svg" README.md
```

Expected:
- exactly one hero reference in the landing section

**Step 4: Commit**

```bash
git add docs/images/readme/deeting-hero.svg README.md
git commit -m "docs: add deeting hero readme graphic"
```

### Task 4: Create the architecture and workflow SVGs

**Files:**
- Create: `docs/images/readme/deeting-privacy.svg`
- Create: `docs/images/readme/deeting-workflow.svg`
- Modify: `README.md`

**Step 1: Create the privacy SVG**

Show:
- local desktop block
- cloud supplement block
- clear directional connection

**Step 2: Create the workflow SVG**

Show:
- input
- local agent layer
- knowledge and memory
- output or push loop

**Step 3: Verify asset references**

Run:

```bash
rg -n "deeting-privacy.svg|deeting-workflow.svg" README.md
```

Expected:
- both assets are referenced exactly once in the visual explanation section

**Step 4: Sanity-check file presence**

Run:

```bash
ls docs/images/readme
```

Expected:
- `deeting-hero.svg`
- `deeting-privacy.svg`
- `deeting-workflow.svg`

**Step 5: Commit**

```bash
git add docs/images/readme README.md
git commit -m "docs: add readme architecture visuals"
```

### Task 5: Add capability icons, feedback diagram, and hard-feature cards

**Files:**
- Create: `docs/images/readme/icon-hunt-feishu.svg`
- Create: `docs/images/readme/icon-bandit-loop.svg`
- Create: `docs/images/readme/icon-template-map.svg`
- Create: `docs/images/readme/icon-assistant-route.svg`
- Create: `docs/images/readme/icon-memory-facts.svg`
- Create: `docs/images/readme/deeting-bandit-feedback.svg`
- Modify: `README.md`

**Step 1: Create 5 small SVG icons**

Represent:
- hunt + Feishu loop
- bandit feedback loop
- template mapping
- semantic assistant routing
- memory fact extraction

**Step 2: Add a Bandit feedback-loop diagram**

Create a dedicated diagram showing:
- user query
- candidate assistants
- vector + bandit scoring
- user feedback
- next round optimization

**Step 3: Replace generic feature bullets with concrete cards**

Use inline HTML table or another GitHub-safe layout so each feature has:
- icon
- short title
- concrete explanation

Also compress repeated generic marketing bullets so the middle of the README stays sharp.

**Step 4: Verify card references**

Run:

```bash
rg -n "icon-hunt-feishu|icon-bandit-loop|icon-template-map|icon-assistant-route|icon-memory-facts|deeting-bandit-feedback" README.md
```

Expected:
- all icon files and the feedback diagram are referenced from the feature area

**Step 5: Commit**

```bash
git add README.md docs/images/readme
git commit -m "docs: add concrete capability cards to readme"
```

### Task 6: Final review and verification

**Files:**
- Modify: `README.md`
- Verify: `docs/images/readme/deeting-hero.svg`
- Verify: `docs/images/readme/deeting-privacy.svg`
- Verify: `docs/images/readme/deeting-workflow.svg`

**Step 1: Check relative links**

Run:

```bash
rg -n "\\]\\(\\./" README.md
```

Expected:
- all local doc and image references use repo-relative links

**Step 2: Preview the main content blocks**

Run:

```bash
sed -n '1,220p' README.md
```

Expected:
- hero, badges, star history, and hard capability cards are visible before developer details

**Step 3: Verify only intended files changed**

Run:

```bash
git diff -- README.md docs/images/readme docs/plans
```

Expected:
- diff is limited to the landing-page README work

**Step 4: Commit**

```bash
git add README.md docs/images/readme docs/plans
git commit -m "docs: refresh deeting root readme landing experience"
```
