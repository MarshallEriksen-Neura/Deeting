# Plugin Market API（GitHub 提交与桌面本地安装）

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`
- 目标：明确当前闭环是 `GitHub 源码 -> 管理员审核 -> 市场展示 -> 桌面本地安装/执行`

## 架构边界（当前）

- 云端是 control plane：
  - `skill_registry` 作为技能主数据真源
  - `system_asset` 中 `registry_entity=skill`、`asset_kind=skill_bundle` 的记录作为桌面同步 projection
  - 市场列表、审核状态、repo ingestion 都由云端负责
- 桌面是 data plane：
  - `local_skill_install` 是本地安装真源
  - skill bundle 的下载、物化、运行时准备、执行都在桌面完成
- 结论：
  - 云端不再保存用户级 skill 安装状态
  - 云端不再提供 repo plugin 的安装/卸载/执行/UI session 产品能力

## 可用接口

### 市场插件列表

- `GET /plugin-market/plugins`
- Query:
  - `q`：按 `id/name/description` 搜索（可选）
  - `limit`：返回数量，默认 50，范围 1-100
- 响应：`PluginMarketSkillItem[]`
- 说明：
  - 仅返回 `skill_registry.status=active` 的市场技能
  - `installed` 字段仅作兼容保留；桌面端应以本地安装真源为准，不应再把云端返回值当作安装态事实

### 提交 GitHub 仓库

- `POST /plugin-market/plugins/submit`
- Body:
  ```json
  {
    "repo_url": "https://github.com/org/repo",
    "revision": "main",
    "skill_id": "optional.skill.id",
    "runtime_hint": "opensandbox"
  }
  ```
- 响应：`PluginSubmitResponse`
  ```json
  {
    "status": "queued",
    "task_id": "celery-task-id"
  }
  ```
- 说明：
  - 该接口会下发 `skill_registry.ingest_repo` 异步任务
  - ingestion 成功后，技能进入 `needs_review`，等待管理员审核
  - 提交后不会自动触发 dry-run / self-heal / sandbox 冒烟

## 已下线 / 兼容保留接口

以下接口已不再承载产品能力，仅用于兼容旧客户端或明确返回停用信息：

### 我的安装列表

- `GET /plugin-market/installs`
- 当前行为：返回空列表
- 原因：用户级安装状态已经迁移为桌面本地真源

### 安装插件

- `POST /plugin-market/plugins/{skill_id}/install`
- 当前行为：返回 `410 Gone`
- 提示语义：改为在桌面端执行本地安装

### 卸载插件

- `DELETE /plugin-market/plugins/{skill_id}/install`
- 当前行为：返回 `410 Gone`
- 提示语义：改为在桌面端执行本地卸载

### 签发插件 UI 会话 URL

- `POST /plugin-market/plugins/{skill_id}/ui/session`
- 当前行为：返回 `410 Gone`
- 原因：repo plugin 的 UI session 已改为桌面本地使用场景，不再由云端签发

### 读取插件 UI 资产

- `GET /plugin-market/ui/t/{token}/{asset_path}`
- 说明：
  - 该接口保留为历史 token 的解析端点
  - 新的云端 token 不再继续签发

## 运行时约束（当前）

- 检索层：
  - 云端搜索不再把 repo-based marketplace plugin 作为可执行技能暴露
  - builtin/system skill 仍按原有能力参与云端检索
- 执行层：
  - `SkillRuntimeExecutor` 对 `source_repo` 型 skill 默认拒绝云端执行
  - 唯一保留的例外是内部 `dry_run` / 审核类流程
- UI 层：
  - `SkillRunner` 若无法获取云端 `renderer_url`，保留原始 `view_type` 作为降级路径
  - 新的 repo plugin 云端 iframe 能力已关闭

## 当前推荐路径

- 市场浏览：云端 `/plugin-market/plugins`
- Repo 提交：云端 `/plugin-market/plugins/submit`
- 安装 / 卸载 / 运行：
  - 桌面端本地命令
  - 本地 SQLite `local_skill_install`
  - 本地 skill 目录与本地 runtime

## 变更记录

- 2026-03-16：
  - 下线云端用户安装状态
  - `GET /plugin-market/installs` 改为空列表
  - `POST/DELETE /plugins/{skill_id}/install` 改为 `410 Gone`
  - `POST /plugins/{skill_id}/ui/session` 改为 `410 Gone`
  - 桌面端安装真源统一收敛到本地
