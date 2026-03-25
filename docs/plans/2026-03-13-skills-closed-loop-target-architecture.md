# Deeting Skills 闭环目标架构设计（No-Migration Target）

Date: 2026-03-13

## 1. 目标与边界

本方案是 **目标态架构**，不考虑历史兼容与迁移成本，直接定义长期最优形态。

本方案只讨论 Deeting 产品技能域：
- 官方技能：`packages/official-skills`
- 用户安装技能：`$APP_DATA_DIR/skills`

不纳入范围：
- `.agents/skills`（开发工具链工作流技能）

核心目标：
1. 技能域形成完整闭环：安装 -> 扫描 -> 同步 -> 运行 -> 反馈 -> 自愈。
2. `search_sdk` 继续统一发现入口，但资产域和执行域严格分离。
3. skill tools 与 user custom MCP tools 在资产层物理分仓、逻辑分轨。

---

## 2. 架构原则

1. **Unified Discovery, Split Assets**  
统一发现，不统一资产存储。

2. **Tool-callable by Binding, not by Name Guessing**  
运行调用只认 `binding_id`，禁止依赖 `skill__` 或 `pkg_name` 前缀推断。

3. **Skill Runtime as First-class Plane**  
技能执行平面是独立控制面，不附着在通用 MCP 资产表语义上。

4. **Recipes and Tools Are Different Objects**  
同一 skill 可同时产出：
- recipe（指导性，不可调用）
- tool bindings（可调用）

5. **Evidence-driven Lifecycle**  
每个状态跃迁必须有可追溯证据（hash、scan report、sync checkpoint、execution log）。

---

## 3. 领域模型（目标态）

## 3.1 Skill Package Domain

- `skill_source`
  - `source_id`
  - `source_kind` (`official`, `user_repo`, `local_dir`, `cloud_mirror`)
  - `locator` (repo url / local path / mirror id)
  - `trust_level`

- `skill_package`
  - `package_id`
  - `skill_id`（稳定业务标识）
  - `display_name`
  - `owner_scope` (`system`, `user`)

- `skill_revision`
  - `revision_id`
  - `package_id`
  - `content_hash`
  - `manifest_hash`
  - `doc_hash`
  - `runtime_entry_hash`
  - `created_at`

- `skill_install`
  - `install_id`
  - `skill_id`
  - `target_scope` (`desktop_local`)
  - `install_path`
  - `desired_revision_id`
  - `applied_revision_id`
  - `install_status`

## 3.2 Skill Scan / Build Domain

- `skill_scan_report`
  - `scan_id`
  - `revision_id`
  - `schema_extract_status`
  - `security_review_status`
  - `issues[]`
  - `artifacts[]`

- `skill_recipe_index`
  - `recipe_id`
  - `skill_id`
  - `docs_excerpt`
  - `docs_paths`
  - `activation_hints`

- `skill_tool_binding`
  - `binding_id`（运行唯一主键）
  - `skill_id`
  - `revision_id`
  - `tool_name`
  - `input_schema`
  - `output_schema`
  - `execution_strategy` (`builtin`, `sandbox`, `backend_task`, `remote`)
  - `risk_level`
  - `approval_mode`
  - `enabled`

## 3.3 Skill Runtime Domain

- `skill_runtime_session`
  - `runtime_session_id`
  - `skill_id`
  - `binding_id`
  - `user_id`
  - `trace_id`

- `skill_execution_record`
  - `execution_id`
  - `binding_id`
  - `request_payload`
  - `result_payload`
  - `latency_ms`
  - `status`
  - `error_code`

## 3.4 MCP Domain（独立）

独立维护 `mcp_source` / `mcp_tool` / `user_mcp_server` / `user_mcp_tool`，不与 skill 资产共表。

---

## 4. 组件架构

## 4.1 Skill Install Controller

职责：
- 处理安装请求（官方拉取、repo 安装、本地导入）
- 生成 `skill_install` 记录
- 触发扫描任务

输出：
- `install_requested`
- `install_completed` / `install_failed`

## 4.2 Skill Scan & Build Controller

