---
name: skill_manager
description: "Manage Deeting skills through npx skills and keep them linked into Deeting's local skills directory."
---

# Skill Manager

## Overview

This skill is Deeting's bridge to the `npx skills` ecosystem.

It should:

- search skills with `npx skills find <query>`
- install skills with `npx skills add <package>`
- check and update installed skills with `npx skills check` / `npx skills update`
- keep Deeting's own app-data skills directory linked to the installed skills so desktop indexing can discover them

## Core Rules

1. **Use `npx skills` first** for search/install/update flows.
2. **If `npx skills add` is unavailable or fails, fall back to `git clone + local link`** for repo-based installs.
3. **Deeting discovery must still point at Deeting's own skills directory**. After installation, mirror or symlink the installed skill into `$APP_DATA_DIR/skills/<skill_name>`.
4. **Docs-first skills are valid**. Do not assume `deeting.json`, `main.py`, or tool executables are required.
5. **Check the local environment first** when installation fails. The critical binaries are `git`, `node`, `npx`, and `python3`.

## Available Tools

- `find_skills`
- `add_skill`
- `check_skill_updates`
- `update_skills`
- `inspect_skill_environment`
- `refresh_skill_index`
- `uninstall_skill`

## Usage Notes

- If a package exposes multiple skills, prefer selecting explicit `skill_names` instead of installing blindly.
- After any add/update/remove operation, refresh the Deeting skill index.
- Do not link skills into other agent directories and assume Deeting will see them automatically. The Deeting-local skills path must remain part of the flow.
