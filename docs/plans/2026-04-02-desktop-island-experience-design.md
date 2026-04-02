# Desktop Island Experience Design

Updated: 2026-04-02
Status: proposed
Scope: `desktop local + chat quick access + compact overlay experience`

## Summary

Deeting desktop should introduce a design-first `Island` experience that replaces the current "minimize or hide to tray" dead-end with a compact, desirable, always-available interaction surface.

The first version should not be a shrunk full chat page. It should be a dedicated compact surface for:

- status awareness
- quick reply
- tool approval
- one-click return to the full workspace

The product bet is simple: users will only keep the feature enabled if the island looks good enough to live on screen and feels lighter than reopening the main window. Visual quality is therefore the gating requirement, not just transport or window plumbing.

## Goal

Make minimize behavior on desktop lead to a premium compact island experience that users actively prefer over tray-only hiding.

## Product Goals

- Give desktop chat a persistent top-center entry point that feels intentional rather than like a hidden background app.
- Create a compact surface that users are willing to keep visible for long periods.
- Support the two highest-frequency interrupt flows inside the island: quick text reply and approval handling.
- Preserve the full chat workspace as the primary workbench while making the island the primary ambient surface.
- Reuse the current local desktop runtime and IM-proven local orchestration path instead of inventing a parallel execution stack.

## Success Criteria

- The collapsed island is visually distinct from a generic black floating box.
- A user can understand the current state in under 5 seconds.
- A user can send a short message without reopening the main window.
- A user can approve or reject a blocked tool call from the island.
- Expanding to the main window feels immediate and predictable.
- If island mode fails or is unsupported, the app cleanly falls back to the current tray behavior.

## Non-Goals

- This phase does not aim to reproduce a system-native macOS Dynamic Island.
- This phase does not attempt to embed the full chat workspace inside the island.
- This phase does not add history sidebar, canvas, workspace panel, or rich attachment editing into the compact view.
- This phase does not create a separate conversation backend for the island.
- This phase does not depend on relay-only transport or cloud-first execution.

## Why Now

The current desktop close/minimize story solves process persistence but does not create affection or habit. Tray hiding keeps the app alive, but it does not produce an ambient desktop presence.

The island initiative addresses a more important product question:

- not only "can the app keep running?"
- but "does the user want to keep it around?"

Because this is a habit-forming surface, design quality is the foundation. If the island looks cheap, cramped, or overly terminal-like, users will minimize it once and stop using it.

## Current Product Truth

- The desktop app already has a transparent, undecorated shell suitable for a custom floating surface.
- The current title bar minimize button still performs a native minimize action.
- The existing desktop close flow already treats "minimize" as a hide-to-tray semantic in the platform abstraction.
- The current IM path already proves a reusable local text conversation route with acknowledgement, local orchestration, approval interruption, and resume-after-approval handling.

This means the product gap is not "missing backend capability." The gap is the lack of a compact interaction model and a high-quality compact visual system.

## Product Direction

### The island is a compact companion, not a tiny workspace

The full chat window remains the place for:

- long-form conversation
- browsing history
- complex multi-panel work
- attachments and deep context

The island becomes the place for:

- glanceable status
- recent message preview
- quick reply
- approval actions
- restore full workspace

### Primary user promise

"When I minimize Deeting, it does not disappear. It becomes a beautiful, quiet, useful companion at the top of my screen."

## Design Principles

### 1. Desirability first

If the island does not look premium, users will treat it like a debug overlay instead of a product surface.

### 2. Compact is a different interface, not a smaller page

Do not scale the current chat page down. Build a compact presenter with its own information architecture.

### 3. Ambient, not demanding

The island should feel present and alive without constantly demanding attention.

### 4. One glance, one action

Collapsed mode should answer "what is happening?" Expanded mode should allow "what should I do next?"

### 5. Shared runtime, separate presenter

Reuse the current local runtime and approval paths, but keep the island UI independent from IM transport-specific presentation.

### 6. Honest fallback

If island mode cannot run, fall back to tray. Do not trap the user in a broken half-state.

## Experience Definition

### Collapsed State

Collapsed state is the default resting form after minimize.

It should show:

- micro logo
- current run status or assistant state
- one short text summary
- optional unread, activity, or approval indicator

It should support:

- single click to expand
- drag to reposition later if needed, but not required for v1
- hover reveal of slightly richer status

It should not show:

- multi-line transcript
- button overload
- terminal blocks
- heavy chrome

### Expanded State

Expanded state is the actionable compact panel.

It should show:

- header with micro logo and state
- latest response or current approval card
- quick reply composer
- restore-to-main-window affordance

It should support:

- sending a short text message
- approve or reject
- open full desktop chat

It should not include:

- history sidebar
- workspace tabs
- large configuration surfaces
- long-scrolling message feeds as the primary mode

