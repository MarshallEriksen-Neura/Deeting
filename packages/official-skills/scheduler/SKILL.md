---
name: scheduler
description: "Handle long-running background tasks."
---

# Task Scheduler

## Overview

Handle long-running background tasks.

- Runtime: `cloud`, `local`

## Available Tools

- `submit_background_job` — Submit a task to be processed in the background. Required: `type`, `payload`.
- `check_job_status` — Check the status of a background job. Required: `job_id`.

## Usage Notes

- Keep requests within the tools listed above.
