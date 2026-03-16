---
name: skill_manager
id: official.skills.skill_manager
description: "Guidance for installing skills into shared directories that Deeting scans and can refresh directly."
---

# Skill Installation Guide

## Overview

This bundle is guidance-only. It explains how to install skills so Deeting can discover them, but it does not run package-manager commands for you.

The current contract is:

- Install with any ecosystem you prefer
- Put the skill under a directory Deeting scans
- Ask Deeting to refresh the local skill index when needed

## Supported Install Paths

- Shared agent skills:
  - Windows: `C:\Users\<you>\.agents\skills\`
  - macOS/Linux: `~/.agents/skills/`
- Deeting managed user skills:
  - Windows: `C:\Users\<you>\AppData\Roaming\com.deeting.app\skills\`
  - macOS/Linux: platform `app_data_dir()/skills`

If a skill lands in one of those directories, Deeting can scan and register it.

## Recommended Flows

### Install with `npx skills`

```bash
npx skills add <package> -g -a codex -y
```

This typically lands under `~/.agents/skills`, which Deeting now scans directly.

### Install with OpenClaw

Use OpenClaw's own install workflow if that is your preferred ecosystem. The key requirement is still the same: the final skill bundle must land in a directory Deeting scans.

### Manual install

You can also clone or copy a skill bundle by hand into a scanned directory.

## Refresh

If the desktop app does not pick up a newly installed or edited skill immediately, refresh the skill index from Deeting.

- Ask AI to run the `refresh_skill_index` tool
- Or use any direct desktop refresh entry wired to `register_local_skills`

## Notes

- Deeting owns env/config/runtime injection, not the external installer
- Shared agent skills are externally managed; remove them with the ecosystem that installed them
- Docs-first skills are valid; a skill does not need `deeting.json` or executable tools to be discoverable as guidance
