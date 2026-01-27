# Internal Gateway API

> 内部通道 API 文档 - 面向内部前端和服务

---

## 概述

内部网关 (Internal Gateway) 提供面向内部系统的 AI 服务接口，适用于：
- 内部前端应用
- 内部服务调用
- 开发调试

**基础路径**: `/internal/v1`  
兼容路径: `/api/v1/internal`

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
  "status_stream": true,
  "temperature": 0.7,
  "max_tokens": 1000,
  "request_id": "optional-request-id",
  "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23",
  "assistant_id": "optional-assistant-id",
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

多模态内容示例（图片引用）：
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "描述这张图片" },
    { "type": "image_url", "image_url": { "url": "asset://assets/demo/2026/01/15/hello.png" } }
  ]
}
```
说明：`asset://` 为对象存储 Key 的引用，网关会在上游调用前解析为短链签名 URL。
| `status_stream` | boolean | 否 | 是否通过 SSE 推送状态事件；为 `true` 时即使 `stream=false` 也会返回 SSE |
| `temperature` | float | 否 | 温度参数 (0-2) |
| `max_tokens` | integer | 否 | 最大生成 token 数 |
| `request_id` | string | 否 | 客户端请求 ID（用于取消/幂等） |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |
| `assistant_id` | string | 否 | 助手 ID（用于会话归属） |
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

当 `status_stream=true` 时，SSE 会额外包含状态事件（示例）：

```
data: {"type":"status","stage":"listen","step":"validation","state":"running","code":"context.loaded","meta":{"count":3,"has_summary":false}}

data: {"type":"status","stage":"remember","step":"routing","state":"success","code":"routing.selected","meta":{"candidates":2,"provider":"openai"}}
```

若 `stream=false` 且 `status_stream=true`，会在状态事件之后返回一次完整结果：

```
data: {"id":"chatcmpl-abc123","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"Hello!"}}],"session_id":"session-xyz"}

data: [DONE]
```

---

#### 取消对话流

**端点**: `POST /chat/completions/{request_id}/cancel`

用于中止正在进行的流式对话。仅对同一用户生效（最佳努力）。

响应示例：
```json
{
  "request_id": "req-20260123-abcdef",
  "status": "canceled"
}
```

---

### 2. Models

获取内部通道可用的模型列表（按 provider_instance 分组，包含公共实例 + 当前用户实例）。

**端点**: `GET /models`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `capability` | string | 否 | 能力过滤（如 `chat` / `image_generation` / `embedding` / `text_to_speech` / `speech_to_text` / `video_generation`） |

#### 响应体

