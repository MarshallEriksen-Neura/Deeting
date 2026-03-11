---
name: planner
description: "Architect capabilities: Design execution plans and manage workflows."
---

# Planner

## Overview

Architect capabilities: Design execution plans and manage workflows.

- Runtime: `cloud`, `local`

## Available Tools

- `propose_execution_plan` — Propose a multi-step execution plan for the user to approve. Use this when the request is complex. Required: `title`, `tasks`. Optional: `plan_id`, `rationale`.
- `retrieve_similar_plans` — Search the Knowledge Base for similar past plans to reuse. Required: `query`.

## Usage Notes

- Keep requests within the tools listed above.
