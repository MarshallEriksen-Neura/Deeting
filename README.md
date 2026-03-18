# Deeting

Deeting main repository.

## Installation

Download the latest release from [GitHub Releases](https://github.com/MarshallEriksen-Neura/Deeting/releases).

> **Note for macOS users**: Since this is an open-source project without an Apple Developer account ($99/year), the macOS version is not code-signed. On first launch, right-click the app and select "Open". See [macOS Installation Guide](./docs/macos-installation-en.md) for details.

## Requirements

1. Python3 and Node.js environment
2. After first login, configure your AI service in the dashboard, then manually fetch models from the model list (you need at least one embedding model)
3. Go to settings to run agent detection, then configure the desktop secretary model and embedding model

## Submodules

Desktop sandbox service:
https://github.com/boxlite-ai/boxlite

Memory design references:
- https://github.com/Dataojitori/nocturne_memory
- https://github.com/AGI-is-going-to-arrive/Memory-Palace

Cloud sandbox service:
https://github.com/alibaba/OpenSandbox

AI runtime reference:
https://developers.cloudflare.com/agents/api-reference/codemode/
