# Internal Gateway API

> 内部通道 API 文档 - 面向内部前端和服务

---

## 概述

内部网关 (Internal Gateway) 提供面向内部系统的 AI 服务接口，适用于：
- 内部前端应用
- 内部服务调用
- 开发调试

**基础路径**: `/internal/v1`

**特点**:
- JWT Token 认证（无需签名）
- 跳过配额检查和计费
- 保留完整响应（无脱敏）
- 提供调试接口

---

## 认证

内部通道使用 **JWT Bearer Token** 认证：

```http
Authorization: Bearer <access_token>
```

### 获取 Token

参考 [认证文档](./authentication.md)：

```bash
# 登录获取 token
curl -X POST "https://gateway.example.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "your-password"}'
```

响应：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

## API 端点

### 1. Chat Completions

创建对话补全请求。

**端点**: `POST /chat/completions`

#### 请求头

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

#### 请求体

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1000,
  "session_id": "optional-session-id"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `messages` | array | 是 | 消息列表 |
| `messages[].role` | string | 是 | 角色：`system`/`user`/`assistant` |
| `messages[].content` | string/array | 是 | 消息内容 |
| `stream` | boolean | 否 | 是否流式返回，默认 `false` |
| `temperature` | float | 否 | 温度参数 (0-2) |
| `max_tokens` | integer | 否 | 最大生成 token 数 |
| `session_id` | string | 否 | 会话 ID（用于上下文管理） |

#### 响应体（非流式）

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  },
  "session_id": "session-xyz"
}
```

#### 响应体（流式）

当 `stream=true` 时，返回 SSE (Server-Sent Events) 格式：

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"content":"!"}}]}

data: [DONE]
```

#### 请求示例

```python
import httpx

response = httpx.post(
    "https://gateway.example.com/internal/v1/chat/completions",
    json={
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Hello!"}]
    },
    headers={"Authorization": f"Bearer {access_token}"}
)
print(response.json())
```

---

### 2. Embeddings

创建文本嵌入向量。

**端点**: `POST /embeddings`

#### 请求体

```json
{
  "model": "text-embedding-ada-002",
  "input": "The food was delicious and the waiter..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 嵌入模型名称 |
| `input` | string/array | 是 | 输入文本或文本数组 |

#### 响应体

```json
{
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0096, 0.0015, ...]
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

---

### 3. List Models

获取可用模型列表。

**端点**: `GET /models`

#### 响应体

```json
{
  "data": [
    {"id": "gpt-4", "object": "model", "owned_by": "gateway"},
    {"id": "gpt-3.5-turbo", "object": "model", "owned_by": "gateway"},
    {"id": "claude-3-opus", "object": "model", "owned_by": "gateway"}
  ]
}
```

> **注意**: 内部通道显示所有已配置的模型，不受权限过滤。

---

### 4. Bandit Report (内部专属)

获取路由 Bandit 算法的观测报表。

**端点**: `GET /bandit/report`

#### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `capability` | string | 能力过滤（如 `chat`） |
| `model` | string | 模型过滤 |
| `channel` | string | 通道过滤（`internal`/`external`） |

#### 响应体

```json
{
  "summary": {
    "total_arms": 5,
    "total_trials": 10000,
    "overall_success_rate": 0.95
  },
  "items": [
    {
      "arm_id": "provider-openai-gpt4",
      "capability": "chat",
      "model": "gpt-4",
      "channel": "external",
      "total_trials": 5000,
      "successes": 4800,
      "success_rate": 0.96,
      "avg_latency_ms": 1200,
      "last_selected_at": "2026-01-06T10:30:00Z"
    }
  ]
}
```

---

## Bridge API (内部专属)

Bridge API 用于与云端 Tunnel Gateway 交互，管理 Agent 和工具调用。

**基础路径**: `/internal/v1/bridge`

### 1. 列出 Agents

**端点**: `GET /bridge/agents`

```json
{
  "agents": [
    {"id": "agent-001", "name": "Code Assistant", "status": "online"},
    {"id": "agent-002", "name": "Data Analyst", "status": "offline"}
  ]
}
```

### 2. 列出 Agent 工具

