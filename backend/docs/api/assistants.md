# Assistants 管理 API

- 前置条件：需要 `assistant.manage` 权限（Bearer Token），路由前缀 `/api/v1`。
- 模型定义：见 `backend/app/schemas/assistant.py`。
- 图标：`icon_id` 为助手级别固定图标 ID（如 `lucide:bot`）。

## 创建助手

- `POST /admin/assistants`
- Body（JSON）：
  ```json
  {
    "visibility": "private",
    "status": "draft",
    "share_slug": null,
    "summary": "两行以内的简介文本",
    "icon_id": "lucide:bot",
    "version": {
      "version": "0.1.0",
      "name": "默认助手",
      "description": "通用对话助手",
      "system_prompt": "You are a helpful assistant.",
      "model_config": {},
      "skill_refs": [],
      "tags": [],
      "changelog": null
    }
  }
  ```
- 响应：`AssistantDTO`

## 列出助手（游标分页）

- `GET /admin/assistants?cursor=&size=20&status=&visibility=`
- 响应：`AssistantListResponse`

## 搜索公开助手（游标分页）

- `GET /admin/assistants/search?q=...&cursor=&size=20&tags=a&tags=b`
- 仅返回 `public + published` 的助手，后端优先使用 Postgres 全文索引。
- 响应：`AssistantListResponse`

## 更新助手

- `PATCH /admin/assistants/{assistant_id}`
- Body（JSON）：
  ```json
  {
    "visibility": "public",
    "status": "published",
    "share_slug": "default-assistant",
    "summary": "两行以内的简介文本",
    "current_version_id": "00000000-0000-0000-0000-000000000000",
    "icon_id": "lucide:sparkles"
  }
  ```
- 响应：`AssistantDTO`
  - `install_count` / `rating_avg` / `rating_count` 为系统维护字段（只读）

## 发布助手（可选切换版本）

- `POST /admin/assistants/{assistant_id}/publish`
- Body（JSON）：
  ```json
  {
    "version_id": "00000000-0000-0000-0000-000000000000"
  }
  ```
- 响应：`AssistantDTO`

---

变更记录
- 2026-01-15：新增 `icon_id` 字段（助手级别固定图标）。