### Full Workspace Restore

The full workspace remains the authoritative deep-work interface.

Restore should:

- bring the main window back
- preserve the current session
- feel like a continuation, not a route reset

### Fallback State

If the compact window fails to initialize or cannot be safely displayed:

- return to current tray behavior
- preserve the session
- leave the app recoverable through tray or shortcut

## Visual Direction

The island should not use a plain black rectangular shell.

The target aesthetic is:

- warm glass capsule
- subtle metal edge
- calm atmospheric gradients
- soft blur with crisp content

### Visual Language

- Material: frosted ceramic glass, not terminal panel
- Shape: long capsule with careful radius, not rounded card pretending to be an island
- Contrast: controlled and premium, not hard neon
- Motion: inhale, glide, unfold
- Density: sparse but intentional

### Color Direction

Suggested palette:

- base light: soft porcelain and warm fog
- base dark: charcoal mist rather than pure black
- accent: restrained amber-copper
- active state: muted jade or teal
- approval state: warm gold
- error state: restrained ember, not alarm red by default

### Typography Direction

- prioritize legibility at small size
- avoid terminal cosplay in the default shell
- use stronger type contrast between label and state
- keep one short line readable at a glance

### Motion Direction

Motion should communicate state changes without becoming ornamental:

- minimize to island: compress and dock
- expand: unfurl vertically from the capsule
- active state: subtle breathing pulse
- approval state: contained emphasis, not shaking or flashing

## Logo Direction

The island should use a dedicated micro mark rather than the full Deeting logo or a mascot.

Working direction: `Deeting Seed`

Characteristics:

- horizontally balanced to fit the capsule
- recognizably branded even at 16px to 20px
- abstract enough to feel premium
- can pulse around a small core to indicate activity

The mark should evoke:

- listening
- memory core
- quiet intelligence

The mark should avoid:

- cartoon robot faces
- pixel pet styling
- generic letter `D`
- black badge with orange outline

## Architecture Direction

### Runtime reuse decision

The island should reuse the current IM-proven local conversation route, not the IM transport shell itself.

Approved direction:

- extract a shared local text conversation service
- keep current IM runtime as one caller
- make island runtime another caller
- route replies, approvals, and resume actions through the same local orchestrated chat path

Rejected direction:

- making the island pretend to be an IM profile
- creating a second island-only chat backend
- embedding execution logic in the island presenter

### Presenter separation

The island should be implemented as a compact presenter layer with its own components:

- `IslandShell`
- `IslandCollapsedView`
- `IslandExpandedView`
- `IslandQuickReplyComposer`
- `IslandApprovalCard`

The current full chat page and store remain intact.

## Milestones

### Milestone 0: Product and visual lock

Objective:

- agree on the island's purpose, aesthetic, and first-release boundaries

Deliverables:

- approved design doc
- approved compact information architecture
- approved micro logo direction
- approved visual tokens and motion direction

Exit criteria:

- team agrees the island is not a mini workspace
- visual direction is explicit enough to prototype without reinterpretation

### Milestone 1: Visual prototype

Objective:

- build a high-fidelity island shell with mocked data before touching runtime semantics

Deliverables:

- collapsed island prototype
- expanded island prototype
- micro logo SVG candidate set
- motion prototype for dock, expand, and activity pulse

Exit criteria:

- the prototype no longer reads as a black debug overlay
- the shell is visually recognizable as a Deeting surface
- collapsed and expanded states both feel coherent

### Milestone 2: Compact interaction model

Objective:

- validate the compact information hierarchy and interaction loops

Deliverables:

- quick reply interaction design
- approval card interaction design
- restore-to-main-window interaction design
- state mapping for idle, active, approval-needed, and error states

Exit criteria:

- each state has a single obvious primary action
- no state requires opening the full window for routine acknowledgement

### Milestone 3: Shared runtime extraction

Objective:

- extract a shared local text conversation service from the current IM route

Deliverables:

- shared local conversation service
- island-facing command surface
- IM caller migrated onto the shared service with no behavior loss

Exit criteria:

- island and IM both use the same core reply and approval path
- approval resume still works after extraction

### Milestone 4: Island shell integration

Objective:

- wire island UI to real local runtime responses

Deliverables:

- real quick reply
- approval actions inside island
- latest-message rendering
- session continuity with the main window

Exit criteria:

- island can complete a real send-and-receive loop
- approval can be handled without leaving the island

### Milestone 5: Window behavior transition

Objective:

- change desktop minimize behavior from native minimize to island mode entry

Deliverables:

- minimize enters collapsed island
- expand restores main window or island panel appropriately
- tray fallback remains available
- startup and restore rules are deterministic

Exit criteria:

- no dead-end minimize path remains
- recovery behavior is predictable across restart and failure cases

### Milestone 6: Closed-loop validation

Objective:

- validate that the feature is both usable and desirable

