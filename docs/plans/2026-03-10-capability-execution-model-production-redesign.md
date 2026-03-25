# Deeting 能力系统生产化重构方案（Breaking Redesign）

Date: 2026-03-10

## Position
本方案不考虑兼容旧模型，直接按长期最优架构重构。目标不是“平滑过渡”，而是一次性把能力语义、执行路径、安装来源、权限治理彻底拆开，避免未来长期维护成本失控。

## Core thesis
当前最大的结构性问题不是字段不够，而是把以下对象混成了一个系统：
- capability（原子能力）
- recipe/skill（工作流封装）
- orchestration primitive（例如 code mode）
- executor（代码执行器）
- provider/source（能力来源）

生产化方案必须把它们拆成独立控制面对象。

## Non-negotiable principles
- 简单 tool 调用绝不进入 sandbox。
- sandbox 绝不作为统一工具宿主，只负责运行模型生成代码。
- `execute_code_plan` 不再被视为普通 tool，而是 orchestration primitive。
- provider/source、capability、recipe 必须分表、分 registry、分 API。
- official / user / community / private 只是 provenance，不决定执行语义。
- 安装信息不再推导执行语义；执行语义必须显式声明。

## New top-level architecture

### 1. Provider Registry
管理能力来源，而不是管理可调用对象。

Provider 类型：
- local_mcp_provider
- remote_mcp_provider
- system_provider
- builtin_provider
- user_repository_provider

职责：
- source 配置
- 凭据/secret 绑定
- 健康状态
- 同步/拉取
- 信任级别
- 禁用/隔离

### 2. Capability Registry
管理 AI 可直接调用的原子能力。

Capability 是唯一“直接执行对象”。
每个 capability 必须显式声明：
- identifier
- input/output schema
- execution_plane: host | remote
- approval_mode: auto | require_explicit
- provider_id
- provenance
- risk_level
- availability

规则：
- capability 必须 materialize 自 provider 或 builtin declaration
- capability 不允许从 skill 安装目录隐式推导
- `search_sdk` 的默认搜索结果应以 capability 为中心

### 3. Recipe Registry
管理可复用工作流与 skill bundle。

Recipe 是“任务模板/能力组合”，不是原子能力。
每个 recipe 必须显式声明：
- recipe_id
- recipe_kind: prompt_workflow | direct_wrapper | codemode_workflow | hybrid
- referenced_capabilities[]
- default_invocation: direct | codemode
- permission_profile
- provenance

规则：
- official skills 与 user skills 统一映射成 recipe
- 一个 recipe 可暴露多个 entry
- recipe 可推荐调用路径，但不能伪装成 capability

### 4. Orchestration Layer
只负责复杂任务编排。

对象：
- codemode program
- future planner/runtime program

规则：
- orchestration 只在复杂、多步、有逻辑的任务中启用
- orchestration 只能调用 capability，不能直接操作 provider
- orchestration 不能拥有长期状态真相

### 5. Executor Layer
只负责执行 program。

Executor 类型：
- host_executor
- wsl_boxlite_executor
- future container_executor

统一接口：
- execute(program, bridged_capabilities, limits) -> result

规则：
- executor 是可替换、可丢弃组件
- session != executor instance
- box/container id 不得进入业务语义层

## Invocation model
系统只保留两条路径：

### A. Direct Path
默认路径。
条件：
- 单 capability 可完成
- 无需循环、条件、重试、聚合代码
- 审批操作
- 高风险操作
- 低延迟需求

### B. CodeMode Path
高级路径。
条件：
- 需要多 capability 编排
- 需要程序逻辑
- 需要受限执行环境
- 模型写胶水代码的收益明显高于直接 tool call

## Hard decisions
以下是必须强制执行的 breaking changes：
- 删除“skill = tool”的默认语义。
- 删除从 runtime/entrypoint/目录结构自动推导 capability 类型的逻辑。
- 删除“所有 AI 工具动作都可落到 sandbox”的隐含假设。
- `search_sdk` 不再返回混合对象列表，必须区分 capability 与 recipe。
- UI 必须分别展示 Provider、Capability、Recipe 三类对象。
- 审批型能力禁止进入 codemode toolset。

## User-configured MCP
用户自配置 MCP 统一进入 Provider Registry。

规则：
- 本地 `mcp.json`、导入配置、云端 BYOP 都是 provider declaration
- provider sync 后生成 capability materialization
- 用户可禁用 provider，也可禁用 provider 下某些 capability
- AI 永远不直接看到“原始 provider 配置”，只看到 materialized capability

## User-authored Skills
用户 skills 不再作为“运行时插件”直接暴露，而是先注册为 recipe bundle。

规则：
- 安装 -> 校验 -> recipe registration -> capability exposure（可选）
- user skill 默认不是 executable capability
- 只有显式声明并通过审核的 entry 才能 materialize 成 capability
- 其余部分仅作为 recipe / workflow guidance 存在

## Search contract
新的 `search_sdk` / discovery contract：
- 默认返回 capability results
- 可选返回 recipe results
- 必须带上 recommended_path: direct | codemode
- 必须带上 semantic_kind: capability | recipe | orchestration_primitive
- 必须带上 provenance / risk / approval hints

## Security model
- provider 管 source trust
- capability 管 invocation permission
- recipe 管组合权限声明
- bridge 管运行时鉴权与审计
- executor 管资源限制与隔离

任何层都不得越权承担相邻层职责。

## Observability
必须新增独立事件流：
- provider_sync_started/completed/failed
- capability_materialized/enabled/disabled
- recipe_registered/updated/rejected
- orchestration_started/completed/failed
- bridge_call_started/completed/failed
- executor_instance_created/disposed/crashed

## Recommended repository refactor
建议直接拆成以下模块：
- `modules/providers`
- `modules/capabilities`
- `modules/recipes`
- `modules/orchestration`
- `modules/executors`
- `modules/bridge`
- `modules/policy`

现有 `mcp`, `skills`, `code_mode`, `sandbox` 只保留为迁移期参考，不应继续作为目标架构名词。

## Product-facing language
对 AI 和用户统一使用以下词：
- Capability：可直接调用的能力
- Recipe：可复用工作流/技能包
- Code Mode：复杂任务编排模式
- Provider：能力来源

禁止再把上述四者混称为“skill”。

## Final decision
Deeting 的长期生产架构应当是：
- Host 持有 provider/capability/recipe/policy 真相
- Code Mode 只负责复杂编排
- Sandbox 只负责执行 program
- User MCP 是 provider
- User skill 是 recipe bundle
- Direct call 是默认路径，sandbox 不是默认路径

