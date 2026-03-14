---
name: ingestor
description: "Smart assistant discovery and onboarding from URLs."
---

# Asset Ingestor

## Overview

Smart assistant discovery and onboarding from URLs.

- Runtime: `local`
- Restricted: `admin`
- Permissions: `network.outbound`, `tools.call`, `assistants.write`

## Available Tools

- `ingest_assistant_from_url` — Crawl a URL on desktop and submit the resulting assistant to cloud admin persistence. Required: `url`. Optional: `instruction`.

## Usage Notes

- Keep requests within the tools listed above.
