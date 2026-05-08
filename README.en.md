<div align="center">
  <img src="./deeting/app/icon0.svg" alt="Deeting OS logo" width="112" />
  <h1>Deeting OS</h1>
  <p><strong>Your personal AI gateway and intelligent context hub</strong></p>
  <p>Local-First AI Gateway & Context Hub</p>
  <p>
    <a href="https://github.com/MarshallEriksen-Neura/Deeting/releases">Download Latest Release</a>
    ·
    <a href="./README.md">中文 README</a>
    ·
    <a href="./docs/macos-installation-en.md">macOS Installation</a>
    ·
    <a href="#quick-start">Quick Start</a>
  </p>
</div>

<p align="center">
  <img alt="Release badge" src="./docs/images/readme/badge-release.svg" />
  <img alt="Open source badge" src="./docs/images/readme/badge-open-source.svg" />
  <img alt="Platform badge" src="./docs/images/readme/badge-platform.svg" />
  <img alt="Tauri badge" src="./docs/images/readme/badge-tauri.svg" />
  <img alt="Bandit badge" src="./docs/images/readme/badge-bandit.svg" />
</p>

Deeting OS is a local-first desktop AI platform. It is not just another chat shell. It pulls AI conversation, tool use, knowledge retrieval, memory accumulation, terminal context, Island interaction, and IM collaboration into one workstation.

If you do not want one more talking input box, but a desktop workstation that can actually connect to your local environment, build up reusable context over time, and organize AI into long-running workflows, Deeting is designed in that direction.

<p align="center">
  <img src="./docs/images/readme/deeting-hero.png" alt="Deeting overview" width="100%" />
</p>

## What Deeting Is

The core idea behind Deeting is not to squeeze everything into a chat window, but to build around a more truthful working model:

- You talk to AI on the desktop, but the model sees more than a single prompt.
- It can connect to local knowledge, memory, tools, documents, and terminal context when needed.
- It can answer once, but it can also turn useful outcomes into reusable skills, knowledge entries, workflow templates, and collaboration surfaces.

In other words, Deeting behaves more like an AI gateway for a personal workstation than a thin client that only forwards requests to a model.

## What It Solves

Many AI products feel impressive on first use, then quickly hit a few practical limits:

- The model does not understand the real context on your machine.
- Valuable information is scattered across chats, folders, docs, group threads, and terminal sessions, with no durable accumulation.
- Tool calls and workflows are one-off. You need to explain them again next time.
- IM collaboration, tool use, local execution, and knowledge retrieval live in separate systems with no unified entry point.

Deeting tries to pull those boundaries back together and make the desktop the real working surface again.

<p align="center">
  <img src="./docs/images/readme/deeting-privacy.png" alt="Deeting local-first boundary" width="100%" />
</p>

<p align="center"><em>Core context stays on the desktop whenever possible. Remote services only provide minimal supporting roles.</em></p>

## Core Capabilities

### 1. A local-first desktop AI workstation

- Built on `Next.js 16 + React 19 + Tauri 2 + Rust`.
- The desktop app owns conversation, tool routing, runtime orchestration, and local capability access.
- It keeps the flexibility of a modern web UI while still connecting to local files, terminal sessions, and system capabilities.

### 2. AI gateway and runtime orchestration

- It includes a multi-module desktop runtime instead of acting as a simple API forwarder.
- The Rust side already spans capability domains such as `desktop_runtime`, `execution`, `skills`, `mcp`, `providers`, and `workflow`.
- It is designed to carry tool execution, skill invocation, model routing, and local orchestration.

### 3. Terminal context in the chat loop

- The chat route already embeds a real terminal instead of treating it as a separate developer-only side panel.
- The current implementation supports request-scoped terminal context that the model can read on demand, instead of forcing terminal output into the input box.
- The terminal protocol layer already supports command boundaries, context snapshots, and send-to-AI style actions.

### 4. Local knowledge and LLM Wiki

- Deeting supports local knowledge assets, indexing, and retrieval.
- The dedicated `llm_wiki` module owns local semantic knowledge flows such as corpus maintenance, automation, watchers, and ongoing upkeep.
- It is meant to turn scattered notes, documents, references, and project material into a durable local knowledge layer.

### 5. Memory as a first-class layer

- Deeting does not treat chat history as equivalent to memory.
- It already supports memory storage, search, snapshots, and rollback for long-running use.
- This is better suited to a persistent personal AI than a disposable one-session chatbot.

### 6. Island interaction layer