职责：
- 解析 `SKILL.md` / manifest / tool schema / runtime entry
- 产出 `skill_recipe_index` 与 `skill_tool_binding`
- 写入 `skill_scan_report`

输出：
- `scan_completed`
- `binding_materialized`
- `scan_failed`

## 4.3 Skill Sync Controller

职责：
- 保持 `desired_revision_id == applied_revision_id`
- 检测漂移（文件缺失、hash 不一致、binding 失效）
- 触发修复（重装、重扫、重建 binding）

输出：
- `sync_tick_started`
- `sync_reconciled`
- `sync_degraded`
- `sync_healed`

## 4.4 Skill Runtime Dispatcher

职责：
- 接受 `binding_id` + args
- 权限检查 + 审批检查 + 参数校验
- 按 `execution_strategy` 调度执行
- 统一记录 `skill_execution_record`

输出：
- `execution_started`
- `execution_succeeded`
- `execution_failed`

## 4.5 Capability Federation (`search_sdk`)

职责：
- 聚合 Skills 域 + MCP 域 + Core primitives
- 分组返回，不混语义
- 给出推荐路径与调用标识

---

## 5. 闭环状态机

统一状态：

`discovered -> fetched -> installed -> scanned -> indexed -> activated -> runnable -> degraded -> healed`

状态说明：
- `installed`: 资源已落盘且 install 记录完成
- `scanned`: 扫描报告完成
- `indexed`: recipe/tool index 已写入
- `activated`: skill 或 binding 已启用
- `runnable`: 对应 binding 可执行
- `degraded`: 漂移、依赖、校验失败或运行异常
- `healed`: 自动修复完成并回到 `runnable`

硬性要求：
- 无 `scan_report` 不允许进入 `runnable`
- 无 `binding_id` 不允许进入可调用输出

---

## 6. `search_sdk` 目标契约

`search_sdk` 必须返回结构化分组（示意）：

```json
{
  "format_version": "v2",
  "query": "user intent",
  "capabilities": {
    "skill_tools": [
      {
        "name": "skill.weather.get_weather",
        "asset_namespace": "skill",
        "binding_id": "bind_xxx",
        "execution_lane": "skill_runtime",
        "status": {"callable": true, "approval_required": false}
      }
    ],
    "user_mcp_tools": [
      {
        "name": "mcp.user.tavily.search_web",
        "asset_namespace": "user_mcp",
        "tool_ref": "mcp_tool_xxx",
        "execution_lane": "remote_mcp",
        "status": {"callable": true}
      }
    ]
  },
  "recipes": {
    "skills": [
      {
        "skill_id": "official.skills.weather",
        "asset_namespace": "skill",
        "recommended_path": "install_or_activate",
        "docs_excerpt": "..."
      }
    ]
  },
  "orchestration_primitives": [
    {"name": "execute_code_plan"}
  ]
}
```

规则：
1. `skill_tools` 与 `user_mcp_tools` 必须分组。  
2. 可调用项必须带唯一执行引用（`binding_id` 或 `tool_ref`）。  
3. recipe 不可直接作为 tool 调用对象。  

---

## 7. 四条链路打通（闭环视角）

## 7.1 安装链路

1. install request
2. resolve source + download/materialize
3. create install record
4. enqueue scan job

成功判据：`install_status=installed` 且产生 `scan_id`。

## 7.2 扫描链路

1. parse docs/manifest/schema/runtime
2. build recipe index
3. build tool bindings
4. emit scan report

成功判据：至少一个 `recipe` 或 `binding` 被物化。

## 7.3 同步链路

1. compare desired/applied revision
2. drift detection
3. reconcile (re-fetch/re-scan/re-bind)
4. write sync checkpoint

成功判据：`desired_revision_id == applied_revision_id` 且 `runnable bindings` 健康。

## 7.4 运行链路

1. AI 发起 tool call（基于 `binding_id`）
2. dispatcher 校验与路由
3. runtime execute
4. result + telemetry + health feedback

成功判据：执行结果、审计日志、健康统计三者齐全。

---

## 8. 安全与治理

1. **Install-time Security**
- source allowlist / signature / hash validation
- manifest/schema sanity check

