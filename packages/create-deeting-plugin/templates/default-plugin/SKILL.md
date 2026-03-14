---
name: hello_deeting
description: "A simple local Deeting plugin that greets the user and emits a UI card."
---

# Deeting Plugin Template

## Overview

Use `SKILL.md` as behavior guidance for this plugin.

- `deeting.json` stores metadata, runtime, permissions, and UI/backend entrypoints.
- `llm-tool.yaml` defines the callable tool contract in the current `tools:` format.
- `main.py` is a stdin-driven backend entrypoint that dispatches `method`/`arguments`.

## Available Tools

- `hello_deeting` — Greet the user and render a simple status card. Required: `name`.

## Usage Notes

- Rename the tool in `SKILL.md`, `llm-tool.yaml`, and `main.py` together.
- Keep the backend entrypoint JSON-in / JSON-out contract intact.
- Keep `ui/index.html` if the plugin renders frontend content.