Deliverables:

- internal visual review pass
- interaction verification pass
- runtime verification pass
- issue list for v1 polish vs v1.1 follow-up

Exit criteria:

- the island is judged worth keeping enabled
- core flows pass end to end
- known compromises are documented rather than hidden

## Workstreams

### Workstream A: Visual design

- define shell proportions
- define collapsed and expanded spacing
- define color and blur system
- design micro logo
- define motion curves and durations

### Workstream B: Product interaction

- define state model
- define content priority rules
- define island-specific action model
- define restore and fallback semantics

### Workstream C: Frontend presenter

- implement compact components
- build mocked-state prototype
- connect store-driven rendering

### Workstream D: Desktop runtime

- extract shared local conversation service
- expose island-safe commands
- preserve existing IM behavior

### Workstream E: Windowing

- introduce island mode state
- drive minimize-to-island transition
- support restore and tray fallback

### Workstream F: Verification

- visual QA
- state transition QA
- runtime and approval QA
- degraded path QA

## Detailed Phase Plan

### Phase 1: Design discovery

- audit current HUD, title bar, and desktop shell surfaces
- collect visual references and anti-references
- define what the island should never look like
- produce first-pass visual directions

### Phase 2: Information architecture

- reduce island content to the smallest useful unit
- define summary text rules
- define approval card compression rules
- define quick reply character and layout constraints

### Phase 3: Prototype

- build a standalone island shell with fake states
- evaluate collapsed readability
- evaluate expanded action density
- iterate on logo, spacing, and materials

### Phase 4: Shared runtime extraction

- isolate local text reply generation
- isolate approval and resume handling
- make IM and island share the same service boundary

### Phase 5: Real integration

- wire island send and receive
- wire approval actions
- wire session continuity
- wire restore-to-main-window behavior

### Phase 6: Minimize transition

- map title bar minimize into island entry
- keep close semantics distinct from minimize semantics
- preserve tray fallback and shortcuts

### Phase 7: Closed-loop polish

- verify visuals under long-running usage
- verify approval interrupt behavior
- verify failure fallback behavior
- decide what slips to follow-up

## Acceptance Criteria

- A minimized Deeting window can enter a collapsed island state instead of disappearing to tray.
- The collapsed island visually communicates product quality and current status.
- The expanded island supports a real quick reply flow.
- Tool approval can be handled directly from the expanded island.
- The user can return to the full workspace without losing session context.
- The island uses the shared local conversation runtime rather than a duplicated backend.
- Tray fallback remains available when island mode cannot be used.

## Risks

### Risk 1: The island becomes a shrunken chat page

Impact:

- cluttered UI
- poor readability
- weak product identity

Mitigation:

- enforce dedicated compact IA before integration work

### Risk 2: The island looks like a debug overlay

Impact:

- low user desirability
- feature gets disabled or ignored

Mitigation:

- require a visual prototype review before runtime wiring

### Risk 3: Runtime reuse becomes transport leakage

Impact:

- IM-specific assumptions leak into island state
- future maintenance cost increases

Mitigation:

- extract a shared local conversation service instead of binding island directly to IM profile logic

### Risk 4: Minimize, close, tray, and restore semantics blur together

Impact:

- confusing behavior
- regression in desktop expectations

Mitigation:

- explicitly keep minimize-to-island, close-request, quit, and tray fallback as separate paths

### Risk 5: Cross-platform visual behavior diverges

Impact:

- inconsistent experience between Windows and macOS

Mitigation:

- design around the shared top-center floating capsule model rather than a notch-specific fantasy

## Verification Plan

### Visual verification

- collapsed state on light and dark backgrounds
- expanded state with idle, active, approval, and error content
- logo legibility at small sizes
- motion quality during minimize and expand

### Interaction verification

- expand and collapse flows
- quick reply happy path
- approval and rejection flows
- restore to main window

### Runtime verification

- shared local conversation service returns the same reply semantics as current IM
- approval resume remains intact
- session continuity holds across island and main window

### Degraded path verification

- island initialization failure falls back to tray
- missing focus or restore edge cases remain recoverable
- minimize never strands the user in a hidden unrecoverable state

## Closed-Loop Launch Checklist

- design approved
- visual prototype approved
- runtime extraction complete
- island integration complete
- minimize transition complete
- approval flow verified
- fallback behavior verified
- known follow-up list documented

## Deferred Follow-Ups

- draggable island placement
- multiple compact layouts or themes
- richer unread grouping
- attachment-aware quick actions
- cross-monitor placement preferences
- more expressive island animations after v1 stability

## Decision

Proceed with a design-first desktop island initiative.

The visual system and compact interaction model are the first milestone gates. Runtime integration and minimize behavior changes only begin after the shell, logo, and state hierarchy are strong enough to justify becoming a persistent desktop surface.
