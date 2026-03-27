# Browser Mode Panel Layout Design

Updated: 2026-03-27
Status: approved
Scope: `desktop local + chat workspace right panel`

## Goal

Fix the Browser Mode workspace panel so long content stays inside the right-side panel and scrolls within the panel instead of overflowing past the visible workspace.

## Problem

The current `BrowserModePanel` renders a full-height card, but the card body is not constrained as a scrollable flex region.

As a result:

- the action header and the detail cards compete for the same vertical space
- long card stacks push the lower content outside the visible panel
- the user loses the expected "main panel internal scroll" behavior

## Approved Direction

Use the existing workspace shell and card system, but change the panel structure to:

1. fixed-height outer panel container
2. card as a vertical flex shell
3. header pinned at the top
4. content body as the only vertical scroll container
5. compact responsive card grid for the summary sections

This is a lightweight redesign, not a product rewrite:

- keep existing actions
- keep existing text keys and state semantics
- keep the timeline and request sections
- do not introduce tabs, drawers, or new navigation

## Layout Shape

- Outer wrapper: `min-h-0 h-full`
- Card: `flex min-h-0 h-full flex-col overflow-hidden`
- Header: `shrink-0` with wrapped action buttons
- Body: `min-h-0 flex-1 overflow-y-auto`

Inside the body:

- recovery banner first when present
- primary summary cards in a compact responsive grid
- request block below the summary grid
- timeline block last

## Visual Treatment

Follow the current Deeting workspace language rather than introducing a new visual system:

- preserve the existing `Card` and `Button` primitives
- tighten vertical spacing
- use stronger section grouping through subtle borders/backgrounds
- keep the page URL secondary and truncated
- let buttons wrap cleanly on narrower panel widths

## Verification

Verification should focus on the actual failure seam:

- the panel root remains full height inside the workspace
- the content body becomes the scroll boundary
- existing interactive actions still work
- the page inspection action still opens the native canvas view
