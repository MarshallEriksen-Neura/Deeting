# 助手市场与安装 API（用户侧）

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。
- 分页：市场列表与安装列表使用 `fastapi_pagination` 的 CursorPage。
- 审核：提交后由超级用户秘书自动审核，通过后才会出现在市场；超级用户秘书模型未配置会返回 400。
- 同步：仅系统助手（`owner_user_id = null`）或审核通过的用户助手会异步同步到 Qdrant 专家索引（`expert_network`）；未通过审核不会同步。
- Desktop（Tauri）补充：市场读取前会执行 assistant sync feed 的云端 -> 本地同步。当前规则是：
  - 系统助手默认同步到桌面；
  - 审核通过的用户助手也会同步到桌面；
  - assistant 不再要求桌面端单独“安装”后才能在聊天 runtime 中可用。

## 架构边界（定稿）

- assistant 在云端承担 **专家模板 / capability template** 角色，而不是桌面聊天的固定人格。
- 桌面聊天的固定人格由本地设置中的 persona prompt 决定，不由 assistant market 决定。
- assistant market 的数据库真源是：
  - `assistant`
  - `assistant_version`
  - 以及面向桌面同步的 `system_asset` projection（`registry_entity=assistant`，`asset_kind=assistant_template`）
- Qdrant 中的 assistant collection 继续用于 expert capability / template 的语义检索，但桌面同步本身走数据库 projection feed。
- 因此 assistant 的云端闭环是：
  - 创建/更新 assistant
  - 审核通过
  - 写入数据库 projection
  - 同步到桌面
  - 可选再进入 assistant Qdrant 作为语义索引
- assistant 的桌面可用性不再依赖安装记录；安装语义已经从桌面 runtime 主链退出。

## 市场列表

- `GET /assistants/market`
- Query：
  - `cursor` / `size`：CursorPage 参数
  - `q`：搜索关键词
  - `tags`：标签过滤（`?tags=a&tags=b`）
- 响应：`CursorPage[AssistantMarketItem]`
- 说明：仅返回 `public + published` 且通过审核（或系统助手）的条目；包含 `installed`、`summary`、`tags`、`install_count`、`rating_avg` 等字段。`tags` 采用 `#Python` 形式。
  - 在当前桌面模型里，`installed` 对 assistant 已不再表示本地运行时前置条件，而更接近于历史兼容字段。

### 搜索索引（Meilisearch）

- 索引名：`${MEILISEARCH_INDEX_PREFIX}_assistants_market`（默认 `ai_gateway_assistants_market`）
- 索引字段：同 `assistants_public`（见 Assistants 管理 API）
- 过滤与游标：
  - 固定过滤：`visibility = "public"` 且 `status = "published"`
  - 市场可见性：系统助手（`owner_user_id = null`）或审核通过（`review_task.status = approved`）
  - `tags` 使用 Meili `filter`
  - 游标形态：`<rankingScore>|<created_at>|<assistant_id>`
- 同步方式：
  - 增量：`search_index.upsert_assistant` / `search_index.delete_assistant`
  - 全量重建：`search_index.rebuild_all`

## 我的安装列表

- `GET /assistants/installs`
- Query：`cursor` / `size`
- 响应：`CursorPage[AssistantInstallItem]`
- 说明：
  - 该接口仍保留给云端兼容层 / 历史数据使用。
  - 桌面端当前主模型已不再依赖 assistant install 作为 runtime 前置条件。

## 安装助手

- `POST /assistants/{assistant_id}/install`
- Body（可选）：
  ```json
  {
    "follow_latest": true,
    "pinned_version_id": null
  }
  ```
- 响应：`AssistantInstallItem`
- 说明：
  - 该接口仍保留给云端兼容层 / 历史用户配置使用。
  - 桌面端当前 assistant 同步与可用性不再依赖这条安装链路。

## 卸载助手

- `DELETE /assistants/{assistant_id}/install`
- 响应：`MessageResponse`

## 更新安装设置

