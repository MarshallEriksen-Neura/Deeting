# External Gateway API

> 外部通道 API 文档 - 面向第三方客户端

---

## 概述

外部网关 (External Gateway) 提供对外开放的 AI 服务接口，适用于：
- 第三方应用集成
- 企业客户 API 调用
- SaaS 租户服务

**基础路径**: `/external/v1`

**特点**:
- 完整的签名验证
- 配额和限流控制
- 计费扣费
- 响应脱敏

---

## 认证

外部通道使用 **HMAC-SHA256 签名认证**，所有请求必须包含以下请求头：

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `X-API-Key` | 是 | API 密钥（联系管理员获取） |
| `X-Api-Secret` | 否 | 签名专用密钥（推荐使用，更安全） |
| `X-Timestamp` | 是 | Unix 时间戳（秒），有效窗口 ±5 分钟 |
| `X-Nonce` | 是 | 请求唯一标识（UUID 格式，防重放） |
| `X-Signature` | 是 | HMAC-SHA256 签名 |

### 签名算法

```python
import hashlib
import hmac
import json
import time
import uuid

def generate_signature(api_key: str, secret: str, body: dict) -> dict:
    """生成请求签名"""
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex

    # 计算请求体哈希
    body_json = json.dumps(body, separators=(',', ':'), sort_keys=True)
    body_hash = hashlib.sha256(body_json.encode()).hexdigest()

    # 构造签名消息
    message = f"{api_key}{timestamp}{nonce}{body_hash}"

    # 计算 HMAC-SHA256 签名
    signature = hmac.new(
        secret.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()

    return {
        "X-API-Key": api_key,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
    }
```

### 请求示例 (Python)

```python
import httpx

api_key = "your-api-key"
api_secret = "your-api-secret"  # 推荐使用独立签名密钥
base_url = "https://gateway.example.com/external/v1"

body = {
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
}

headers = generate_signature(api_key, api_secret, body)
headers["Content-Type"] = "application/json"

response = httpx.post(
    f"{base_url}/chat/completions",
    json=body,
    headers=headers,
)
print(response.json())
```

### 请求示例 (cURL)

```bash
# 生成签名参数（需要实现签名逻辑）
API_KEY="your-api-key"
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen | tr -d '-')
SIGNATURE="computed-signature"

curl -X POST "https://gateway.example.com/external/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Nonce: ${NONCE}" \
  -H "X-Signature: ${SIGNATURE}" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

---

## 响应头

所有响应包含以下头信息：

| 响应头 | 说明 |
|--------|------|
| `X-Request-Id` | 请求追踪 ID（用于问题排查） |
| `X-RateLimit-Remaining` | 当前窗口剩余请求数 |
| `X-RateLimit-Reset` | 限流重置时间（Unix 时间戳） |

---

## API 端点

### 1. Chat Completions

创建对话补全请求。

**端点**: `POST /chat/completions`

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
    {"id": "text-embedding-ada-002", "object": "model", "owned_by": "gateway"}
  ]
}
```

> **注意**: 返回的模型列表根据 API Key 权限过滤，仅显示有权访问的模型。

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

| 字段 | 说明 |
|------|------|
| `code` | 统一错误码 |
| `message` | 错误描述 |
| `source` | 错误来源：`gateway`（网关）/ `upstream`（上游）/ `client`（客户端） |
| `trace_id` | 追踪 ID（用于排查问题） |
| `upstream_status` | 上游 HTTP 状态码（仅上游错误时） |
| `upstream_code` | 上游错误码（仅上游错误时） |

### HTTP 状态码

| 状态码 | 说明 | 常见原因 |
|--------|------|----------|
| `400` | Bad Request | 请求格式错误、参数缺失 |
| `401` | Unauthorized | 签名无效、API Key 无效 |
| `402` | Payment Required | 余额不足 |
| `403` | Forbidden | 权限不足、配额耗尽、IP 不在白名单 |
| `429` | Too Many Requests | 请求频率超限 |
| `502` | Bad Gateway | 上游服务错误 |
| `503` | Service Unavailable | 服务暂时不可用（熔断） |
| `504` | Gateway Timeout | 上游服务超时 |

### 错误码列表

