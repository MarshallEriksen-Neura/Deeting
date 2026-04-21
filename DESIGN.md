# Deeting — Desktop Workstation Design System

> Apple-grade desktop application. Tech engineering aesthetic.
> Single-window workstation with a collapsible navigator and a tab-based workspace.
> The app **is** the content — no pages, no hero sections, no scroll storytelling.

This document is the source of truth for every surface inside the Tauri shell and the Next.js web console. It combines Apple's native desktop vocabulary (Xcode, Finder, Settings, Logic Pro, Music) with the taste rules from `design-taste-frontend` and `high-end-visual-design`, and the project's existing iOS glass token system.

---

## 0. Philosophy — Workstation, Not Website

Deeting is a **professional tool that lives inside one window**. A user opens it the same way they open Xcode, Figma, or Linear: they expect a persistent navigator, a workspace that changes state without "loading a new page", and a title bar that belongs to the operating system.

Every design decision is evaluated against this test:

> *"Would Apple Human Interface Guidelines approve this inside a native macOS app, or does it smell like a marketing page?"*

| Web mental model (banned) | Workstation mental model (required) |
|---|---|
| Full-bleed hero section | Toolbar + workspace surface |
| Alternating dark/light scroll sections | One constant workspace material, panels switch state |
| Click → navigate → loading → new page | Click → in-place state transition (tab, pane, detail) |
| Centered call-to-action headline | Left-aligned toolbar with primary action in toolbar tray |
| "Scroll to reveal features" | All primary affordances visible at rest |
| Marketing illustrations | Data, code, live status, real content |
| Mobile-first breakpoints | Desktop-first; 1280×800 is the canvas, not 375×667 |

**Design variance baseline:** `DENSITY = 6`, `MOTION = 5`, `VARIANCE = 4`.
Workstation feel sits firmly in "Daily App Mode" with tight spacing, not an "Art Gallery" landing page.

---

## 1. App Shell Architecture

The entire application is assembled from exactly three persistent regions. These regions never move, never disappear during navigation, and never collapse together.

```
┌─────────────────────────────────────────────────────────────┐
│  ① TITLE │  ·  Tauri drag region · unified toolbar          │  32px
│          │──────────────────────────────────────────────────│
│          │  ③ WORKSPACE TOOLBAR (breadcrumb · tabs · tray)  │  48px
│          ├──────────────────────────────────────────────────┤
│          │                                                  │
│  ②       │                                                  │
│ SIDEBAR  │             ③ WORKSPACE SURFACE                  │  flex
│ (nav)    │           (content · inspector slot)             │
│          │                                                  │
│  72 /    │                                                  │
│  264 px  │                                                  │
│          │                                                  │

```

### Region roles

| Region | Width / height | Material | Collapse rule |
|---|---|---|---|
| ① Title bar | full × 32px (macOS) / 36px (Windows) | `Chrome Material` — opaque, matches window chrome | never collapses; hosts traffic-lights + window title |
| ② Sidebar | 264px expanded / 72px collapsed | `Sidebar Material` — translucent, saturated blur | user-collapsible, keyboard `⌘\` (macOS) / `Ctrl\` (Windows) |
| ③ Workspace | remainder | `Window Background` — opaque surface | never collapses; hosts tabs + active view |
| ④ Status bar | full × 26px | `Chrome Material` | optional hide via setting |

### Inspector slot (context-dependent)

A workspace view may open a **right-side inspector pane** (288–360px wide) for detail/properties. This is *not* a new page — it slides in over the workspace with a spring transition and can be pinned or auto-hidden. Think Xcode's right inspector or Figma's right panel.

```
[ sidebar | toolbar  ·  tabs  ·  tray              ]
[  nav    | workspace surface  |  inspector  288px ]
[         | status bar                             ]
```

### Tabs, not routes

Navigation inside the workspace happens through **tabs**, not URL transitions. A user opens "Knowledge > /engineering", clicks an entry, and it appears as a second tab in the same workspace — identical to how Xcode or Arc browser tabs work. The URL still updates for deep linking, but the visual model is tab-switching, not page navigation.

---

## 2. Color System

Single constrained accent, saturation-disciplined neutrals, no decorative color. The brand accent (project purple `#6D5CFF`) is reserved exclusively for **interactive state** and **agent identity** — never for decoration.

### Base neutrals — "Window Background" and "Sidebar" materials

