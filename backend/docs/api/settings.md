# Settings API

## 获取云端 Embedding 设置

- `GET /settings/embedding`
- 响应：
  ```json
  {
    "model_name": "text-embedding-3-small"
  }
  ```
- 说明：登录后可访问；返回管理员统一配置的云端 embedding 模型（未配置时回退系统默认值）。

---

## 管理员查看云端 Embedding 设置

- `GET /admin/settings/embedding`
- 响应：
  ```json
  {
    "model_name": "text-embedding-3-small"
  }
  ```
- 说明：仅管理员可访问。

---

## 管理员更新云端 Embedding 设置

- `PATCH /admin/settings/embedding`
- Body：
  ```json
  {
    "model_name": "text-embedding-3-large"
  }
  ```
- 响应：同上
- 说明：仅管理员可访问；`model_name` 必须为可用的 embedding 模型。

---

变更记录
- 2026-01-17：新增云端 embedding 设置接口。