| 错误码 | HTTP 状态码 | 说明 |
|--------|-------------|------|
| `INVALID_SIGNATURE` | 401 | 签名验证失败 |
| `INVALID_API_KEY` | 401 | API Key 无效或不存在 |
| `API_KEY_EXPIRED` | 401 | API Key 已过期 |
| `API_KEY_REVOKED` | 401 | API Key 已被吊销 |
| `NONCE_REUSED` | 401 | Nonce 重复使用（防重放） |
| `TIMESTAMP_EXPIRED` | 401 | 时间戳超出有效窗口 |
| `INSUFFICIENT_BALANCE` | 402 | 账户余额不足 |
| `QUOTA_DAILY_EXCEEDED` | 403 | 日配额已用尽 |
| `QUOTA_MONTHLY_EXCEEDED` | 403 | 月配额已用尽 |
| `QUOTA_TOKEN_EXCEEDED` | 403 | Token 配额已用尽 |
| `IP_NOT_WHITELISTED` | 403 | IP 不在白名单 |
| `SCOPE_DENIED` | 403 | 无权访问该模型/能力 |
| `RATE_LIMIT_RPM` | 429 | 每分钟请求数超限 |
| `RATE_LIMIT_TPM` | 429 | 每分钟 Token 数超限 |
| `RATE_LIMIT_CONCURRENT` | 429 | 并发数超限 |
| `UPSTREAM_TIMEOUT` | 504 | 上游服务超时 |
| `UPSTREAM_ERROR` | 502 | 上游服务错误 |
| `CIRCUIT_OPEN` | 503 | 熔断器开启，服务暂停 |
| `NO_AVAILABLE_UPSTREAM` | 503 | 无可用上游服务 |

---

## 限流策略

外部通道实施多级限流：

| 级别 | 默认限制 | 说明 |
|------|----------|------|
| 租户级 RPM | 60 | 每分钟请求数 |
| 租户级 TPM | 100,000 | 每分钟 Token 数 |
| API Key 级 | 自定义 | 可在 API Key 配置中覆盖 |

### 限流响应

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704067260
Retry-After: 45

{
  "code": "RATE_LIMIT_RPM",
  "message": "Rate limit exceeded. Please retry after 45 seconds.",
  "trace_id": "req-abc123"
}
```

---

## 配额管理

外部通道支持多维度配额：

| 配额类型 | 说明 |
|----------|------|
| `token` | Token 使用量配额 |
| `request` | 请求次数配额 |
| `cost` | 费用配额（USD） |

### 重置周期

- `daily`: 每日 UTC 00:00 重置
- `monthly`: 每月 1 日 UTC 00:00 重置
- `never`: 永不重置（总量控制）

---

## 最佳实践

### 1. 签名安全

- **使用独立签名密钥**: 推荐通过 `X-Api-Secret` 传递独立的签名密钥
- **保护密钥**: 不要在客户端代码中硬编码密钥
- **定期轮换**: 建议每 90 天轮换 API Key

### 2. 错误处理

```python
def call_gateway_with_retry(body: dict, max_retries: int = 3):
    for attempt in range(max_retries):
        response = make_request(body)

        if response.status_code == 429:
            # 限流：等待后重试
            retry_after = int(response.headers.get("Retry-After", 60))
            time.sleep(retry_after)
            continue

        if response.status_code == 503:
            # 熔断：指数退避
            time.sleep(2 ** attempt)
            continue

        return response

    raise Exception("Max retries exceeded")
```

### 3. 流式处理

```python
async def stream_chat(body: dict):
    body["stream"] = True
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            json=body,
            headers=headers,
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    yield json.loads(data)
```

### 4. 会话管理

```python
# 首次请求（不传 session_id）
response = call_chat(messages=[...])
session_id = response["session_id"]

# 后续请求（传递 session_id 保持上下文）
response = call_chat(
    messages=[{"role": "user", "content": "继续上面的话题"}],
    session_id=session_id
)
```

---

## SDK 支持

| 语言 | 状态 | 安装 |
|------|------|------|
| Python | 计划中 | `pip install higress-gateway-sdk` |
| Node.js | 计划中 | `npm install @higress/gateway-sdk` |
| Go | 计划中 | `go get github.com/higress/gateway-sdk-go` |

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