| Token | Light | Dark | Role |
|---|---|---|---|
| `--window-bg` | `#F7F7F8` (zinc-50 warm) | `#0B0C10` (near-OLED, not pure black) | Workspace surface |
| `--sidebar-bg` | `rgba(246, 247, 250, 0.78)` + 32px saturate blur | `rgba(12, 13, 18, 0.72)` + 32px saturate blur | Translucent sidebar material |
| `--chrome-bg` | `#EFEFF3` | `#141520` | Title bar, status bar |
| `--panel-bg` | `#FFFFFF` | `#141520` | Raised panels, cards |
| `--panel-bg-inset` | `#F2F2F5` | `#0E0F15` | Inset surfaces (code blocks, textfields) |
| `--hairline` | `rgba(15, 17, 28, 0.08)` | `rgba(255, 255, 255, 0.06)` | The only border you should use |
| `--hairline-strong` | `rgba(15, 17, 28, 0.14)` | `rgba(255, 255, 255, 0.11)` | Active/selected border |
| `--ink` | `#14151C` | `#E8EBFF` | Primary foreground |
| `--ink-2` | `rgba(20, 21, 28, 0.74)` | `rgba(232, 235, 255, 0.78)` | Secondary text |
| `--ink-3` | `rgba(20, 21, 28, 0.52)` | `rgba(232, 235, 255, 0.56)` | Tertiary / meta |
| `--ink-4` | `rgba(20, 21, 28, 0.36)` | `rgba(232, 235, 255, 0.38)` | Disabled, placeholder |

**Never use `#000000` or `#FFFFFF` for backgrounds.** Off-black and off-white prevent the "AI uncanny contrast" look.

### Accent — the single chromatic budget

| Token | Value | Role |
|---|---|---|
| `--accent` | `#6D5CFF` | Primary interactive (selected nav rail, focused input, primary CTA fill, agent identity) |
| `--accent-soft` | `rgba(109, 92, 255, 0.12)` | Accent tinted fills (selected row, hover pill) |
| `--accent-border` | `rgba(109, 92, 255, 0.34)` | Accent-tinted hairlines |
| `--accent-ink` | `#5645E6` (light) / `#A6B0FF` (dark) | Accent text on neutral surface |

Usage rule — **one accent per view**. If a view already highlights "selected nav item" in accent, the primary CTA in the toolbar must downgrade to a neutral button. Agent chat bubbles, agent status dots, and the active tab underline may share the accent because they all represent "agent / system identity".

### Semantic colors — signals only

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ok` | `#1F9566` | `#5BDFA0` | Success, "running" agent state |
| `--warn` | `#C48312` | `#F1B85A` | Rate-limit, approval pending |
| `--danger` | `#D4476A` | `#FF7A9A` | Error, destructive confirmation |
| `--info` | `#2A7FFF` | `#6FB0FF` | Neutral system info |

Each semantic has a `*-soft` (12% fill) and `*-border` (34% hairline). Never use them decoratively — they carry a specific meaning on every appearance.

### What is banned
- Pure `#000000` backgrounds or text — use `--ink` / `--window-bg` tokens.
- Pure `#FFFFFF` against `#000000` — never the UI-cliché "max contrast" pair.
- Gradient fills on large surfaces. The only allowed gradient is a **3° tonal shift** at the bottom of the sidebar and a 180px subtle mesh glow behind the empty-state illustrations.
- Accent color on borders of non-interactive elements, on decorative icons, on section headers, or on marketing copy.
- Teal, amber, pink, or any additional brand color outside the tokens above. The project's legacy `--teal-accent` is deprecated for UI and survives only for **two** specific uses: the `ok` streaming indicator in the code atelier, and the livestream "listening" ring in the Island.

---

## 3. Typography

### Font stack

```css
--font-display: "SF Pro Display", "Geist", "AlibabaPuHuiTi", -apple-system, system-ui, sans-serif;
--font-text:    "SF Pro Text",    "Geist", "AlibabaPuHuiTi", -apple-system, system-ui, sans-serif;
--font-mono:    "SF Mono", "Geist Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
```

- **SF Pro** is primary — it already renders natively on macOS Tauri builds and matches the Apple desktop vocabulary.
- **Geist** is the web-console fallback so the Next.js build feels identical in Chrome.
- **AlibabaPuHuiTi** continues to handle CJK content. It must ship self-hosted in `/fonts/AlibabaPuHuiTi-3/` (already configured in [globals.css](deeting/app/globals.css)).
- **Never use Inter, Roboto, Arial, Helvetica, or Open Sans.** These are the generic defaults that flatten the product.
- **Serif fonts are banned on all dashboard and tool surfaces.** The only permitted exception is long-form Markdown body text inside the LLM Wiki reader, where PP Editorial or a Variable serif is allowed at body size only.
- **Geist Mono / SF Mono is required** for numbers, timestamps, tokens, IDs, latency, cost, version strings, and anything that would be tabular. `font-variant-numeric: tabular-nums` is mandatory on every metric.

### Desktop-app scale (tight, not marketing)

| Role | Size | Weight | Line height | Tracking | Notes |
|---|---|---|---|---|---|
| View title | 17px | 600 | 1.2 | -0.2px | Workspace tab label, toolbar title |
| Pane title | 14px | 600 | 1.3 | -0.1px | Sidebar group header, inspector panel |
| Body | 13px | 400 | 1.5 | 0 | Default reading size for dashboards |
| Body-strong | 13px | 600 | 1.4 | 0 | Labels, emphasized inline |
| Control | 12px | 500 | 1.0 | +0.1px | Button, segmented control, menu item |
| Meta | 11px | 500 | 1.3 | +0.2px uppercase | Status chips, side-rail group titles |
| Mono data | 12px | 500 | 1.5 | 0 | Tabular numbers, IDs, code inline |
| Caption | 11px | 400 | 1.3 | 0 | Helper text under inputs |
| Nano | 10px | 500 | 1.2 | +0.3px uppercase | Keyboard hints, legal |

