# Deeting 能力与执行模型重构草案 v0

Date: 2026-03-10

## Summary
当前问题不是给 `skill/tool/capability` 多加几个字段就能解决，而是需要把“能力本体、编排方式、执行器、安装来源”拆成正交概念。尤其在引入 Cloudflare Codemode 的参考后，可以明确：简单 tool 调用不应进入 sandbox；sandbox 的职责是执行模型生成的编排代码，而不是充当所有能力的运行宿主。

## Why now
当前系统已经同时存在以下对象，但边界不清：
- host 直接执行的本地工具和 MCP 工具
- `execute_code_plan` 这类 code orchestration 入口
- official skills 与 user skills 的安装/注册/包装逻辑
- WSL / BoxLite 这类代码执行 sandbox
- sandbox -> host bridge

结果是 AI 难以判断：
- 什么时候直接调用 tool
- 什么时候进入 sandbox 写代码
- 一个 skill 到底是原子能力、工作流模板、还是安装包

## Design principles
- 简单单次 tool 调用默认走 direct path，不进入 sandbox。
- sandbox 只用于执行模型生成的 orchestration code。
- session 不等于 sandbox instance；sandbox 必须可丢弃、可重建。
- tool/capability 的语义，不能由安装位置或运行时目录推导。
- official/user 只是来源维度，不应决定执行语义。

## New model

### 1. Capability
系统中真正可执行的原子能力。

例子：
- host local tool
- local MCP tool
- remote MCP tool
- system plugin tool

特点：
- 有明确输入输出
- 有明确执行责任方
- 可直接被 AI 调用
- 不要求进入 sandbox

### 2. Recipe
面向 AI 或用户暴露的可复用任务模板/工作流封装。

例子：
- official skill wrapper
- user-authored skill
- expert workflow
- code interpreter wrapper

特点：
- 可以组合多个 capability
- 可以推荐 direct path 或 code mode path
- 不等于最终执行位置
- 不等于安装包目录本身

### 3. CodeMode Program
模型临时生成的一段代码，用来编排 capability。

特点：
- 一次性、短生命周期
- 运行在 executor 中
- 通过 bridge 回到 host capability world
- 不是 registry 中的常驻能力对象

### 4. Executor
只负责运行 CodeMode Program。

例子：
- HostExecutor
- WslBoxLiteExecutor
- future RemoteExecutor

特点：
- 不承载 capability registry 真相
- 不承载长期 session 语义
- 失败后可重建，不影响 capability identity

### 5. Bridge/Gateway
从 code runtime 回到 host capability world 的边界层。

职责：
- tool dispatch
- policy enforcement
- approval gate
- audit/logging
- bridge token / session isolation

## Invocation model
系统显式采用双通道：

### A. Direct Tool Path
适用于：
- 单个 tool 即可完成任务
- 不需要循环、条件、聚合、重试代码
- 审批型或高风险操作
- 对时延敏感的调用

行为：
- AI 直接调用 capability
- capability 在 host 或 remote provider 上执行
- 不经过 sandbox executor

### B. CodeMode Path
适用于：
- 多个 capability 之间需要程序逻辑
- 需要循环、条件、重试、聚合
- 需要模型写 glue code
- 需要受控隔离执行环境

行为：
- AI 调用 `execute_code_plan` 之类的 orchestration primitive
- program 在 executor 中运行
- program 通过 bridge 调回 capability
- capability 本身仍在 host/remote plane 执行

## User-configured MCP
用户自配置的 MCP 不能被当成“特例功能”，应被建模为用户挂载的 capability provider。

### 语义定位
- 本地 `mcp.json`、桌面导入配置、云端 BYOP MCP server，本质上都是 provider source。
- provider source 同步后产出的是 capability，而不是 recipe，也不是 executor。
- MCP server 是 capability 的来源，不是 code mode 的替代品。

### 设计要求
- source/provider 与 capability 分离建模。
- `search_sdk` 面向 AI 返回的是 capability 视图，而不是原始 source 视图。
- capability 应保留 provenance：official/community/private/user-managed。
- 对用户自配 MCP 的安全、可用性、禁用状态，在 provider/capability 层表达，不放到 sandbox 语义里。

## User-installed / user-authored skills
用户 skills 不能再被简单视为“又一种 tool”。

### 语义定位
用户 skill 更像 recipe bundle，可能包含：
- prompt / workflow guidance
- 一个或多个 capability 暴露
- 对 direct path 或 code mode path 的默认建议
- 安装与配置元数据

### 设计要求
- skill install record 只表达“安装了什么”，不表达最终执行真相。
- 一个 skill 可以：
  - 暴露 0..N 个 capability
  - 暴露 0..N 个 recipe entry
  - 推荐一个默认 orchestration mode
- official skill 和 user skill 共享同一语义模型，只是 provenance 不同。

## Four independent axes
重构后，每个 AI 可见对象至少按四个维度理解：
- semantic kind: capability | recipe | orchestration primitive
- execution path: direct | codemode
- execution plane: host | remote | bridged
- provenance: official | user-installed | user-configured | community | private

注意：这四个维度是独立的，不能再由单个 `skill.runtime` 或安装目录推导。

## Search/discovery implications
`search_sdk` 后续不应只回答“有什么”，还应回答“怎么用”。

最小目标：
- 优先返回 capability 与 recipe 的区分
- 明确推荐 direct 还是 codemode
- 明确是否需要 bridge
- 明确 provenance 与 risk hints

## Migration direction
### Phase 1: vocabulary first
统一术语：capability / recipe / orchestration primitive / executor / bridge / provider。

### Phase 2: routing first
落地“简单调用默认 direct，不进 sandbox”的路由原则。

### Phase 3: registry split
拆分 provider registry、capability registry、recipe/skill registry，避免安装记录承担执行语义。

### Phase 4: discovery upgrade
升级 `search_sdk`、skill search、tool docs，让 AI 能基于语义选择 direct 或 codemode。

## Immediate product decisions
- `execute_code_plan` 重新定位为 orchestration primitive，而不是普通 tool。
- sandbox 回归“代码执行器”角色，不再被视为统一能力宿主。
- official/user skills 统一建模为 recipe bundle。
- user-configured MCP 统一建模为 provider source -> capability materialization。

## Open questions
- 一个 recipe 是否允许同时暴露 direct entry 和 codemode entry？
- user skill 安装后，capability materialization 是否需要显式审核？
- UI 是否要分别展示“来源(source/provider)”与“可调用对象(capability/recipe)”？
- approval-required tools 是否必须禁止进入 codemode path？

