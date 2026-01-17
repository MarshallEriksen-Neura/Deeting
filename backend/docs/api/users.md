# 用户自助 API

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。

## 获取当前用户信息

- `GET /users/me`
- 响应：`UserWithPermissions`

## 更新用户信息

- `PATCH /users/me`
- Body：`UserUpdate`
- 响应：`UserRead`

## 获取秘书配置

- `GET /users/me/secretary`
- 响应：`UserSecretaryDTO`（含 `embedding_model`）
- 说明：若用户尚未创建秘书配置，将自动创建默认记录。

## 更新秘书配置

- `PATCH /users/me/secretary`
- Body：
  ```json
  {
    "model_name": "gpt-4o",
    "embedding_model": "text-embedding-3-small"
  }
  ```
- 响应：`UserSecretaryDTO`
- 说明：`model_name` 用于聊天模型，`embedding_model` 用于向量模型；仅允许选择**当前用户自有 Provider**下可用的对应能力模型。

---

变更记录
- 2026-01-15：新增用户秘书配置接口。