- The chat route already mounts `IslandShell`; it is not a decorative floating widget outside the main workspace.
- On the Tauri side, a dedicated `island` window is pre-created with show/hide, sizing, positioning, and global shortcut support.
- It behaves like a lightweight always-near-desktop interaction layer for status, quick actions, approvals, selection-driven actions, and reply handoff without forcing you back into the full main window.
- In the current implementation, Island already handles the selected-text action strip: `Translate`, `Explain`, `Summarize`, `Ask`, `Search`, and `Copy`.
- Translation is not a placeholder. It already includes quick translate, target-language picking, recent target memory, and clipboard-seeded translation when opened manually.

<p align="center">
  <img src="./docs/images/readme/deeting-island-home.png" alt="Deeting Island home" width="100%" />
</p>

<p align="center"><em>Island is not a cosmetic floating pill. It is a lightweight desktop interaction surface that can stay close at hand.</em></p>

<p align="center">
  <img src="./docs/images/readme/deeting-island-translator.png" alt="Deeting Island translator" width="100%" />
</p>

<p align="center"><em>Translation already lives inside Island. You do not need to jump back into the full chat runtime just to translate text.</em></p>

### 7. Browser plugin / Browser Agent execution surface

- The repo already contains a dedicated Chrome extension execution surface at `packages/deeting_chrome/`.
- Its role is not “run another AI inside the browser.” Its role is to expose a bounded browser action surface to the desktop runtime.
- The boundary is explicit: the desktop AI makes decisions, while the extension executes browser-side actions over a localhost WebSocket bridge.
- In the current implementation, this already covers several key actions: connect to desktop, open tabs, read structured page snapshots, execute bounded click/type/scroll actions, and gate high-risk actions behind approval.
- To the user, it feels more like Deeting reaching into the current web page than a second browser chatbot product.

<p align="center">
  <img src="./docs/images/readme/deeting-browser-agent-popup.png" alt="Deeting Browser Agent popup" width="78%" />
</p>

<p align="center"><em>The browser-side surface connects to the current page and can trigger actions such as Ask Current Page, Search Wiki, and Search Memory.</em></p>

<p align="center">
  <img src="./docs/images/readme/deeting-browser-agent-island-result.png" alt="Deeting Browser Agent result in Island" width="100%" />
</p>

<p align="center"><em>Browser results do not stay trapped in the extension. They flow back into the desktop Island and can then be brought into the main chat workspace.</em></p>

### 8. Compatibility-oriented extension surface

- The repo still keeps `packages/`, `skills`, and `mcp` extension surfaces, which means Deeting does not reject extensibility.
- But the current product story is not “please adopt a fully custom Deeting-only plugin path.”
- The stronger direction is to reuse existing ecosystems where possible and connect the desktop runtime cleanly.

### 9. Local execution and sandboxing

- Deeting supports local code execution, desktop-side execution surfaces, and sandbox runtime integration.
- The repo already contains BoxLite-related sidecar and sandbox modules for safer execution scenarios.
- This makes room for future code runs, document generation, and execution-oriented workflows.

### 10. IM as an entry point

- The current IM module already covers `Feishu`, `Telegram`, and `Wechat` directions.
- The desktop app is not the public callback endpoint. `deeting-relay/` exists as the external relay boundary.
- This keeps the desktop as the true execution surface while IM remains an external collaboration entry point.

## Real Usage Scenarios

If the README still feels abstract, these 4 scenarios are closer to how Deeting is actually meant to be used.

### Scenario 1: Debugging with terminal context still attached

You are running a project locally, watching logs, and issuing shell commands. The real problem is not just one pasted error block. It lives in the current shell state, recent commands, command output, and working directory.

In that situation, Deeting matters because the chat chain can actually attach terminal context. The model sees more than a manually copied error snippet. It sees something closer to the real desktop situation.

If the main window is not currently in focus, Island can keep the relevant status, actions, and handoff path near the desktop surface instead of forcing everything back into the full workspace.

That is why Island matters here: not because it looks nice, but because it changes the workstation from “a big window you must fully reopen” into “a lighter interaction layer that can stay near you.”

### Scenario 2: Handling approvals, selected text, and quick replies without returning to the full window

Many desktop AI products stop being useful once the main window is hidden. In Deeting’s current state, Island already holds lightweight interaction state such as recent messages, pending approvals, selection context, browser lookup, and quick reply.

That means you do not always need to fully return to the main workspace just to approve an action, act on selected text, or send a short reply to keep the context alive.

More specifically, the current interaction model is already moving toward “select, then act.” When you highlight text, you do not always need to paste it back into a full chat window. You can trigger `Translate`, `Explain`, `Summarize`, `Ask`, `Search`, or `Copy` directly from Island.