> Workstation scale is **tight**. Do not import the marketing-site 56px display headings. If a designer asks for a heading bigger than 17px inside a workspace view, the answer is either "you want a pane title" or "you want a modal header" — never "a hero".

### Rules
- Apply `-0.1px` to `-0.2px` negative tracking on sizes ≥ 14px.
- Tracking for `Meta` and `Nano` is **positive** and **uppercase** — they behave like state tags, not like prose.
- Body defaults to `--ink-2` (74% ink) so only headings carry full `--ink` emphasis.
- Never center-align body copy. Toolbars, inspectors, and content are always left-aligned (right-aligned in RTL locales).

---

## 4. Sidebar Specification

The project already ships [`glass-sidebar.tsx`](deeting/components/layout/sidebar/glass-sidebar.tsx) with a solid collapse mechanism. This is the spec every future iteration must conform to.

### Dimensions

| State | Width | Item row height | Icon size | Label visibility |
|---|---|---|---|---|
| Expanded | **264px** | 32px | 18px | visible |
| Collapsed | **68px** | 40px (square-ish) | 20px | hidden, tooltip on hover (300ms delay) |

A single user click or `⌘\` hotkey toggles the state with a **300ms spring** (stiffness 180, damping 24). The workspace panel animates its `margin-left` simultaneously — no jank, no reflow.

### Anatomy (top → bottom)

1. **Workspace switcher** — 32px tall, selects which workspace (personal / team / admin) the nav reflects. Collapsed state shows only the 24px workspace glyph.
2. **Global search trigger** — full-width pill, shows `⌘K` keycap on the right, opens the command palette. This replaces any "search page".
3. **Nav groups** — `Meta` label (11px uppercase, `--ink-3`), collapsible with a 10px chevron. Grouped items have 2px vertical gap inside, 14px between groups.
4. **Active rail** — the **only** place accent color is allowed on a container: a 3px × 18px rounded accent bar flush to the left edge of the active item, with a subtle `--accent-soft` fill behind the row.
5. **Footer cluster** — user avatar (28px, double-bezel ring), connection status dot, settings cog. Collapses to a single avatar stack.

### Active state spec

```css
/* Expanded active item */
.nav-item[data-active="true"] {
  background: var(--accent-soft);
  color: var(--accent-ink);
  /* Inner highlight + accent rail */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 3px 0 0 var(--accent);
}
.nav-item[data-active="true"] .nav-icon { color: var(--accent); }
```

- Hover state on inactive items is `--hairline` background only. Never uses accent color.
- Selected icon gets accent tint; inactive icons stay at `--ink-2`.
- Badges (unread counts) are 14px pills in `--accent` fill with white tabular-nums text — never red unless they represent a genuine error condition.

### What the sidebar must not do
- No marketing illustration at the bottom.
- No "upgrade your plan" banner inside the nav — that belongs in a popover from the user cluster.
- No horizontal scroll, ever. Groups collapse, rows truncate with an ellipsis + tooltip.
- No page-refresh transitions on click. The workspace updates in place.

---

## 5. Title Bar (Tauri Window Chrome)

A **unified toolbar** in the macOS sense — the title bar and the primary workspace toolbar share the same drag region, divided only by a hairline.

```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●   Deeting — Knowledge / /engineering        ⌘K  🞁    │  ← title bar, 32px
├─────────────────────────────────────────────────────────────┤
│  ← →  Engineering ›  Decisions        ╱ Code   ≡ Outline    │  ← workspace toolbar, 48px
└─────────────────────────────────────────────────────────────┘
```

Rules:
- The entire 32px + 48px band is a Tauri `data-tauri-drag-region` except interactive elements (buttons, menus) which explicitly set `app-region: no-drag`.
- Traffic lights sit at standard macOS offset (13px × 13px, 20px spacing, 10px from top-left) — the existing implementation handles this.
- On Windows, traffic lights are replaced with the platform's minimise/maximise/close cluster on the right; the title remains left.
- The title reads `Deeting — {view} / {path}` so the OS window chooser shows something useful. No emojis in the title.

---

## 6. Workspace Surface

The workspace is the app. Everything interesting lives here.

### Surface hierarchy (outermost → innermost)

1. **Workspace toolbar** — 48px. Contains, in this order left-to-right:
   - Back / forward arrows (if the view has navigation history)
   - Breadcrumb trail
   - Tab bar (horizontal, underline style — not pill tabs)
   - Right tray: view-specific actions, then the inspector toggle
2. **Content canvas** — scrollable, padded `24px` horizontal / `20px` top / `32px` bottom. Max content width for prose views: 960px. Dashboard views span the full canvas.
3. **Panels** — double-bezel nested cards. See §7.
4. **Inspector** — optional, 288–360px right-docked. Slides in over the canvas with `transform: translateX(100%) → 0` over 280ms, `cubic-bezier(0.32, 0.72, 0, 1)`.

### Empty states (mandatory)

Every view must render a composed empty state — not a generic "No data" string. Structure:
- 48×48px monochrome line icon (Phosphor Light, stroke 1.25px)
- 14px pane-title copy explaining what lives here
- 12px body copy with one concrete next action (a button, not a link)
- Optional 11px keyboard hint `Press ⌘N to create`

### Loading states (mandatory)

- **Skeletons match the final layout** — a table skeleton shows column-shaped rectangles, not pulsing circles.
- Use the existing `animate-glass-card-in` cascade from [globals.css](deeting/app/globals.css) with `.stagger-1` … `.stagger-10` delays.
- Never block the workspace with a fullscreen spinner. Content appears progressively.

---

## 7. Component Library

### 7.1 Double-Bezel Panel (the only correct card)

Every "card" on a dashboard or detail surface uses the nested enclosure pattern. This is what separates Apple-grade UI from the generic Tailwind card.

```html
<!-- Outer shell: aluminum tray -->
<div class="rounded-[18px] p-[6px] bg-[var(--panel-bg-inset)]
            ring-1 ring-[var(--hairline)]
            shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
  <!-- Inner core: glass plate -->
  <div class="rounded-[12px] bg-[var(--panel-bg)]
              ring-1 ring-[var(--hairline)]
              shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
    <!-- content -->
  </div>
