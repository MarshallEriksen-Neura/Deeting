# Admin Agent API

> 路由前缀：`/api/v1`

## 聊天（管理员 Agent）

- **接口**：`POST /agent/chat`
- **鉴权**：必须携带 `Authorization: Bearer <token>`（依赖 `get_current_user`）
- **说明**：请求会绑定当前登录用户的真实 `user_id` 作为 Agent/Plugin 执行上下文；未登录或无有效用户身份时不会执行工具链。

### 请求体

```json
{
  "query": "帮我抓取并分析某个 provider 文档",
  "model_hint": "gpt-4-turbo",
  "history": [],
  "system_instruction": "可选，自定义系统提示词"
}
```

### 响应体

```json
{
  "response": "..."
}
```

### 错误

- `401 Unauthorized`：缺失或无效的 Bearer Token。
- `500 Internal Server Error`：执行链路异常（例如工具执行失败）。
