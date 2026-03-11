---
name: provider_probe
description: "Probe AI providers to verify connectivity and schema compatibility."
---

# Provider Probe

## Overview

Probe AI providers to verify connectivity and schema compatibility.

- Runtime: `cloud`
- Permissions: `network.outbound`

## Available Tools

- `probe_provider` — Probe a provider to verify connectivity, protocol-family fit, and compatibility with the unified provider runtime. Required: `provider_type`, `base_url`, `api_key`, `model`. Optional: `capability`, `protocol`.

## Usage Notes

- Keep requests within the tools listed above.
