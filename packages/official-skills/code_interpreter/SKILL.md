---
name: code_interpreter
description: "Stateful Python execution for data analysis and math."
---

# Code Interpreter

## Overview

Stateful Python execution for data analysis and math.

- Runtime: `cloud`, `local`
- Permissions: `sandbox.execute`

## Available Tools

- `run_python` — Executes Python code in a stateful, isolated sandbox environment. Persistent variables are supported between calls in the same session. Required: `code`. Optional: `session_id`.

## Usage Notes

- Keep requests within the tools listed above.
- Reuse `session_id` when you want to preserve execution state across calls.
