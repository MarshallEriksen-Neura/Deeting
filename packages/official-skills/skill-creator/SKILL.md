---
name: skill-creator
description: "Meta-skill to upgrade existing Deeting skills to the Agent Skills (SKILL.md) standard. Essential for improving LLM's understanding and control of official skills."
---

# Skill Creator: Upgrading Deeting Skills

## Overview

Use this skill to systematically upgrade Deeting's Official Skills into a tool-first standard. The target shape is callable tool contracts first (`llm-tool.yaml` or generated schema), `deeting.json` for metadata/runtime/UI, and `SKILL.md` as guidance/safety context.

## Upgrade Process

You MUST follow these steps for each skill being upgraded:

1. **Inventory Skills** — Use `list_official_skills` to see what needs upgrading.
2. **Analyze Implementation** — For a target skill, read `SKILL.md` if present, then inspect `deeting.json`, `llm-tool.yaml`, and `main.py` to understand its real capabilities.
3. **Generate / Update SKILL.md** — Create or revise `SKILL.md` so it captures:
    - **Name & Description** (from `deeting.json`)
    - **Tools & Parameters** (from `llm-tool.yaml`)
    - **Detailed Instructions** (How/When to use the tools, constraints, and anti-patterns)
    - **Checklists/Process Flow** (If applicable to the skill's logic)
4. **Validate** — Ensure callable contracts and implementation stay aligned first, then ensure `SKILL.md` matches real behavior and constraints.

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
