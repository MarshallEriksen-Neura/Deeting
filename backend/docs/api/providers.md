# Providers Hub API

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。
- 模型定义：`ProviderHubResponse` / `ProviderCard` 见 `backend/app/schemas/provider_hub.py`。

## Provider Hub 列表

- `GET /providers/hub`
- Query：
  - `category`：分类过滤（cloud/local/custom/all）
  - `q`：搜索关键字（匹配模板名称/提供商/分类等）
  - `include_public`：是否包含公共实例
- 响应：`ProviderHubResponse`

### 搜索索引（Meilisearch）

- 索引名：`${MEILISEARCH_INDEX_PREFIX}_provider_presets`（默认 `ai_gateway_provider_presets`）
- 索引字段：
  - `id` / `slug` / `name` / `provider` / `category`
  - `icon` / `theme_color` / `is_active`
- 过滤与排序：
  - `category` 过滤使用 Meili `filter`（`category = "cloud api"`）
  - 排序保持原 API 行为（`sort_order`）
- 同步方式：
  - 增量：`search_index.upsert_provider_preset` / `search_index.delete_provider_preset`
  - 全量重建：`search_index.rebuild_all`

## Provider 详情

- `GET /providers/presets/{slug}`
- Query：`include_public`
- 响应：`ProviderCard`

---

变更记录
- 2026-02-02：新增 Providers Hub API 文档与 Meilisearch 索引说明。
