---
name: skill_manager
description: "Autonomous skill installer and local environment manager. Supports git clone and symlinking."
---

# Skill Manager

## Overview

The Skill Manager is a core Deeting skill responsible for extending the system's capabilities by installing, updating, and indexing new skills from remote git repositories. It handles the low-level file system operations (cloning and symlinking) and ensures that newly added skills are semantically indexed and ready for use.

## Core Tools

- `install_skill_from_git`: Clones a remote repository to a local storage directory (`~/.deeting/repos`) and creates a symlink in the application's search path. This allows Deeting to discover and load the skill dynamically.
- `refresh_skill_index`: Triggers a full rescan of all local skill directories. This is essential after manual file changes or installation of new skills to ensure the semantic search index (LanceDB) is up-to-date.
- `uninstall_skill`: Removes the symlink for a locally installed skill, effectively disabling it from the Deeting runtime without deleting the source code in the repos directory.

## Usage Guidelines

- **Rule 1: Name Uniqueness**: Always provide a unique and descriptive `skill_name` when installing to avoid conflicts in the symlink directory.
- **Rule 2: HTTPS URLs**: Prefer HTTPS URLs for git cloning to ensure compatibility across different environments.
- **Rule 3: Post-Install Refresh**: After a successful installation, the system usually triggers a refresh, but you should verify by checking the skill availability if the LLM cannot immediately see the new tools.

## Anti-Patterns

- **Do NOT manually delete files** in the `~/.deeting/repos` directory unless you intend to completely purge the source code. Use `uninstall_skill` to safely disable a skill.
- **Avoid installing untrusted repositories**: Since skills can execute code, ensure the source repository is reputable.
