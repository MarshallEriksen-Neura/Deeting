---
name: hello_deeting
description: "A simple tool to greet the user and show a status dashboard."
---

# Deeting Plugin Template

## Overview

Use `SKILL.md` as the primary AI-facing entry for this plugin.

- Keep `deeting.json` focused on metadata, runtime, permissions, and UI entrypoints.
- Keep `llm-tool.yaml` only when a host needs an explicit tool contract.
- Keep `main.py` aligned with the tool names and behavior described here.

## Available Tools

- `hello_deeting` — Greets the user and renders a simple status dashboard. Required: `name`.

## Usage Notes

- Rename `hello_deeting` in `SKILL.md`, `main.py`, and `llm-tool.yaml` together.
- Keep `ui/index.html` if the plugin renders frontend content.
