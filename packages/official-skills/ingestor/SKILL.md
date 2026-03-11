---
name: ingestor
description: "Smart asset discovery and onboarding. Can turn URLs into structured Assistants or Skills."
---

# Asset Ingestor

## Overview

Smart asset discovery and onboarding. Can turn URLs into structured Assistants or Skills.

- Runtime: `cloud`, `local`
- Permissions: `network.outbound`, `tools.call`, `assistants.write`

## Available Tools

- `ingest_assistant_from_url` — Crawl a URL and automatically create a structured AI Assistant based on the content. Required: `url`. Optional: `instruction`.
- `ingest_skill_from_github` — Discover and onboarding a code-based skill from a GitHub repository. Required: `repo_url`.

## Usage Notes

- Keep requests within the tools listed above.
