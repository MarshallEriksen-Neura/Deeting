---
name: skill-creator
description: "Meta-skill to upgrade existing Deeting skills to the Agent Skills (SKILL.md) standard. Essential for improving LLM's understanding and control of official skills."
---

# Skill Creator: Upgrading Deeting Skills

## Overview

Use this skill to systematically upgrade Deeting's Official Skills into the docs-first `SKILL.md` standard. The target shape is `SKILL.md` first, with `deeting.json` for metadata/runtime/UI and `llm-tool.yaml` kept only when a host still needs an explicit callable contract.

## Upgrade Process

You MUST follow these steps for each skill being upgraded:

1. **Inventory Skills** — Use `list_official_skills` to see what needs upgrading.
2. **Analyze Implementation** — For a target skill, read `SKILL.md` if present, then inspect `deeting.json`, `llm-tool.yaml`, and `main.py` to understand its real capabilities.
3. **Generate SKILL.md** — Create a `SKILL.md` that captures:
    - **Name & Description** (from `deeting.json`)
    - **Tools & Parameters** (from `llm-tool.yaml`)
    - **Detailed Instructions** (How/When to use the tools, constraints, and anti-patterns)
    - **Checklists/Process Flow** (If applicable to the skill's logic)
4. **Validate** — Ensure the new `SKILL.md` matches the physical capabilities of the implementation and keep `llm-tool.yaml` aligned only when that host contract is still used.

## SKILL.md Standard Template

Every `SKILL.md` you create MUST have this frontmatter and structure:

```markdown
---
name: <skill-name>
description: "<concise-description>"
---

# <Display Name>

## Overview
<Broad explanation of the skill's purpose>

## Core Tools
- `tool_name`: <How it works>
- `tool_name`: <How it works>

## Usage Guidelines
- **Rule 1**: ...
- **Rule 2**: ...

## Anti-Patterns
- Avoid doing X when Y...
```

## Safety & Best Practices

- **Sync with Reality**: Do NOT describe features in `SKILL.md` that aren't actually implemented in the code.
- **Precision**: Use exact tool names as defined in `llm-tool.yaml`.
- **Instructional Depth**: Provide the "why" and "when" beyond just the "what".
