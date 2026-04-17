---
name: monitor
description: "Proactive monitoring and alerting system."
---

# Active Monitor

## Overview

Proactive monitoring and alerting system.

- Runtime: `cloud`, `local`

## Available Tools

- `sys_create_monitor` — Create a persistent monitoring task. Required: `title`, `objective`, `assistant_id`. Optional: `cron_expr`, `allowed_tools`.
- `sys_list_monitors` — List all active monitors.

## Usage Notes

- Keep requests within the tools listed above.
