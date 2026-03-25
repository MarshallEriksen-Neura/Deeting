# Desktop Official Skill Capability Contract Design

Date: 2026-03-14

## Summary

桌面端 official skills 不再通过历史 host tool 名直接调用宿主执行面，而是统一调用一套桌面专用 capability id。桌面 host 维护唯一 capability registry，负责定义 capability 的稳定命名、输入 schema、可调用入口、风险/审批元数据以及实际 dispatch 逻辑。

这次设计明确服务于 **desktop-local only** 产品边界；不再为已关闭的云端聊天执行面保留兼容语义。

## Why now

当前桌面端 official skills 的核心问题不是单点缺少 alias，而是不存在一套桌面本地唯一真相源：

- official wrapper Python 里写的是一组历史 `deeting.call_tool(...)` 字符串；
- desktop official-skill marker bridge 只显式支持 `register_local_skills`；
- code-mode bridge 已有部分 alias，但不适用于 official-skill marker path；
- `search_sdk`、审批风险和真实执行入口不是同一命名系统。

如果继续在旧名字上加 alias，只会延长 drift。既然现在产品方向已经收束到桌面端，就应该直接建立桌面 capability contract，并让 official-skill bridge 围绕它重建。

## Goals

- 为 desktop-local official skills 建立稳定的 capability id 命名体系。
- 让 official-skill marker bridge 从 capability registry 查真相，而不是继续硬编码旧 host tool 名。
- 迁移桌面明确应支持的 official wrappers 到新 capability id。
- 保持 `search_sdk` / `execute_code_plan` 作为桌面原生 runtime 原语，不再鼓励用 wrapper 重包一层旧 host tool 名。
- 为后续把 `search_sdk`、审批风险和桥接执行统一到同一 registry 打下基础。

## Non-Goals

- 不在本轮完成整个 runtime 的统一 capability registry 收口。
- 不在本轮重写 `search_sdk` 的结果结构。
- 不在本轮继续为云端 builtin/plugin lanes 保留兼容 contract。
- 不在本轮保留历史 host tool 名作为长期兼容入口。

## Current seams

### 1. Official skill bindings are marker-mode subprocess bindings

- `collect_local_skill_tool_bindings(...)` 把 `llm-tool.yaml` 里的工具注册成 `binding_kind = "deeting_tool"`。
- Python Deeting SDK 在 desktop subprocess 中通过 marker-mode `call_tool` 反向请求宿主执行。

这意味着 official skill 是否能调用到宿主能力，关键并不在 code-mode bridge，而在 marker host bridge。

### 2. The current marker bridge only knows one internal host tool

`dispatch_internal_skill_host_tool(...)` 现在只认 `register_local_skills`。  
除了这一条以外，其它 official skill 里发出的 `deeting.call_tool(...)` 都会走到 unresolved error。

### 3. Some local aliases already exist elsewhere, but in the wrong lane

例如 memory 的 `add_knowledge_chunk` / `list_user_memories` 在 code-mode bridge 已经可以解析，但那条兼容不适用于 official-skill marker path。这个差异正是当前理解成本和行为漂移的来源之一。

## Target architecture

### 1. Desktop capability registry

新增桌面专用 registry，定义 capability spec：

- `id`
- `description`
- `kind`
- `callable_from`
- `risk metadata`
- `dispatch target`

`kind` 至少分为：

- `direct_capability`
- `system_action`

本轮不把 `search_sdk` / `execute_code_plan` 收进 official-skill bridge registry；它们继续作为 runtime 原生原语。

### 2. Official-skill bridge resolves capability ids, not legacy host tool names

desktop official-skill marker bridge 的输入 contract 改成 capability id，例如：

- `skill_registry.refresh`
- `memory.append`
- `memory.list`
- `monitor.create`
- `monitor.list`
- `provider_preset.list`
- `provider_preset.replace`
- `provider.verify`
- `web.fetch`
- `assistant.onboarding.submit`

marker bridge 不再把旧 host tool 名当作桌面 contract。

### 3. Capability registry owns dispatch truth

bridge 的执行流程变成：

1. 读取 marker 请求里的 capability id
2. 在 registry 查 spec
3. 检查该 capability 是否允许 `official_skill`
4. 调用对应 dispatcher
5. 返回结构化结果

这样 “名字是什么、能不能调、怎么执行” 三件事回到同一处定义。

## First-wave kept capabilities

本轮只收录桌面明确有真实执行面的能力：

- `skill_registry.refresh`
- `memory.append`
- `memory.search`
- `monitor.create`
- `monitor.list`
- `provider_preset.list`
- `provider_preset.upsert`
- `provider.verify`

说明：

- `provider_preset.upsert` 在宿主侧复用现有 list/replace 存储能力，对 official skill 暴露更贴近产品语义的单项保存入口。
- `memory.search` 先对齐到桌面本地 memory search truth，而不是继续沿用 cloud 风格的 `list_user_memories` 命名。

## Explicit exclusions in this phase

这些项不进入第一版桌面 official-skill capability contract：

- `expert_network`
- `code_interpreter`
- `provider_registry`
- `scheduler`
- `ingestor`

理由：

- `expert_network` 和 `code_interpreter` 本质上是 runtime 原生原语，后续更适合从 official skill 体系中退场。
- `provider_registry` 和 `scheduler` 没有可信的桌面对等执行面。
- `ingestor` 仍依赖当前桌面没有的 metadata refine 宿主能力，不能只迁移一半就宣称闭环。

## Migration strategy

### Phase 1: Establish bridge-side registry

- 新增 registry / dispatch 模块
- 让 official-skill marker bridge 通过 registry dispatch
- 保留 `register_local_skills` 旧逻辑的等价迁移，但 capability id 改为 `skill_registry.refresh`

### Phase 2: Migrate kept wrappers

- 改 `packages/official-skills/*` 中保留的 wrapper，让它们调用新的 desktop capability id
- 同步更新 `SKILL.md` / `llm-tool.yaml` 描述中关于宿主能力的命名

### Phase 3: Mark exclusions clearly

- 暂不改写 docs-only / backend-first wrappers 的整体产品行为
- 但在代码层停止暗示这些旧 host tool 名属于桌面 official-skill contract

## Acceptance criteria

- official-skill marker bridge 可通过 capability registry 成功解析桌面首批 capability id。
- `skill_manager`、`memory`、`monitor`、`database`、`provider_probe`、`ingestor` 的桌面支持部分改为 capability id 调用。
- legacy host tool names 不再作为 desktop official-skill contract 继续扩张。
- targeted tests 覆盖 registry lookup、dispatch 和关键 wrapper 案例。

## Risks

- 第一轮切换会把真实桌面缺口暴露得更明显，特别是混合型 wrappers。
- 如果 capability id、risk 词汇和 `search_sdk` 文案继续漂移，后续统一仍会返工。
- `provider_preset.replace` 与现有 wrapper 的 “create” 心智不完全一致，需要文案和参数解释同步更新。

## Design rule

- 桌面 capability 名由宿主定义，official skill 只消费，不再反向定义宿主 contract。