2. **Run-time Security**
- input schema validation
- policy gate（role/scope/approval）
- sandbox/network/fs limit

3. **Governance**
- per-binding enable/disable
- risk-level based approval policy
- tenant/user scoped visibility

---

## 9. 可观测性与 SLO

关键事件：
- `skill.install.*`
- `skill.scan.*`
- `skill.sync.*`
- `skill.binding.*`
- `skill.execution.*`

建议 SLO：
1. 安装成功率
2. 扫描成功率
3. 同步收敛时延
4. 运行成功率
5. 自愈闭环时延

---

## 10. 验收标准（架构完成定义）

满足以下条件才算“skills 闭环完成”：

1. 技能安装后，能够自动进入扫描与索引，不依赖人工二次触发。  
2. `search_sdk` 能同时发现 skills 与 user MCP，但分组清晰、资产不混。  
3. 所有 skill tool 调用都通过 `binding_id` 进入统一 dispatcher。  
4. 漂移能被检测并自动修复，且有完整事件链路。  
5. recipes（文档指导）与 tools（可执行）语义严格分离。  

---

## 11. 一句话总结

**把 Skills 作为独立资产域闭环管理，把 `search_sdk` 作为联邦发现层，把执行调用收敛到 binding-based dispatcher，即可在不混 MCP 资产的前提下完成安装/扫描/同步/运行全打通。**

---

## 12. 第二阶段：生态兼容优先

在第一阶段完成 Deeting 风格可执行技能包闭环后，第二阶段的优先级不是继续强化私有 manifest，而是尽可能兼容主流 Skills 生态，尤其是 OpenClaw / Agent Skills 目录形态。

### 12.1 兼容目标

目标覆盖以下四类 skill bundle：
- `SKILL.md only`
- `SKILL.md + scripts/`
- `SKILL.md + references/ + assets/`
- `SKILL.md + OpenClaw frontmatter metadata`

### 12.2 核心策略

1. **兼容扫描优先于兼容执行**
- 先做到“装得进、看得懂、知道缺什么”
- 再决定是否可执行、如何执行

2. **不强制第三方 skill 适配 Deeting 私有协议**
- `deeting.json + llm-tool.yaml + entry.backend` 只是可执行特例
- 没有这些文件的 skill 也应能被接纳、索引、检索、展示 eligibility

3. **显式可用性判断**
- skill 扫描阶段应产出 compatibility / eligibility 摘要
- 至少包括：
  - `execution_mode`: `deeting_binding | script_guidance | docs_only`
  - `requires.bin`
  - `requires.env`
  - `requires.config`
  - `missing_*`

4. **脚本兼容执行链**
- 对 `SKILL.md + scripts/` 型 skill，宿主可以生成 `script_runner` binding
- `script_runner` 与 `deeting_tool` binding 是两种不同执行语义
- `script_runner` 默认支持：
  - `args[]` 作为 CLI 参数
  - `input` 作为 JSON stdin
- `script_runner` 增强输入契约：
  - `__deeting_config`：用户在插件管理页配置的非敏感 config
  - `__deeting_context`：skill_id / tool_name / callable_name / binding_kind
- 只有显式物化为 binding 的脚本，才允许进入 `capabilities.skill_tools[]`

### 12.3 search_sdk 暴露原则

- `recipes.skills[]` 应携带 compatibility 摘要
- `capabilities.skill_tools[]` 只暴露明确可调用 binding
- `recipes.skills[]` 与 `capabilities.skill_tools[]` 都应直接暴露 machine-readable 运行状态：
  - `runnable_now`
  - `missing_env`
  - `missing_config`
  - `blocking_reason`
- 不允许把“有 scripts 的 skill”直接伪装成 callable tool

### 12.4 阶段完成定义

第二阶段完成时，第三方 GitHub skill 安装后至少要满足：
1. 能被系统识别为有效 skill root
2. 能被正确归类为 `docs_only / script_guidance / deeting_binding`
3. `search_sdk` 能返回其 compatibility / eligibility
4. 用户与模型都能知道它为什么暂时不可执行，或需要补什么依赖/配置
