# Desktop Runtime De-assistantization Design

Date: 2026-03-11

## Summary
桌面端聊天 runtime 直接去 assistant 化：assistant 不再作为聊天运行时的主状态对象，不再负责人格切换。新的桌面运行时只保留四层对象：固定用户人格（persona）、动态能力画像（capability profile）、独立 skills 文档检索（skill recipes/docs）、以及真正可调用的 direct tools / orchestration primitives。

## Why now
当前桌面端已经同时存在两套不完全一致的语义：
- 显式 assistant 选择会把 assistant `system_prompt` 直接注入聊天 runtime，形成硬人格切换。
- `consult_expert_network`、`active_persona_hint`、`search_sdk` recipe 注入又已经在向“能力增强 / 文档增强”模型演进。

继续让 assistant 同时承载人格、能力、skill 挂载和文档入口，只会增加后续维护成本。既然目标已经明确为“人格固定、能力浮动”，应直接切断 runtime 对 assistant 作为 actor 的依赖。

## Goals
- 去掉桌面聊天 runtime 中的 assistant actor 语义。
- 用户自定义 prompt 成为固定人格层，稳定注入 system prompt。
- `expert_network` / JIT 命中只增强能力，不改变 AI 性格、语气或身份。
- 将 skill 文档 / recipe 检索从 assistant 语义中再拆一层，成为独立 JIT 步骤。
- 复用当前桌面 `expert_network` 提示样式，但文案改为“能力已启用”而不是“assistant 已切换”。

## Non-Goals
- 不处理云端 internal chat / backend workflow 的 assistant 重构。
- 不在本轮移除 assistant 资产本身的创建、同步、市场或安装能力。
- 不要求一步完成所有数据模型迁移；允许先做 runtime 去耦，再做持久层瘦身。

## Current desktop seams

### 1. Assistant is still a runtime actor
- `deeting/src-tauri/src/modules/mcp/local_orchestrator.rs` 中的 `AssistantPromptInjectionStep` 会根据 `ctx.assistant_id` 读取本地 assistant，并把 `assistant.system_prompt` 直接作为 system message 注入。
- 前端会话创建仍会携带 `assistant_id`，桌面聊天状态仍把 active agent 视为会话主状态。

### 2. Expert routing is already capability-oriented
- `consult_expert_network` 只返回候选 assistant，不直接改人格。
- `active_persona_hint` 只是 soft hint。
- `search_sdk` 已区分 `capabilities`、`recipes`、`orchestration_primitives`，说明文档检索层其实已经独立存在。

### 3. The remaining coupling lives in activation
- `activate_assistant` 当前仍是 `replace` 语义，会同时带出 `system_prompt` 和 `skill_tools`。
- `LocalAssistantVersion` 同时存 `system_prompt` 和 `skill_refs`，让 assistant 继续像“人格 + 能力 + 文档入口”的混合容器。

## Target runtime model

### 1. Persona Profile
桌面本地新增一个固定人格配置，作为聊天 runtime 的唯一人格来源。

职责：
- 语气、表达风格、身份设定、自称
- 回答偏好（简洁 / 详细 / 结构化）
- 长期稳定的人格约束

边界：
- 不承载 skills、tools、capabilities
- 不参与 JIT 路由决策
- 不因 `expert_network` / JIT 命中而变化

### 2. Capability Profile
用 capability profile 取代 runtime assistant。

职责：
- 描述当前 query 适合启用的专业能力
- 表达领域摘要、能力标签、可关联 skills / tools
- 支持 request-scoped 或 session-scoped attach

边界：
- 不携带人格 prompt
- 不改变 AI 性格
- 不承担 skill 文档正文承载

### 3. Skill Recipe / Docs Layer
将 skill 文档检索独立成单独 JIT 层。

职责：
- 从 `search_sdk.recipes` 或本地 skill 文档资产中检索相关 recipe
- 注入短规则、用法约束、docs-first 提示
- 帮助模型理解 skill 如何使用，而不是把 skill 当作直接 tool

边界：
- 不作为人格来源
- 不作为 capability identity
- 不直接替代 tool schema