**端点**: `GET /bridge/agents/{agent_id}/tools`

```json
{
  "tools": [
    {"name": "execute_code", "description": "Execute Python code"},
    {"name": "query_database", "description": "Query SQL database"}
  ]
}
```

### 3. 签发 Agent Token

**端点**: `POST /bridge/agent-token`

#### 请求体

```json
{
  "agent_id": "agent-001",
  "reset": false
}
```

#### 响应体

```json
{
  "agent_id": "agent-001",
  "token": "bat_xxxxxxxxxxxxxxxxxx",
  "expires_at": "2026-01-07T10:30:00Z",
  "version": 3,
  "reset": false
}
```

### 4. 调用工具

**端点**: `POST /bridge/invoke`

#### 请求体

```json
{
  "req_id": "req-12345",
  "agent_id": "agent-001",
  "tool_name": "execute_code",
  "arguments": {
    "code": "print('Hello, World!')"
  },
  "timeout_ms": 60000,
  "stream": true
}
```

### 5. 取消调用

**端点**: `POST /bridge/cancel`

#### 请求体

```json
{
  "req_id": "req-12345",
  "agent_id": "agent-001",
  "reason": "user_cancel"
}
```

### 6. 事件流

**端点**: `GET /bridge/events`

返回 SSE 事件流，用于实时监听 Agent 状态和工具执行结果。

---

## 错误响应

### 错误格式

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable error message",
  "source": "gateway|upstream|client",
  "trace_id": "req-abc123",
  "upstream_status": 500,
  "upstream_code": "model_overloaded"
}
```

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| `400` | Bad Request - 请求格式错误 |
| `401` | Unauthorized - Token 无效或过期 |
| `403` | Forbidden - 权限不足 |
| `502` | Bad Gateway - 上游服务错误 |
| `503` | Service Unavailable - 服务不可用 |
| `504` | Gateway Timeout - 上游超时 |

---

## 与外部通道的区别

| 特性 | 内部通道 | 外部通道 |
|------|----------|----------|
| 认证方式 | JWT Token | HMAC 签名 |
| 配额检查 | 跳过 | 启用 |
| 限流 | 宽松 (600 RPM) | 严格 (60 RPM) |
| 计费 | 仅记录用量 | 实际扣费 |
| 响应脱敏 | 不脱敏 | 脱敏处理 |
| 调试接口 | 可用 | 不可用 |
| 适用场景 | 内部系统 | 第三方客户 |

---

## 最佳实践

### 1. Token 刷新

```python
import httpx
from datetime import datetime, timedelta

class GatewayClient:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        self.expires_at = None

    async def ensure_token(self):
        if self.expires_at and datetime.utcnow() < self.expires_at - timedelta(minutes=5):
            return

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/v1/auth/refresh",
                json={"refresh_token": self.refresh_token}
            )
            data = response.json()
            self.access_token = data["access_token"]
            self.refresh_token = data["refresh_token"]
            self.expires_at = datetime.utcnow() + timedelta(seconds=data["expires_in"])

    async def chat(self, messages):
        await self.ensure_token()
        async with httpx.AsyncClient() as client:
            return await client.post(
                f"{base_url}/internal/v1/chat/completions",
                json={"model": "gpt-4", "messages": messages},
                headers={"Authorization": f"Bearer {self.access_token}"}
            )
```

### 2. 流式处理

```python
async def stream_chat(messages: list):
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{base_url}/internal/v1/chat/completions",
            json={"model": "gpt-4", "messages": messages, "stream": True},
            headers={"Authorization": f"Bearer {access_token}"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    content = chunk["choices"][0]["delta"].get("content", "")
                    print(content, end="", flush=True)
```

### 3. 错误处理

```python
async def call_with_retry(messages: list, max_retries: int = 3):
    for attempt in range(max_retries):
        try:
            response = await chat(messages)
            if response.status_code == 401:
                # Token 过期，刷新后重试
                await refresh_tokens()
                continue
            if response.status_code == 503:
                # 服务不可用，指数退避
                await asyncio.sleep(2 ** attempt)
                continue
            return response.json()
        except httpx.TimeoutException:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(1)
    raise Exception("Max retries exceeded")
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
