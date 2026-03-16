---
name: ingestor
description: "Assistant ingest persistence for already-collected content."
---

# Asset Ingestor

## Overview

Persist already-collected content for assistant ingest.

- Runtime: `local`
- Restricted: `admin`
- Permissions: `tools.call`, `assistants.write`

## Available Tools

- `submit_assistant_ingest` — Submit content that has already been collected by search/crawl tools to cloud admin persistence. Required: `source_url`, `content`. Optional: `instruction`.

## Usage Notes

- Use search or crawl tools first when you need to gather content from a URL.
- Keep requests within the tools listed above.
