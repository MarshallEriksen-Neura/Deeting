# 助手市场与安装 API（用户侧）

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。
- 分页：市场列表与安装列表使用 `fastapi_pagination` 的 CursorPage。
- 审核：用户提交后进入审核流，管理员通过后才会出现在市场。

## 市场列表

- `GET /assistants/market`
- Query：
  - `cursor` / `size`：CursorPage 参数
  - `q`：搜索关键词
  - `tags`：标签过滤（`?tags=a&tags=b`）
- 响应：`CursorPage[AssistantMarketItem]`
- 说明：仅返回 `public + published` 且通过审核（或系统助手）的条目；包含 `installed`、`summary`、`tags`、`install_count`、`rating_avg` 等字段。`tags` 采用 `#Python` 形式。

## 我的安装列表

- `GET /assistants/installs`
- Query：`cursor` / `size`
- 响应：`CursorPage[AssistantInstallItem]`

## 安装助手

- `POST /assistants/{assistant_id}/install`
- 响应：`AssistantInstallItem`
- 说明：仅允许安装市场可见助手或自己创建的助手。

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
- 响应：`AssistantDTO`

## 更新自定义助手

- `PATCH /assistants/{assistant_id}`
- Body：`AssistantUpdate`
- 响应：`AssistantDTO`

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
- 说明：需满足 `visibility=public` 且 `status=published`。

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
- 2026-01-15：新增助手市场/安装/提交审核/评分/标签列表/体验预览 API。
