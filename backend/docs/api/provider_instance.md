# ProviderInstance 管理 API（BYOP 渠道）

- 前置条件：需要超级管理员权限（Bearer Token），路由前缀 `/api/v1`.
- 模型定义：`ProviderInstanceCreate`、`ProviderInstanceResponse`、`ProviderModelUpsert` 见 `backend/app/schemas/provider_instance.py`。
- 缓存：实例/模型列表有 Redis 短期缓存，写操作会自动失效。

## 创建实例

- `POST /admin/provider-instances`
- Body（JSON）：
  ```json
  {
    "preset_slug": "openai",
    "name": "My OpenAI",
    "base_url": "https://api.openai.com",
    "icon": null,
    "credentials_ref": "ENV_OPENAI_KEY",
    "priority": 0,
    "is_enabled": true
  }
  ```
- 响应：`ProviderInstanceResponse`
- 说明：`preset_slug` 必须是已存在且启用的模板 slug，否则返回 404 `preset not found`；`user_id` 自动填当前超管；`credentials_ref` 为密钥引用，不存明文。

示例：
```bash
curl -X POST https://host/api/v1/admin/provider-instances \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "preset_slug": "openai",
    "name": "openai-default",
    "base_url": "https://api.openai.com",
    "credentials_ref": "ENV_OPENAI_KEY"
  }'
```

## 列出实例

- `GET /admin/provider-instances`
- 响应：`ProviderInstanceResponse[]`，包含私有实例 + 公共实例。

## 同步/上报模型（幂等 upsert）

- `POST /admin/provider-instances/{instance_id}/models:sync`
- Body：
  ```json
  {
    "models": [
      {
        "capability": "chat",
        "model_id": "gpt-4o",
        "upstream_path": "/v1/chat/completions",
        "display_name": "GPT-4o",
        "template_engine": "simple_replace",
        "request_template": {},
        "response_transform": {},
        "pricing_config": {},
        "limit_config": {},
        "tokenizer_config": {},
        "routing_config": {},
        "source": "auto",
        "extra_meta": {},
        "weight": 100,
        "priority": 0,
        "is_active": true
      }
    ]
  }
  ```
- 响应：`ProviderModelResponse[]`
- 说明：按 `(capability, model_id, upstream_path)` 幂等更新；`synced_at` 由后端设置。

## 查询某实例的模型列表

- `GET /admin/provider-instances/{instance_id}/models`
- 响应：`ProviderModelResponse[]`

## 更新 / 删除实例（当前未提供）

- `PATCH/PUT /admin/provider-instances/{instance_id}`
- `DELETE /admin/provider-instances/{instance_id}`
- 状态：未实现。如需支持，请在后端补充 `ProviderInstanceService.update_instance/delete_instance` 及对应路由，并复用缓存失效事件 `on_provider_instance_changed`。

---

变更记录
- 2026-01-09：新增文档，补充已有创建/同步/查询接口，标注更新/删除尚未提供。