For reading foreign-language content, reviewing docs, scanning group threads, or moving through web content, that is much more natural than copy-paste round-tripping through the full workspace every time.

<p align="center">
  <img src="./docs/images/readme/deeting-island-selection-actions.png" alt="Deeting Island selected text actions" width="100%" />
</p>

<p align="center"><em>The selected-text action strip brings translate, explain, summarize, ask, search, and copy directly onto the reading surface.</em></p>

### Scenario 3: Turning scattered material into a durable local knowledge layer

Sometimes you do not need a better answer. You need a better container for long-term accumulation. Project docs, meeting notes, technical research, screenshots, and references are usually scattered across directories and tools.

Deeting is not positioned here as temporary Q&A. It is positioned as a system where knowledge, memory, and `llm_wiki` can work together: ingest, structure, retrieve, and reuse. The next time you return, you do not need to explain everything from scratch again.

### Scenario 4: The desktop executes; IM is just the outer contact surface

Many teams want AI to be reachable from Feishu or other IM platforms, but sensitive model setup, knowledge assets, tool execution, and local environment state should not live directly on a public callback surface.

Deeting’s boundary is closer to this chain: IM events enter `deeting-relay`, the desktop pulls and executes them, and the result is then sent back outward. The desktop remains the center of runtime truth while IM becomes a convenient collaboration layer.

## Architecture Overview

In one sentence: Deeting is closer to a desktop-centered AI runtime than a simple chat shell.

### 1. The desktop app is the system, not just the UI

The main application lives in `deeting/`. The frontend handles workspace UI, chat, knowledge, memory, terminal, and settings. Tauri + Rust connects those surfaces to the local runtime.

That means the desktop app is not just a display shell for API responses. It is the real execution surface of the product.

### 2. The Rust runtime owns orchestration

Under `deeting/src-tauri/src/modules/`, the repo already contains modules such as `desktop_runtime`, `execution`, `terminal`, `knowledge`, `memory`, `llm_wiki`, `skills`, `mcp`, `providers`, `workflow`, and `sandbox`.

Together they handle model calls, tool routing, execution control, state, knowledge retrieval, extension entry points, and local capability bridging. This is the core runtime.

### 3. Frontend surfaces are tied into the same context system

In Deeting, chat is not just an input box. The terminal is not just a side panel. Knowledge and memory are not isolated attachment pages. They all feed into the same desktop runtime chain.

So it is more accurate to understand the UI not as “multiple pages,” but as “multiple entry points into one shared context system.”

### 4. Island brings the workstation onto the desktop surface

Deeting does not lock all interaction inside the main window. `IslandShell`, the dedicated `island` window, global shortcuts, and the hide-main-show-island window strategy all point toward a more persistent desktop presence.

The value is not just “one more small window.” It is that status, quick reply, approvals, selected-text actions, translation, explanation, search hops, and workspace restore actions can all happen in a lighter interaction layer.

If the main window is the full workstation, Island is the part of that workstation that stays visible on the desktop surface.

### 5. Growth comes from skills, protocol compatibility, and execution surfaces

Deeting is not limited to built-in features. The `skills` / `mcp` layers, the extension-related assets in `packages/`, and local execution plus sandboxing allow it to grow into a more capable workstation rather than a fixed set of pages.

<p align="center">
  <img src="./docs/images/readme/deeting-bandit-feedback.png" alt="Deeting feedback loop" width="100%" />
</p>

<p align="center"><em>Feedback is not a side detail. It is part of how routing becomes better aligned with real user preference over time.</em></p>

### 6. The browser plugin is a browser execution surface, not a second brain

The boundary inside `packages/deeting_chrome/` is explicit: the desktop AI is the decision surface, while the extension is the bounded browser execution surface.

That matters for how the feature should be described. The browser plugin is not another independent AI product. It is the desktop runtime extending its reach into live web pages.

### 7. IM is an entry point, not the system center

`deeting-relay/` exists because external message ingress can live in IM while context truth, tool execution, and runtime ownership still stay on the desktop.

That is why the README should describe Deeting around what the desktop can do, not around external ingress channels.

## A More Truthful Workflow

You can think of Deeting as this chain:

1. You start a conversation or task on the desktop.
2. Deeting pulls in local knowledge, memory, tools, terminal context, or document assets when needed.
3. The desktop runtime handles model calls, tool orchestration, execution, and result return.
4. Valuable output gets accumulated into knowledge, memory, templates, or reusable workflow surfaces.

That is the main difference from many chat-first products: Deeting is not only about answering once. It is about continuously building your personal context system.

