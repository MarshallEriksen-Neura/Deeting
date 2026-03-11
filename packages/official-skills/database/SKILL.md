---
name: database
description: "Manage LLM Provider Presets and Templates."
---

# Provider Manager

## Overview

Manage LLM Provider Presets and Templates.

- Runtime: `cloud`
- Access: `admin`

## Available Tools

- `list_provider_presets` — List all available LLM provider templates.
- `create_provider_preset` — Create a new provider template. Required: `name`, `slug`, `base_url`, `auth_type`.

## Usage Notes

- Keep requests within the tools listed above.
- This package is restricted to `admin`.