- `PATCH /assistants/{assistant_id}/install`
- Body：
  ```json
  {
    "alias": "我的 Python 助手",
    "icon_override": "lucide:bot",
    "pinned_version_id": null,
    "follow_latest": true,
    "is_enabled": true,
    "sort_order": 10
  }
  ```
- 响应：`AssistantInstallItem`

## 创建自定义助手

- `POST /assistants`
- Body：`AssistantCreate`
  - 新增字段 `share_to_market`：是否提交审核并分享到市场
    - 为 `true` 时，后端会自动将 `visibility` 设为 `public`、`status` 设为 `published`，并后台触发“超级用户秘书”审核。
    - 该审核异步执行，创建接口仍返回助手信息。
- 响应：`AssistantDTO`

## 更新自定义助手

- `PATCH /assistants/{assistant_id}`
- Body：`AssistantUpdate`
  - 新增字段 `version`：用于创建新版本（发布版本不可变）。
    ```json
    {
      "summary": "更简短的简介",
      "icon_id": "lucide:bot",
      "version": {
        "name": "新版本名称",
        "description": "更新说明",
        "system_prompt": "新的系统提示词",
        "tags": ["Python", "Debug"]
      }
    }
    ```
- 响应：`AssistantDTO`

## 前端入口与闭环（创建/编辑/发布）

- 入口页面：`/assistants`（助手广场页）
  - “我的助手”列表支持创建与编辑（复用创建弹窗）。
  - 我创建的助手卡片会展示状态（`draft/published`、`pending/approved/rejected`）。
- 快捷入口：`/chat/create/assistant`（跳转到创建流程）。
- 发布/上架：
  - 创建时 `share_to_market=true` 即提交审核（异步执行，创建接口仍返回成功）。
  - 或者创建后调用 `POST /assistants/{assistant_id}/submit` 提交审核。
- 审核通过后会异步同步到 Qdrant 专家索引；未通过审核不会同步。

## 删除自定义助手

- `DELETE /assistants/{assistant_id}`
- 响应：`MessageResponse`
- 说明：若助手已被安装，将执行“归档”而非硬删除（对已安装用户不产生影响）；未被安装时才会真正删除。

## 列出我创建的助手

- `GET /assistants/owned?cursor=&size=20`
- 响应：`AssistantListResponse`

## 提交审核（上架市场）

- `POST /assistants/{assistant_id}/submit`
- Body：
  ```json
  {
    "payload": {}
  }
  ```
- 响应：`MessageResponse`
- 说明：需满足 `visibility=public` 且 `status=published`；提交后自动触发“超级用户秘书”审核。

## 评分

- `POST /assistants/{assistant_id}/rating`
- Body：
  ```json
  {
    "rating": 4.9
  }
  ```
- 响应：`AssistantRatingResponse`
- 说明：需要先安装助手。

## 助手体验（预览）

- `POST /assistants/{assistant_id}/preview`
- Body：
  ```json
  {
    "message": "你好，帮我总结一下这段内容",
    "stream": false,
    "temperature": 0.7,
    "max_tokens": 256
  }
  ```
- 响应：`ChatCompletionResponse`
- 说明：使用用户的秘书模型进行体验（通过 `/users/me/secretary` 配置）；system_prompt 直接取助手当前版本内容；不写入历史聊天记录；未配置秘书模型将返回 400。

## 获取标签列表

- `GET /assistants/tags`
- 响应：`AssistantTagDTO[]`

---

变更记录
- 2026-01-15：新增助手市场/安装/提交审核/评分/标签列表/体验预览 API；提交审核默认自动审核。
- 2026-01-17：创建助手支持 `share_to_market`，可在创建时自动提交审核。
- 2026-01-19：安装支持 `follow_latest`；更新助手支持创建新版本；删除已安装助手改为归档。
- 2026-01-27：安装列表过滤已归档助手。
- 2026-02-02：补充 Meilisearch 搜索索引说明。
- 2026-02-23：明确并落地专家索引同步门禁：仅系统助手或审核通过的用户助手可进入 `expert_network`；管理员审核通过/拒绝会触发索引增删同步。
