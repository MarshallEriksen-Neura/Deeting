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
- 响应：`UserSecretaryDTO`（含 `model_name`）
- 说明：若用户尚未创建秘书配置，将自动创建默认记录。

## 更新秘书配置

- `PATCH /users/me/secretary`
- Body：
  ```json
  {
    "model_name": "gpt-4o",
    "model_name": "gpt-4o"
  }
  ```
- 响应：`UserSecretaryDTO`
- 说明：`model_name` 用于秘书模型；允许选择当前用户可见的模型（含公共模型）。

---

变更记录
- 2026-01-15：新增用户秘书配置接口。
- 2026-01-17：简化秘书配置，仅保留 `model_name`（默认名称 `deeting`）。
