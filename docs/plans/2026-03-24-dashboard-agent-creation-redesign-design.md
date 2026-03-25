# Dashboard Agent Creation Redesign Design

## Scope

Lane: `desktop local / dashboard 管理面`

This design only covers the dashboard creation page for local custom task agents. It does not redesign:

- the assistants listing page
- chat `@` selection UX
- backend/cloud assistant flows

The goal is to stop mixing chat task agents and image agents inside one generic creation editor.

## Problem

The current dashboard page uses one shared editor for both agent kinds in [task-agents-client.tsx](/data/Deeting/deeting/app/[locale]/dashboard/user/task-agents/components/task-agents-client.tsx). The primary distinction is the `invocation_kind` field, which means:

- users start from one generic `New` action
- users see one mixed asset list
- users switch agent identity by changing a low-level field
- image agents inherit tool and skill binding concepts that belong to chat task agents

This creates the wrong product mental model. Users are not creating "a generic runtime object with a mode". They are creating one of two clearly different products:

- a collaborative chat task agent
- an image generation agent that is invoked via `@` in chat

## Product Decision

Use a two-step creation flow:

`Select type -> Enter dedicated creation workspace`

And apply a hard capability split:

- `聊天任务智能体` can bind skills and MCP tools
- `图片智能体` is a focused image-generation role and does not expose generic bindings

Type is immutable after creation.

## Information Architecture

### Entry

The `New` action no longer opens the generic editor directly. It opens a type selection surface with two large cards:

1. `聊天任务智能体`
2. `图片智能体`

Each card explains the intended use, not the underlying storage model.

### Asset List

The dashboard list remains on the same page, but the list presentation changes from "one flat library with filters" to grouped sections:

- `聊天任务智能体`
- `图片智能体`

Filtering can still exist, but grouping becomes the primary scanning affordance.

### Edit Routing

Selecting an existing agent opens the dedicated editor for its type:

- chat task agent editor
- image agent editor

The type cannot be changed in edit mode.

## Interaction Model

### Step 1: Type Selection

The default empty or new-agent state becomes a starter surface rather than a raw form.

The two type cards should communicate different value:

#### Chat Task Agent Card

- message: good for collaboration, task execution, tools, and skills
- support labels: `对话`, `技能绑定`, `工具调用`
- visual tone: structured, calm, system-like

#### Image Agent Card

- message: good for `@` invocation in chat and consistent image generation
- support labels: `风格设定`, `出图参数`, `图片预览`
- visual tone: canvas-like, visual, creation-oriented

### Step 2: Dedicated Workspace

After type selection, the user enters a focused creation workspace with:

- main editing column
- right-side live summary / preview column

Avoid a generic tab-heavy admin feel. The page should feel like configuring a role with a clear purpose.

## Editor Design

### Chat Task Agent Workspace

Purpose: configure an agent that collaborates in chat and can call bounded capabilities.

Main sections:

1. `身份`
   - name
   - description
   - task prompt
   - model
2. `能力`
   - skills
   - MCP tools
3. `状态`
   - tags
   - discoverable
   - enabled
4. `预览`
   - conversational preview
   - tool call visibility
5. `调试`
   - low-level payload and trace details

Right rail:

- how the agent appears in chat
- selected skills/tools summary
- lightweight preview launch

### Image Agent Workspace

Purpose: configure a focused image-generation role that can be invoked in chat with `@`.

Main sections:

1. `身份`
   - name
   - description
   - image role prompt
   - model
2. `出图设定`
   - style
   - aspect ratio / size
   - quality
   - output count
   - negative prompt
3. `高级参数`
   - advanced image parameters
   - raw extra params JSON if still needed
4. `状态`
   - tags
   - discoverable
   - enabled
5. `预览`
   - image-first preview
6. `调试`
   - image payload summary
   - raw provider payload

Not shown:

- skills
- MCP tools
- generic capability binding counts

Right rail:

- image preview grid
- current style / size / quality summary
- brief note that this agent is meant for chat `@` image invocation

## Visual Direction

This page should not look like one shared technical editor with a mode switch.

### Visual Thesis

Make the page feel like a role studio rather than a backend form. Each type should present a distinct identity at first glance.

### Layout Thesis

- selection state first, form second
- clear top-level hierarchy
- section-based composition instead of dense admin tabs
- preview and role identity should be visible without scrolling deep into low-level fields

### Motion Thesis

Use a few lightweight motions:

- type card hover lift / border glow
- workspace transition from type select to dedicated editor
- preview panel reveal or staggered section entrance

### Tone Split

Chat task agents:

- cleaner structure
- cooler accent treatment
- capability summary emphasis

Image agents:

- more visual emphasis
- warmer or richer accent treatment
- preview-first emphasis

## Data / Architecture Mapping

This redesign does not require a new persistence model immediately.

The existing `custom_task_agent` object can continue as storage truth, with presentation logic split by:

- `invocation_kind = chat`
- `invocation_kind = image_generation`

But the UI must stop exposing this as a user-level mode toggle inside one generic editor.

Recommended UI architecture:

- shell component for page state and list
- starter component for type selection
- dedicated chat agent editor component
- dedicated image agent editor component
- shared low-level helpers only where truly necessary

## Guardrails

- No type switching after creation
- No skills/tools UI inside image agent creation
- No image-specific configuration noise inside chat agent creation
- No fallback to a single mixed "config" tab as the primary experience

## Success Criteria

The redesign is successful if:

1. users immediately understand there are two different agent products
2. image agent creation no longer exposes irrelevant skill/tool concepts
3. chat task agent creation keeps capability binding power without feeling mixed with image settings
4. existing persisted agents still render and edit correctly under their dedicated workspaces
5. the page reads as a creation studio, not a raw backend object editor