</div>
```

- Outer radius = inner radius + 6px. This creates **concentric curves** (the detail the eye reads as "expensive hardware").
- Shadow is a single **inset hairline highlight** at the top, never a Tailwind `shadow-md`. Dropped shadows on the workspace flatten the design.
- On hover, the outer shell's `ring` shifts to `--hairline-strong`. Never scale the panel, never lift it, never animate the shadow — that is mobile-card idiom and looks cheap on desktop.

### 7.2 Dashboard without cards (the preferred default)

When data density is high (monitoring, logs, routing-MAB), **skip panels entirely**. Separate logical groups with `border-t border-[var(--hairline)]` and a `14px` pane-title row above. Breathe via whitespace, not boxes.

```
 Routing decisions                            24h ∙ 7d ∙ 30d
 ────────────────────────────────────────────────────────────
 arm            traffic %       p95 ms        cost /1k
 alpha-opus     47.2%           1,284         $2.40
 sonnet-main    31.8%             912         $0.62
 haiku-fast     21.0%             284         $0.08
```

Monospace numbers, hairline dividers, zero cards. This is "Cockpit Mode" and it is correct for data-heavy views.

### 7.3 Buttons

**Tiered hierarchy** — only one `primary` per region, only one `accent` fill per view.

| Variant | Fill | Border | Foreground | Use |
|---|---|---|---|---|
| `primary` | `--accent` | none | white | The one primary action in a toolbar or modal |
| `secondary` | `--panel-bg` | `--hairline` | `--ink` | The usual button |
| `tertiary` | transparent | none | `--ink-2` | Inline, menu item, cancel |
| `destructive` | `--danger-soft` | `--danger-border` | `--danger` | Delete, revoke |

Geometry:
- Height: **28px** (compact toolbar), **32px** (standard), **38px** (primary CTA in modal). Never taller — this is not a mobile app.
- Radius: **8px** for rectangle buttons, **999px** for pill buttons (filter chips, status toggles).
- Padding: `0 12px` compact, `0 14px` standard, `0 18px` primary.
- Pressed: `translate-y-[1px]` + `filter: brightness(0.96)`. No scale.
- Focus: `0 0 0 2px var(--window-bg), 0 0 0 4px var(--accent)` (double ring, macOS pattern).

**Button-in-Button trailing icon** (for primary CTAs with an implied next step):
```
[  Import knowledge base   ( → ) ]
```
The chevron lives inside its own 22×22 `rounded-full bg-white/14` circle, flush to the right padding. On hover, the inner circle translates `+1px x / -1px y` and scales `1.04`. This is the Linear / Arc pattern and it reads as "premium".

### 7.4 Segmented Control

For view switching inside a panel (e.g., `Code | Preview | Diff`). The segmented control is the native macOS replacement for underline tabs when the options are ≤ 4 and orthogonal.

```css
/* Use existing --ios-segment-* tokens */
height: 28px; padding: 2px; border-radius: 8px;
background: var(--ios-segment-bg);
border: 1px solid var(--hairline);
box-shadow: var(--ios-segment-shadow);
```

Active segment lifts with `var(--ios-segment-active-bg)`, gains `--hairline-strong` border, and adds the `inset 0 1px 0 rgba(255,255,255,0.65)` highlight. Already modeled by `.atelier-seg` in [globals.css](deeting/app/globals.css:1672).

### 7.5 Tabs (workspace navigation)

Underline-style, not pill. They live on the workspace toolbar and replace URL navigation for sibling content.

```css
.tab {
  height: 32px;
  padding: 0 12px;
  font: 500 13px/1 var(--font-text);
  color: var(--ink-2);
  border-bottom: 2px solid transparent;
}
.tab[data-active="true"] {
  color: var(--ink);
  border-bottom-color: var(--accent);
}
```

- Close button (`×`) appears on hover, inside a 16×16 hit target.
- Tabs are reorderable via drag with `framer-motion` `layoutId`.
- Overflow → a `⋯` menu, never horizontal scroll.

### 7.6 Inputs

Text fields, search, combobox, selects — all share the same inset-plate geometry.

```css
height: 30px; padding: 0 10px; border-radius: 8px;
background: var(--panel-bg-inset);
border: 1px solid var(--hairline);
box-shadow: inset 0 1px 0 rgba(15, 17, 28, 0.04);
font: 400 13px/1 var(--font-text);
color: var(--ink);
```

Focus state = the primary accent double-ring (as buttons). No glow, no chromatic shadow.

- Label: 12px / weight 500 / `--ink-2`, placed **above** the input with `gap: 6px`.
- Helper text: 11px / `--ink-3`, below the input, always rendered in markup (even if empty) for CLS stability.
- Error text: 11px / `--danger`, replaces helper text, **with a 10px `ExclamationCircle` icon** inline. Field border shifts to `--danger-border`.

### 7.7 Tables

Native workstation tables are the default for any list of records (logs, agent tasks, routing arms, knowledge entries).

- Header row: 32px, `--ink-3`, 11px uppercase tracked, sticky.
- Body rows: 34px, 13px body, `border-bottom: 1px solid var(--hairline)`.
- Zebra striping is **banned**. Density + hairline is enough — stripes flatten the eye.
- Row hover: `background: color-mix(in oklch, var(--accent) 4%, transparent)`.
- Selected row: `--accent-soft` fill with a 2px left accent rail (mirrors sidebar active state).
- Numeric columns: right-aligned, monospace, tabular-nums.
- Column resize handles appear on hover at 1px visible width.
- Empty state per section: inline row with `--ink-3` centered copy + an inline action button.

### 7.8 Chips & Status Pills

Tag-like metadata and live status indicators. 22px tall, 999px radius, 11px uppercase tracked `Meta` type.

| Variant | Fill | Border | Use |
|---|---|---|---|
| neutral | `--panel-bg-inset` | `--hairline` | Generic tag, version |
| accent | `--accent-soft` | `--accent-border` | Agent identity, selected |
| ok | `--ok-soft` | `--ok-border` | Running, healthy |
| warn | `--warn-soft` | `--warn-border` | Throttled, pending approval |
| danger | `--danger-soft` | `--danger-border` | Error, revoked |

A **pulsing 6px dot** precedes the label when the status is live (running, streaming). Pulse: `1.3s ease-in-out infinite`, box-shadow spread from 0 to 4px. Reuse `.atelier-state-dot` from [globals.css:1354](deeting/app/globals.css#L1354).

### 7.9 Command Palette (`⌘K`)

The replacement for "search page" and most "pick a thing" modals.

- Opens as a floating card, **centered horizontally**, 40% from the top of the viewport.
- 560px wide × auto height, max 60vh.
- Material: `var(--panel-bg)` with `ring-1 ring-[var(--hairline-strong)]` and a single diffusion shadow `0 20px 48px -24px rgba(0,0,0,0.24), 0 0 0 1px var(--hairline)`.
- Enter animation: `opacity 0→1, scale 0.96→1, translateY 8px→0` over 180ms spring.
- Escape, outside click, or `⌘K` again closes with the inverse.

Rows are 40px tall, icon + primary text + inline context + `↵` hint on the right. Arrow-key selection highlights with `--accent-soft` and translates the selected row's accent rail into view.

### 7.10 Inspector Pane

Right-docked, 288–360px, always hosts property lists — never navigation.

- Header: 40px, pane title + close button + optional "pin" toggle.
- Body: alternating 28px rows of `Label → Value`. Label left, value right. Mono for values. Hairline dividers only when the visual rhythm demands it (more than 6 rows without a section break).
- Values are **editable inline** on click when the resource permits. Transition from static value → input is instant (the input adopts the same type stack, no layout shift).

### 7.11 Dynamic Island (already in the project)

The `--island-*` token family in [globals.css](deeting/app/globals.css) powers a floating system-notification capsule. It stays — it's the single decorative motion allowed in the product because it is **information-bearing**, not cosmetic. Do not add a second floating widget.

---

## 8. Motion & Physics

### Global easing tokens

```css
--ease-standard:   cubic-bezier(0.32, 0.72, 0, 1);    /* most UI transitions */
--ease-emphasized: cubic-bezier(0.22, 1,    0.36, 1); /* panel / sheet enters */
--ease-decel:      cubic-bezier(0.16, 1,    0.3,  1); /* hover, focus */
--ease-accel:      cubic-bezier(0.4,  0,    1,    1); /* exit, dismiss */

