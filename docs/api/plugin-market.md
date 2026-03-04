# Plugin Market API（GitHub 提交与用户安装）

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。
- 目标：实现 `GitHub 源码 -> 用户安装 -> Agent 调用` 的最小闭环。

## 市场插件列表

- `GET /plugin-market/plugins`
- Query：
  - `q`：按 `id/name/description` 搜索（可选）
  - `limit`：返回数量，默认 50，范围 1-100
- 响应：`PluginMarketSkillItem[]`
- 说明：
  - 仅返回 `skill_registry.status=active` 且 `source_repo` 非空的仓库插件。
  - `installed` 标识当前用户是否已安装并启用。

## 我的安装列表

- `GET /plugin-market/installs`
- 响应：`PluginInstallationItem[]`

## 提交 GitHub 仓库

- `POST /plugin-market/plugins/submit`
- Body：
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
  - 该接口会下发 `skill_registry.ingest_repo` 异步任务。
  - 网关会透传当前 `user_id` 到任务，便于后续通知与审计。

## 安装插件

- `POST /plugin-market/plugins/{skill_id}/install`
- Body：
  ```json
  {
    "alias": "optional alias",
    "config_json": {}
  }
  ```
- 响应：`PluginInstallationItem`
- 状态码：
  - `201`：首次安装
  - `200`：已安装记录被重新启用/更新

## 卸载插件

- `DELETE /plugin-market/plugins/{skill_id}/install`
- 响应：`MessageResponse`
- 错误：
  - `404 installation not found`

## 签发插件 UI 会话 URL

- `POST /plugin-market/plugins/{skill_id}/ui/session`
- Body：
  ```json
  {
    "ttl_seconds": 300
  }
  ```
- 响应：`PluginUiSessionResponse`
  ```json
  {
    "skill_id": "com.example.stock",
    "revision": "main",
    "renderer_asset_path": "index.html",
    "renderer_url": "https://deeting.app/api/v1/plugin-market/ui/t/<token>/index.html",
    "expires_at": 1740000000
  }
  ```
- 说明：
  - 仅已安装且启用该插件的用户可签发。
  - URL 内嵌短时签名 token（默认 300 秒，范围 30-1800 秒）。

## 读取插件 UI 资产（签名 token）

- `GET /plugin-market/ui/t/{token}/{asset_path}`
- 示例：
  - `GET /plugin-market/ui/t/<token>/index.html`
  - `GET /plugin-market/ui/t/<token>/app.js`
- 说明：
  - 该接口不依赖 Bearer Header，靠 token 验签与过期时间控制访问。
  - 访问路径做目录穿越防护，仅允许读取该插件版本 bundle 目录内文件。

## 运行时约束（实现说明）

- 检索层：JIT 对 `skill__*` 结果增加用户安装过滤。
  - `source_repo` 为空（系统技能）保持可检索。
  - `source_repo` 非空（仓库插件）必须在 `user_skill_installation` 启用后才可检索。
- 执行层：`SkillRuntimeExecutor` 对仓库插件执行前校验安装关系，防止绕过检索层直接调用。
- 插件入口契约：
  - 若仓库存在 `deeting.json`，运行时按 `entry.backend`（默认 `main.py`）加载，并调用：
    - `async def invoke(tool_name, args, deeting)`
  - 运行时统一注入 `DeetingRuntime`（`deeting.call_tool / deeting.render`）。
  - 若仓库不存在 `deeting.json`，回退到 `usage_spec.example_code`（legacy）。
- UI 资产提纯：
  - ingest 时若检测到 `deeting.json.entry.renderer`，会把其所在目录提取到持久化目录：
    - `.../plugins/ui-bundles/{skill_id}/{revision}/`
  - 若该目录已存在且存在完成标记文件，会跳过重复拷贝（幂等）。
- UI 协议增强（Skill Runner）：
  - 当仓库插件运行时返回 `render_blocks`，后端会自动尝试签发 `renderer_url`。
  - 成功时，返回给前端的 block 会标准化为 `view_type=plugin.iframe`，并在 `metadata.renderer_url` 写入签名地址。
  - 若签发失败，保留原始 `view_type` 作为降级路径（不阻断工具执行）。

---

变更记录
- 2026-02-24：新增 Plugin Market 提交/安装/卸载与安装态过滤。
- 2026-02-24：新增插件 UI bundle 提纯、UI session 签发与 token 资产读取接口。
