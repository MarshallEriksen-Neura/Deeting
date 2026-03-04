# Settings API

## 获取云端 Embedding 设置

- `GET /settings/embedding`
- 响应：
  ```json
  {
    "model_name": "text-embedding-3-small"
  }
  ```
- 说明：登录后可访问；返回管理员统一配置的云端 embedding 模型。
- 未配置时响应：
  ```json
  {
    "model_name": null
  }
  ```
- 行为：当 `model_name=null` 时，依赖 Embedding 的写入/检索流程将失败并返回错误，不再回退到环境变量默认模型。

---

## 管理员查看云端 Embedding 设置

- `GET /admin/settings/embedding`
- 响应：
  ```json
  {
    "model_name": "text-embedding-3-small"
  }
  ```
- 说明：仅管理员可访问；未配置时同样返回 `{"model_name": null}`。

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
- 2026-02-24：移除环境变量 `EMBEDDING_MODEL` 回退；未配置时 `model_name=null`，需先通过管理端设置。