--dur-fast:    120ms; /* hover, focus ring */
--dur-medium:  220ms; /* tabs, segment switch, tooltip */
--dur-slow:    320ms; /* inspector slide, modal enter */
--dur-emphatic: 480ms; /* first-mount cascades only */
```

### Spring presets (framer-motion)

| Preset | stiffness | damping | mass | Use |
|---|---|---|---|---|
| `ui-tap` | 340 | 22 | 1 | button press, segment switch |
| `ui-sheet` | 240 | 28 | 1 | inspector, drawer, command palette |
| `ui-reorder` | 180 | 20 | 1 | list reorder, tab drag |
| `ui-overshoot` | 160 | 14 | 1 | status pop-in, badge arrival |

**Banned easings:** `linear`, `ease-in-out`, `ease-in`, `ease-out` (the browser defaults), any transition longer than 500ms on a non-first-mount interaction.

### Motion rules
- Animate **only** `transform` and `opacity`. Never `top`/`left`/`width`/`height`.
- `will-change` is set imperatively *on interaction start* and removed on end. Never baseline it.
- Entry cascades use `stagger: 40ms` for up to 8 items, then clip. Never stagger a table of 1000 rows.
- Reorder uses framer-motion `layout` + `layoutId`. Never re-key to force a remount.
- Continuous animations (pulse, shimmer, live dot) live inside an isolated `'use client'` leaf component wrapped in `React.memo`. They must not trigger parent re-renders.
- `backdrop-filter: blur()` is allowed **only** on fixed/sticky elements (sidebar, title bar, modal, command palette). Never on scrolling content.
- `prefers-reduced-motion` collapses every transition to `duration: 0`, fade only, no transforms.

### Entry animations

| Element | Enter | Duration | Easing |
|---|---|---|---|
| Workspace first mount | `opacity 0→1, translateY 12→0` | 320ms | `--ease-emphasized` |
| Tab switch | crossfade + `translateX ±6px` | 180ms | `--ease-standard` |
| Inspector open | `translateX 100%→0` | 280ms | `--ease-emphasized` spring `ui-sheet` |
| Toast / Island arrival | `scale 0.9→1, opacity 0→1` | 220ms | spring `ui-overshoot` |
| Modal | `opacity + scale 0.96→1` | 200ms | `--ease-emphasized` |
| List reorder | `layout` prop on each row | 260ms | spring `ui-reorder` |

---

## 9. Density & Spacing

### Spacing scale (8-point, dense at the low end)

```
2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 56, 72
```

- Row gaps inside a panel: **6 or 8**.
- Between a label and its input: **6**.
- Between groups inside the sidebar: **14**.
- Between workspace toolbar and content: **20**.
- Canvas edge padding: **24 (horizontal) / 20 (top) / 32 (bottom)**.

Never `py-24`-style macro whitespace inside the workspace — that is a marketing-site idiom. The one place where "air" is appropriate is **empty states and modals**, which are allowed `py-40` to `py-56`.

### Radius scale

```
  2px  — pixel indicators, very small chips
  4px  — inline code, micro-tags
  6px  — dense control (keycap, inline button)
  8px  — standard controls (input, button, menu item, tab)
 10px  — compact panels
 12px  — standard panels, inspector cards
 14px  — raised dialog content
 18px  — outer double-bezel shell, modal
 22px  — command palette, large sheets
 999px — pills only