<p align="center">
  <img src="./docs/images/readme/deeting-workflow.png" alt="Deeting workflow" width="100%" />
</p>

## Who It Is For

- Individual developers or heavy desktop users who want AI to connect to the real local environment.
- Product builders who want knowledge, memory, tools, and conversation unified inside one workstation.
- Builders who care about skills, document generation, knowledge retrieval, or IM-connected execution flows.
- Teams that want AI to behave like a real desktop workstation rather than just another conversational interface.

## Quick Start

### Installation

Download the latest release from [GitHub Releases](https://github.com/MarshallEriksen-Neura/Deeting/releases).

#### Windows

Download `Deeting Setup_x.x.x_x64-bootstrapper.exe` and run the graphical installer.

#### macOS

The current macOS build is not notarized yet, so first launch needs an extra confirmation step. See [macOS Installation](./docs/macos-installation-en.md).

#### Linux

Download the `.deb` or `.AppImage` package and install it in the usual way.

### Before first launch

1. Have `Python 3` and `Node.js` available on the host machine.
2. Prepare at least one usable model service configuration.
3. Prepare at least one embedding model for knowledge and memory features.

### Suggested first-run order

1. Install and open Deeting.
2. Go to the dashboard and configure your AI service.
3. Pull or sync the model list once from the model page.
4. Run the agent runtime check from settings.
5. Configure the desktop assistant model and embedding model.
6. Set your preferred Island shortcut and main-window close behavior.
7. Then start using chat, knowledge, memory, and Island together.

## Development

The main desktop application lives in [`deeting/`](./deeting/).

### Start the frontend development environment

```bash
cd deeting
bun install
bun run dev
```

### Start the desktop development environment

```bash
cd deeting
bun install
bun run desktop:dev
```

### Build the desktop application

```bash
cd deeting
bun run desktop:build
```

`deeting/scripts/tauri-with-protoc.mjs` automatically resolves and injects `PROTOC` before running Tauri commands.

## Repository Structure

```text
.
├─ deeting/           # Main desktop app (Next.js + Tauri + Rust)
├─ deeting_core/      # Core backend / task and test assets
├─ deeting-relay/     # IM relay service as public ingress boundary
├─ installer/         # Windows graphical installer
├─ scout/             # Standalone reconnaissance / crawling service
├─ packages/          # Extension-related templates, SDK, and compatibility assets
│  └─ deeting_chrome/ # Chrome browser execution extension
├─ docs/              # Documentation and README images
└─ scripts/           # Helper scripts
```

The most important directories are:

- [`deeting/`](./deeting/): the main product entry, including frontend UI, the Tauri shell, and Rust modules.
- [`deeting-relay/`](./deeting-relay/): puts Feishu and other IM callbacks behind a relay before the desktop executes them.
- [`packages/`](./packages/): retained extension-related templates, SDK, and compatibility assets.
- [`packages/deeting_chrome/`](./packages/deeting_chrome/): browser execution surface that lets the desktop runtime extend into page reading and bounded DOM actions.
- [`scout/`](./scout/): standalone reconnaissance, scraping, and deep-crawling service.

## Major Capability Domains Already Present

If you want a quick sense of how far the repo already goes, `deeting/src-tauri/src/modules/` already contains domains such as:

- `desktop_runtime`
- `execution`
- `terminal`
- `knowledge`
- `memory`
- `llm_wiki`
- `skills`
- `mcp`
- `providers`
- `workflow`
- `generated_files`
- `image_generation`
- `im`
- `sandbox`

That is why this README should not describe Deeting as just “an AI chat app.” It is already broader than a typical chat product.

## Subprojects

### `deeting-relay`

A lightweight relay service that accepts Feishu and other IM callbacks, then forwards them to the local desktop runtime for execution.

### `scout`

A standalone reconnaissance service for web extraction, anti-bot handling, and deep crawling. It is suited to external knowledge acquisition.

### `packages`

An extension-related toolbox containing SDKs, templates, and compatibility assets. It exists, but it is not the current center of the product story.

### `installer`

A Windows graphical installer that packages the main app into a more user-friendly installation path.

## Open Source Signal

If you want to know not only what Deeting is, but whether it is an active open-source project, this is the most direct chart:

## Star History

<a href="https://www.star-history.com/?repos=MarshallEriksen-Neura%2FDeeting&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&legend=top-left" />
 </picture>
</a>

## Community and Updates

If you also value `sincerity`, `friendliness`, `solidarity`, and `professionalism`, you are welcome to join [LinuxDo](https://linux.do/latest).

I will keep posting Deeting updates here:

- [Deeting update thread / discussion](https://linux.do/t/topic/2070886)