```json
{
  "instances": [
    {
      "instance_id": "b8b8fdfd-8b6f-4f7d-8d3e-2b1c9c3c6e1a",
      "instance_name": "my-openai",
      "provider": "openai",
      "icon": "openai",
      "models": [
        {
          "id": "gpt-4o",
          "object": "model",
          "owned_by": "openai",
          "icon": "openai",
          "upstream_model_id": "gpt-4o",
          "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23"
        }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `instances` | array | provider_instance 分组列表 |
| `instances[].instance_id` | string | 实例 ID |
| `instances[].instance_name` | string | 实例名称 |
| `instances[].provider` | string | 提供商标识 |
| `instances[].icon` | string | 提供商图标（可选） |
| `instances[].models[].id` | string | 模型 ID（可能为统一别名） |
| `instances[].models[].owned_by` | string | 提供商标识 |
| `instances[].models[].icon` | string | 提供商图标（可选） |
| `instances[].models[].upstream_model_id` | string | 上游模型 ID |
| `instances[].models[].provider_model_id` | string | provider model 唯一 ID（用于指定路由） |

---

### 3. Conversation Window

获取会话列表（内部通道，滚动加载）。

**端点**: `GET /conversations`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### Query 参数

- `cursor`：游标（可空）
- `size`：单页数量（默认 20）
- `assistant_id`：助手 ID（仅返回该助手的会话）
- `status`：会话状态（默认 `active`，可选 `archived`/`closed`）

#### 响应体

```json
{
  "items": [
    {
      "session_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
      "title": "API 调试",
      "summary_text": "用户在排查请求失败原因……",
      "message_count": 18,
      "first_message_at": "2026-01-16T09:20:11+08:00",
      "last_active_at": "2026-01-16T09:42:01+08:00"
    }
  ],
  "next_page": "cursor:...",
  "previous_page": null
}
```

**端点**: `GET /conversations/{session_id}`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "turn_index": 1
    },
    {
      "role": "assistant",
      "content": "Hi!",
      "turn_index": 2,
      "meta_info": {
        "blocks": [
          { "type": "text", "content": "Hi!" }
        ]
      }
    }
  ],
  "meta": {
    "total_tokens": 128,
    "last_active_at": "2026-01-16T00:00:00Z"
  },
  "summary": {
    "content": "..."
  }
}
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

**消息字段补充说明**：

- `messages[].meta_info`：可选，结构化元数据（如 `blocks` / `tool_calls` / 多模态内容）。
- `messages[].meta_info.blocks`：结构化块列表，支持 `text` / `thought` / `tool_call` 等类型，前端可直接按 block 渲染。

---

### 4. Conversation History

历史消息分页加载（仅用于 UI 展示，不影响 Redis 滑动窗口上下文）。

**端点**: `GET /conversations/{session_id}/history`

#### Query 参数

- `cursor`：可选，向前翻页游标（turn_index），返回 `< cursor` 的更早消息。
- `limit`：可选，每页条数（默认 30，最大 200）。

#### 响应体

```json
{
  "session_id": "session-xyz",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "turn_index": 8
    },
    {
      "role": "assistant",
      "content": "Hi!",
      "turn_index": 9
    }
  ],
  "next_cursor": 8,
  "has_more": true
}
```

**说明**：

- `messages` 按 `turn_index` 升序返回，便于前端直接拼接到顶部。
- `next_cursor` 用于下一次滚动加载（作为 `cursor` 传入）。

---

### 5. Conversation Archive

归档 / 取消归档会话（内部通道）。

**端点**: `POST /conversations/{session_id}/archive`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "status": "archived"
}
```

**端点**: `POST /conversations/{session_id}/unarchive`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "status": "active"
}
```

---

### 6. Conversation Rename

更新会话标题（内部通道）。

**端点**: `PATCH /conversations/{session_id}/title`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 请求体

```json
{
  "title": "新的会话标题"
}
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "title": "新的会话标题"
}
```

---

### 2. Embeddings

创建文本嵌入向量。

**端点**: `POST /embeddings`

#### 请求体

```json
{
  "model": "text-embedding-ada-002",
  "input": "The food was delicious and the waiter...",
  "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 嵌入模型名称 |
| `input` | string/array | 是 | 输入文本或文本数组 |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |

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

获取可用模型列表（同上 `/models` 接口，需鉴权）。

**端点**: `GET /models`

#### 响应体

---

### 4. Debug: Test Routing

测试路由决策，不实际调用上游。

**端点**: `POST /debug/test-routing`

#### 请求体

```json
{
  "model": "gpt-4",
  "capability": "chat",
  "request_id": "debug-req-001",
  "provider_model_id": "3a5e9c7f-2f18-4d3c-9e87-15b1c6b3f2a1"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `capability` | string | 否 | 能力类型，默认 `chat`（支持 `image_generation` / `text_to_speech` / `speech_to_text` / `video_generation` 等） |
| `request_id` | string | 否 | 客户端请求 ID（用于取消/幂等） |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |

#### 响应体

```json
{
  "model": "gpt-4",
  "capability": "chat",
  "provider": "openai",
  "preset_id": 1,
  "preset_item_id": 2,
  "instance_id": "b8b8fdfd-8b6f-4f7d-8d3e-2b1c9c3c6e1a",
  "provider_model_id": "3a5e9c7f-2f18-4d3c-9e87-15b1c6b3f2a1",
  "upstream_url": "https://api.openai.com",
  "template_engine": "simple_replace",
  "routing_config": {},
  "limit_config": {},
  "pricing_config": {},
  "affinity_hit": false
}
```

#### 错误响应

当无可用上游或路由失败时，返回 `GatewayError`。

---

### 5. Debug: Step Registry

查看已注册的编排步骤。

**端点**: `GET /debug/step-registry`

#### 响应体

```json
{
  "steps": [
    "validation",
    "routing",
    "upstream_call"
  ]
}
```

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
| `capability` | string | 能力过滤（如 `chat` / `image_generation` / `text_to_speech` / `speech_to_text` / `video_generation`） |
| `model` | string | 模型过滤 |

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