```

Outer + inner always respect **concentric curvature**: outer = inner + inner-padding. Do not mix flat and rounded in the same composition.

### Density modes

The workspace supports three densities; each view declares its default:

| Mode | Row height | Body size | Canvas padding | Use |
|---|---|---|---|---|
| `comfortable` | 36px | 13px | 24 / 20 | Default for most dashboards |
| `compact` | 28px | 12px | 20 / 16 | Logs, tables, routing, monitoring |
| `spacious` | 44px | 14px | 32 / 28 | Reader views (Wiki, Knowledge entry body) |

User may override in Settings → Appearance → Interface density.

---

## 10. Depth & Elevation

Desktop workstations communicate depth through **material** and **hairlines**, not drop shadows.

| Level | Treatment | Use |
|---|---|---|
| 0 — Window background | opaque `--window-bg` | Canvas |
| 1 — Inset | `--panel-bg-inset` + 1px inset top highlight | Textfields, code blocks |
| 2 — Panel | `--panel-bg` + outer hairline + 1px inset top highlight | Double-bezel inner core |
| 3 — Double-bezel shell | `--panel-bg-inset` tray + concentric inner panel | Dashboard modules |
| 4 — Sidebar material | translucent + `saturate(180%) blur(32px)` | Sidebar, title bar |
| 5 — Floating surface | `--panel-bg` + 1px `--hairline-strong` + diffused shadow `0 20px 48px -24px rgba(0,0,0,0.22)` | Popovers, dropdowns, command palette |
| 6 — Modal scrim | `rgba(6, 8, 14, 0.42)` + `backdrop-blur(10px)` | Modal overlay |

**Shadows are tinted.** A shadow on `--window-bg` uses a bluish `rgba(15, 17, 28, …)`; a shadow in dark mode uses pure `rgba(0, 0, 0, …)` because the surface absorbs tint. Never use Tailwind's default `shadow-md`/`shadow-lg` — their opacity math is wrong for this material system.

---

## 11. Iconography

- **Library:** Phosphor Light (stroke 1.25px) primary, Radix Icons for UI-control needs (caret, check, dots).
- **Sizes:** `14px` inline, `16px` control, `18px` nav, `20px` collapsed-nav, `48px` empty state.
- Icons inherit color from `currentColor` — never hard-code fills.
- Banned: Lucide at default stroke (too thick for a workstation), Material Icons, FontAwesome, emojis.

---

## 12. Accessibility & Platform

- Every interactive element has a visible focus ring with the **double-ring** pattern (inner = window-bg, outer = `--accent`).
- Keyboard: `Tab` order matches visual order; `⌘K` global search; `⌘\` toggle sidebar; `⌘1`–`⌘9` switch workspace tabs; `Esc` closes topmost floating surface; `⌘W` closes active tab.
- `prefers-reduced-motion: reduce` → all transitions collapse to instant opacity fades, no transforms.
- Minimum contrast 4.5:1 for body text, 3:1 for large/pane titles, tested in both light and dark.
- macOS: native traffic lights, `vibrancy: sidebar` for sidebar material (via Tauri plugin).
- Windows: client-area dragging via `data-tauri-drag-region`, fallback solid sidebar if `backdrop-filter` is unsupported.
- RTL: sidebar docks right; inspector docks left; tab close button stays logically trailing.

---

## 13. Do's and Don'ts

### Do
- Treat the window as a single application surface; keep the chrome persistent.
- Use one accent per view, and only on genuinely interactive elements.
- Use hairline borders and material contrast to communicate depth.
- Prefer tables, lists, and inspectors over cards for data.
- Use monospace + tabular-nums for every metric.
- Collapse the sidebar with a spring; never fade it out.
- Provide an empty state for every view.
- Put labels **above** inputs; put helper/error text **below**.
- Animate with transforms and opacity only.
- Respect `prefers-reduced-motion`.

### Don't
- Don't reintroduce the Apple marketing-site hero with a 56px centered headline. This is a tool, not a billboard.
- Don't stack three feature cards in a row — use a data list or a double-bezel dashboard module.
- Don't use Tailwind's default `shadow-md`/`shadow-lg`, `border-gray-200`, or `bg-gray-50`. Use the tokens.
- Don't paint the workspace purple. Accent is a state, not a background.
- Don't animate `width`/`height`/`top`/`left` — it will jank.
- Don't use "Inter", "Roboto", "Helvetica", "Arial", or serif on any tool surface.
- Don't use emojis anywhere in the UI. Icons only.
- Don't generate fake placeholder names like "John Doe" or fake metrics like "99.9%". Use messy, realistic data (`47.2%`, `+1 (312) 847-1928`, `alpha-opus`).
- Don't introduce a second decorative floating widget — the Dynamic Island is the only one.
- Don't build "pages". Build views that appear inside the workspace.

---

## 14. Agent Prompt Guide

Copy-paste prompts for generating components that match this system. Each assumes the tokens from §2, motion from §8, and density from §9 are already wired into the project (they are — see [globals.css](deeting/app/globals.css) and [glass-sidebar.tsx](deeting/components/layout/sidebar/glass-sidebar.tsx)).

### Shell / layout

> Build the Deeting workstation shell: a 32px Tauri title bar with drag region and traffic lights; a 48px workspace toolbar directly below, separated by a 1px `--hairline`; a 264/68px collapsible sidebar on the left using the existing `GlassSidebarProvider`; a full-height workspace on the right that animates its `margin-left` with the sidebar; and a 26px status bar at the bottom with connection state, active agent pill, and version mono-string. No drop shadows — use the sidebar translucent material and the chrome/window-bg contrast for depth.

### Sidebar item

> Render a sidebar nav item per §4: 32px tall in expanded mode, 40px square in collapsed. Icon at 18/20px Phosphor Light stroke 1.25. Active state uses `--accent-soft` fill, `--accent-ink` text, and a 3px × 18px rounded accent rail inset on the left edge. Hover on inactive rows uses `--hairline` fill only. Collapsed state shows a Tooltip on the right with 300ms delay carrying the full label. Never use accent color on the icon of an inactive row.

### Double-bezel dashboard module

> Build a dashboard module using the double-bezel pattern: outer shell `rounded-[18px] p-[6px] bg-[var(--panel-bg-inset)] ring-1 ring-[var(--hairline)]`; inner core `rounded-[12px] bg-[var(--panel-bg)] ring-1 ring-[var(--hairline)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`. Inner core contains a 40px header row with a 14px pane title on the left and a segmented control on the right, a 1px `--hairline` divider, and a content region with 16px padding. No drop shadow on the outer shell. Hover: outer ring steps to `--hairline-strong`.

### Primary CTA with button-in-button

> Build a primary CTA following §7.3: 32px tall, `rounded-[8px]`, `bg-[var(--accent)] text-white`, 13px weight 500. Trailing chevron-right icon lives inside a 22×22 `rounded-full bg-white/14` nested circle, flush to the right padding. On hover, the inner circle transforms `translate-x-[1px] translate-y-[-1px] scale-[1.04]`, 220ms `--ease-standard`. On active, the outer button `translate-y-[1px] brightness-[0.96]`. Focus: double-ring pattern (inner `--window-bg`, outer `--accent`).

### Workspace table

> Render a workstation-grade table per §7.7. Header row 32px, 11px uppercase `Meta` type, `--ink-3`, sticky, with sortable columns. Body rows 34px, 13px, `border-bottom: 1px solid var(--hairline)`, **no zebra striping**. Numeric columns right-aligned with `font-mono tabular-nums`. Hover row uses `color-mix(in oklch, var(--accent) 4%, transparent)`. Selected row uses `--accent-soft` fill plus a 2px left accent rail. Row actions appear on hover inside a right-anchored 22px button cluster — not always-on.

### Command palette

> Build the `⌘K` command palette per §7.9. 560px × auto (max 60vh). Floating card at 40% viewport top, horizontally centered. `bg-[var(--panel-bg)] ring-1 ring-[var(--hairline-strong)] shadow-[0_20px_48px_-24px_rgba(0,0,0,0.24)]`, `rounded-[22px]`. Input 44px tall, borderless, 14px, with a leading 16px Phosphor MagnifyingGlass and a trailing `Esc` keycap. Rows 40px, icon + primary + inline context + `↵` keycap. Arrow-key selection highlights with `--accent-soft`. Enter animation: `opacity 0→1, scale 0.96→1, translateY 8px→0`, 180ms spring `ui-sheet`.

### Inspector pane

> Build the right inspector per §7.10. Width 320px, `border-left: 1px solid var(--hairline)`, `bg-[var(--panel-bg)]`. 40px header with a pane title, pin toggle, and close `×`. Body: rows of `Label → Value`, label left at 12px `--ink-2`, value right at 12px `--font-mono tabular-nums --ink`. Rows 28px tall, no dividers unless there's a section break. Clicking a value replaces it with an inline input of identical geometry — zero layout shift. Slide-in from the right over 280ms spring `ui-sheet`.

### Empty state

> Compose an empty state per §6: 48×48 Phosphor Light icon (stroke 1.25) at `--ink-3`, 14px weight 600 pane title, 12px body at `--ink-3` (max-width 360px, left-aligned inside a centered column), one primary CTA using the nested trailing-icon pattern, optional 11px keyboard hint `Press ⌘N to create`. Container is centered within the workspace canvas with `min-height: 60vh` and `padding-block: 56px`. No illustration.

---

## 15. Pre-flight Checklist (enforce before shipping a component)

- [ ] No `#000000` or `#FFFFFF` backgrounds — use `--window-bg` / `--panel-bg`.
- [ ] No `border-gray-*` or `shadow-md`/`shadow-lg` — tokens only.
- [ ] Single accent per view; accent appears only on interactive state.
- [ ] Typography uses SF Pro / Geist / AlibabaPuHuiTi — never Inter / Roboto / Arial / serif.
- [ ] All numbers are `font-mono tabular-nums`.
- [ ] Any transition uses an `--ease-*` token or a spring preset from §8.
- [ ] `prefers-reduced-motion` collapses transitions.
- [ ] Animations touch only `transform` / `opacity`.
- [ ] Interactive elements have a visible double-ring focus state.
- [ ] Empty, loading, and error states are all rendered.
- [ ] Inputs have label above, helper below; error replaces helper.
- [ ] The view has no hero, no marketing card row, no centered CTA.
- [ ] The sidebar state, tabs, and URL deep-link stay in sync, but the visual model is tab-switch — not page navigation.
- [ ] Keyboard: `⌘K` opens command palette, `⌘\` toggles sidebar, `Esc` dismisses top-most surface.
- [ ] macOS + Windows + web-console all render the same component with identical dimensions.

---

## 16. Migration Notes (from the current site-style implementation)

The current repo under [deeting/app/[locale]](deeting/app/[locale]) uses a Next.js-route-per-view pattern that behaves like a website. The migration plan:

1. **Preserve routes as deep-link targets**, but render them all inside a single `DashboardShell` workspace with a tab system. A route change becomes a tab activation, not a full-page re-render.
2. **Deprecate any "hero" section** left from the marketing era. Replace with a workspace toolbar + breadcrumb.
3. **Replace pill CTAs of 980px radius** with the §7.3 button system. Keep 999px pills only for chips/status/filters.
4. **Consolidate shadows** — delete every `shadow-md` / `shadow-lg` / custom decorative shadow on panels; route to the `--hairline` / double-bezel system.
5. **Migrate typography** — the AlibabaPuHuiTi stack stays, but the scale above (17/14/13/12/11/10) replaces any 56/40/28 display sizes inside the workspace.
6. **Keep the existing Island, Atelier, and Glass tokens** in [globals.css](deeting/app/globals.css) — they already match this system. What changes is the surrounding chrome, page patterns, and the scale applied inside workspace views.

The target reference apps for tone and behavior: **Xcode 15, Linear, Raycast, Arc, Logic Pro, macOS System Settings, Figma**. When in doubt about a decision, open those apps and ask: *"What would this look like if it were a panel inside Xcode?"*