### 4. Direct Tool / Orchestration Layer
保留现有的 direct capabilities、MCP tools、`execute_code_plan` 等执行层。

职责：
- 真正执行
- 审批、桥接、日志
- 与 capability / recipe 分离

## New desktop runtime flow

### A. Chat path
1. 读取桌面固定 persona prompt。
2. 构建基础 system prompt（平台规则 + persona）。
3. 基于 query 做 capability 检索。
4. 基于 query + capability profile 再做 skill recipe / docs 检索。
5. 决定 direct capability path 或 code mode path。
6. 若启用了专家能力，前端显示“已启用 XXX 专家能力”的弱提示。

### B. Code mode path
1. `consult_expert_network` 仍可返回 expert candidates，但结果语义改为 capability candidates。
2. “activate assistant” 语义改为 “attach capability”。
3. attach 后只注入 capability hint、tool contracts、skill recipe hints。
4. 不再将 `system_prompt` 作为 replace identity payload 注入。

## Data model direction

### Runtime truth sources
- `desktop_config`：新增 persona prompt 配置键，例如 `chat.persona_prompt`。
- capability attach state：运行时 request/session state，不再叫 `active_assistant`。
- skill docs / recipes：继续从已安装技能的 manifest + skill assets + `search_sdk` recipe 视图读取。

### Assistant asset after de-assistantization
assistant 继续存在，但退出 runtime actor 身份，转为 authoring / asset object。

保留职责：
- 组织能力画像元数据
- 组织 `skill_refs`
- 作为资产层 / 市场层对象存在

移除职责：
- 作为聊天会话中的人格来源
- 作为聊天态“当前是谁”的主状态
- 作为 skill docs 的隐式代理

## Migration strategy

### Phase 1: Persona source cutover
- 新增桌面 persona 配置
- 本地 orchestrator 改为从 persona 配置读取固定 prompt
- 前端设置提供 persona 编辑入口

### Phase 2: Remove runtime assistant selection
- 去掉聊天态 `assistant_id` 依赖
- 去掉桌面 active agent 作为聊天主状态
- 会话创建不再以 assistant 作为默认聊天入口参数

### Phase 3: Activation semantic rewrite
- 将 `activate_assistant` 改为 capability attach
- 结果 payload 从 `assistant_transition` 改为 `capability_transition`
- 弱提示文案同步更新

### Phase 4: Skill-doc layer extraction
- capability 检索和 skill recipe 检索拆成独立步骤
- 让 recipe 注入成为明确的 docs layer，而不是 assistant 附庸
- 避免 assistant capability hint 和 skill docs hint 重复注入

### Phase 5: Cleanup and naming
- 将 runtime 中的 `assistant` 命名逐步替换为 `persona` / `capability`
- 仅保留资产层对 assistant 的使用
- 清理历史注释、测试名、提示文案

## Acceptance criteria
- 桌面聊天可以在没有 assistant 选择 UI 的情况下正常工作。
- 用户 persona prompt 在整段会话中稳定存在。
- `expert_network` / JIT 命中不会改变回复性格。
- 启用专家能力后，只出现“能力增强”提示，不再出现“assistant 切换”语义。
- `search_sdk` recipe 注入仍正常工作，并与 capability 注入解耦。
- 桌面 code mode 仍可使用相关 skills / tools，但不再依赖 replace-style assistant activation。

## Risks
- 现有前端和 store 命名里 `agent` / `assistant` 大量复用，第一轮改动容易留下语义漂移。
- 部分历史会话、路由参数或 HUD 可能默认要求 `assistant_id`，迁移时需要清理。
- 如果 capability hint 与 skill recipe hint 同时注入过多内容，可能造成 prompt 冗余。

## Design rule
- 人格归用户，能力归系统，文档归 skill，执行归 tool。

## Open questions
- capability attach 默认是 request-scoped 还是 session-scoped。
- assistant 资产未来是否还需要保留 `system_prompt` 字段用于 authoring preview。
- skill docs 检索是否需要独立的 ranking / dedupe 逻辑，避免与 capability 检索重复。
