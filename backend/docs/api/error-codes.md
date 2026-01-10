# 错误码参考

> Gateway 统一错误码文档

---

## 错误响应格式

所有 API 错误响应遵循统一格式：

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

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 统一错误码（大写下划线格式） |
| `message` | string | 人类可读的错误描述 |
| `source` | string | 错误来源 |
| `trace_id` | string | 请求追踪 ID（用于排查问题） |
| `upstream_status` | integer | 上游 HTTP 状态码（仅上游错误） |
| `upstream_code` | string | 上游返回的错误码（仅上游错误） |

### 错误来源 (source)

| 值 | 说明 |
|-----|------|
| `gateway` | 网关自身产生的错误（鉴权、限流、配额等） |
| `upstream` | 上游服务返回的错误（AI 提供商） |
| `client` | 客户端请求错误（格式错误、参数缺失） |

---

## 错误码分类

### 1. 认证错误 (401 Unauthorized)

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `INVALID_SIGNATURE` | 签名验证失败 | 检查签名算法实现，确保 secret 正确 |
| `INVALID_API_KEY` | API Key 无效或不存在 | 确认 API Key 正确，联系管理员核实 |
| `API_KEY_EXPIRED` | API Key 已过期 | 申请新的 API Key 或联系管理员续期 |
| `API_KEY_REVOKED` | API Key 已被吊销 | 联系管理员了解吊销原因并申请新 Key |
| `NONCE_REUSED` | Nonce 重复使用 | 每次请求使用唯一的 Nonce（UUID） |
| `TIMESTAMP_EXPIRED` | 时间戳超出有效窗口 | 确保系统时间准确，时间戳在 ±5 分钟内 |
| `TOKEN_INVALID` | JWT Token 无效 | 重新登录获取新 Token |
| `TOKEN_EXPIRED` | JWT Token 已过期 | 使用 refresh_token 刷新 |
| `SIGNATURE_FROZEN` | 签名连续失败，Key 已冻结 | 联系管理员解冻 |

### 2. 支付错误 (402 Payment Required)

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `INSUFFICIENT_BALANCE` | 账户余额不足 | 充值账户余额 |
| `BILLING_ERROR` | 计费系统错误 | 稍后重试，如持续出现请联系支持 |

### 3. 权限错误 (403 Forbidden)

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `QUOTA_NO_TENANT` | 未关联租户 | 确保 API Key 已正确绑定租户 |
| `QUOTA_DAILY_EXCEEDED` | 日配额已用尽 | 等待次日重置或申请提升配额 |
| `QUOTA_MONTHLY_EXCEEDED` | 月配额已用尽 | 等待次月重置或申请提升配额 |
| `QUOTA_TOKEN_EXCEEDED` | Token 配额已用尽 | 申请提升 Token 配额 |
| `QUOTA_REQUEST_EXCEEDED` | 请求次数配额已用尽 | 申请提升请求配额 |
| `QUOTA_COST_EXCEEDED` | 费用配额已用尽 | 申请提升费用配额 |
| `IP_NOT_WHITELISTED` | IP 不在白名单 | 将当前 IP 添加到白名单 |
| `SCOPE_DENIED` | 无权访问该模型/能力 | 申请相应的 scope 权限 |
| `PERMISSION_DENIED` | 权限不足 | 联系管理员授予权限 |
| `TENANT_SUSPENDED` | 租户已被暂停 | 联系管理员了解原因 |
| `USER_BANNED` | 用户已被封禁 | 联系管理员申诉 |

### 4. 限流错误 (429 Too Many Requests)

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `RATE_LIMIT_RPM` | 每分钟请求数超限 | 降低请求频率，参考 Retry-After 头 |
| `RATE_LIMIT_TPM` | 每分钟 Token 数超限 | 减少单次请求的 Token 数量 |
| `RATE_LIMIT_RPD` | 每日请求数超限 | 等待次日重置或申请提升限制 |
| `RATE_LIMIT_TPD` | 每日 Token 数超限 | 等待次日重置或申请提升限制 |
| `RATE_LIMIT_CONCURRENT` | 并发数超限 | 减少并发请求数量 |
| `RATE_LIMIT_BURST` | 突发请求超限 | 平滑请求速率 |

### 5. 请求错误 (400 Bad Request)

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `VALIDATION_ERROR` | 请求参数校验失败 | 检查请求体格式和必填字段 |
| `INVALID_MODEL` | 模型名称无效 | 使用 GET /models 获取可用模型列表 |
| `INVALID_REQUEST` | 请求格式错误 | 检查 JSON 格式和字段类型 |
| `MISSING_PARAMETER` | 缺少必填参数 | 补充必填参数 |
| `TEMPLATE_RENDER_ERROR` | 模板渲染失败 | 检查 prompt 模板语法 |

### 6. 上游错误 (502/503/504)

| 错误码 | HTTP 状态 | 说明 | 解决方案 |
|--------|----------|------|----------|
| `UPSTREAM_ERROR` | 502 | 上游服务错误 | 稍后重试，可能是提供商临时故障 |
| `UPSTREAM_TIMEOUT` | 504 | 上游服务超时 | 减少请求复杂度或稍后重试 |
| `HTTP_500` | 502 | 上游返回 500 | 稍后重试 |
| `HTTP_503` | 502 | 上游返回 503 | 上游过载，稍后重试 |
| `CIRCUIT_OPEN` | 503 | 熔断器开启 | 上游故障，等待恢复 |
| `NO_AVAILABLE_UPSTREAM` | 503 | 无可用上游服务 | 联系管理员检查提供商配置 |
| `ORCHESTRATION_ERROR` | 500 | 编排执行错误 | 内部错误，联系支持 |

### 7. Bridge 错误

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `BRIDGE_GATEWAY_UNAVAILABLE` | Bridge 网关不可用 | 检查 Bridge 服务状态 |
| `INVALID_AGENT_ID` | Agent ID 格式无效 | 使用正确格式的 Agent ID |
| `MISSING_AGENT_ID` | 缺少 Agent ID | 提供 Agent ID 参数 |
| `MISSING_TOOL_NAME` | 缺少工具名称 | 提供 tool_name 参数 |
| `MISSING_REQ_OR_AGENT` | 缺少请求或 Agent ID | 提供 req_id 和 agent_id |

---

## HTTP 状态码映射

| HTTP 状态码 | 含义 | 典型错误码 |
|-------------|------|-----------|
| `400` | Bad Request | VALIDATION_ERROR, INVALID_MODEL |
| `401` | Unauthorized | INVALID_SIGNATURE, INVALID_API_KEY, TOKEN_EXPIRED |
| `402` | Payment Required | INSUFFICIENT_BALANCE |
| `403` | Forbidden | QUOTA_*_EXCEEDED, IP_NOT_WHITELISTED, SCOPE_DENIED |
| `404` | Not Found | 资源不存在 |
| `429` | Too Many Requests | RATE_LIMIT_* |
| `500` | Internal Server Error | 内部错误 |
| `502` | Bad Gateway | UPSTREAM_ERROR, HTTP_* |
| `503` | Service Unavailable | CIRCUIT_OPEN, NO_AVAILABLE_UPSTREAM |
| `504` | Gateway Timeout | UPSTREAM_TIMEOUT |

---

## 错误处理最佳实践

### 1. 重试策略

```python
RETRYABLE_CODES = {
    429,  # Rate limit
    502,  # Bad gateway
    503,  # Service unavailable
    504,  # Gateway timeout
}

RETRYABLE_ERROR_CODES = {
    "RATE_LIMIT_RPM",
    "RATE_LIMIT_TPM",
    "UPSTREAM_ERROR",
    "UPSTREAM_TIMEOUT",
    "CIRCUIT_OPEN",
}

async def call_with_retry(request_func, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = await request_func()

            if response.status_code in RETRYABLE_CODES:
                error_code = response.json().get("code", "")

                if error_code in RETRYABLE_ERROR_CODES:
                    # 获取重试等待时间
                    retry_after = int(response.headers.get("Retry-After", 0))
                    wait_time = retry_after if retry_after > 0 else (2 ** attempt)

                    await asyncio.sleep(wait_time)
                    continue

            return response

        except httpx.TimeoutException:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(2 ** attempt)

    raise Exception("Max retries exceeded")
```

### 2. 错误分类处理

```python
def handle_gateway_error(response):
    error = response.json()
    code = error.get("code", "")
    source = error.get("source", "")

    if response.status_code == 401:
        # 认证错误：需要重新登录或检查 API Key
        if code == "TOKEN_EXPIRED":
            return refresh_and_retry()
        elif code in ("INVALID_API_KEY", "API_KEY_REVOKED"):
            raise AuthenticationError("Please check your API Key")

    elif response.status_code == 402:
        # 支付错误：通知用户充值
        raise PaymentRequiredError("Insufficient balance")

    elif response.status_code == 403:
        # 权限/配额错误
        if "QUOTA" in code:
            raise QuotaExceededError(error.get("message"))
        raise PermissionDeniedError(error.get("message"))

    elif response.status_code == 429:
        # 限流：自动重试
        retry_after = int(response.headers.get("Retry-After", 60))
        raise RateLimitError(f"Rate limited. Retry after {retry_after}s")

    elif response.status_code >= 500:
        # 服务端错误：记录 trace_id 便于排查
        trace_id = error.get("trace_id")
        logger.error(f"Server error: {code}, trace_id: {trace_id}")
        raise ServerError(f"Server error. Reference: {trace_id}")
```

### 3. 日志记录

```python
def log_gateway_error(response):
    error = response.json()
    logger.warning(
        "Gateway API error",
        extra={
            "http_status": response.status_code,
            "error_code": error.get("code"),
            "error_message": error.get("message"),
            "error_source": error.get("source"),
            "trace_id": error.get("trace_id"),
            "upstream_status": error.get("upstream_status"),
            "upstream_code": error.get("upstream_code"),
        }
    )
```

---

## 问题排查

### 使用 trace_id

每个请求都会返回 `trace_id`，用于：

1. **客户端日志关联**: 在日志中记录 trace_id
2. **问题报告**: 向支持团队提供 trace_id
3. **后端追踪**: 管理员可通过 trace_id 查询完整请求链路

```bash
# 请求示例
curl -i https://gateway.example.com/external/v1/chat/completions ...

# 响应头包含 trace_id
X-Request-Id: req-abc123def456
```

### 常见问题

**Q: 收到 INVALID_SIGNATURE 错误**
- 检查时间戳是否在 ±5 分钟内
- 确认签名算法实现正确（HMAC-SHA256）
- 验证请求体 JSON 序列化方式（无空格、键排序）

**Q: 收到 QUOTA_DAILY_EXCEEDED 但今天没用多少**
- 检查是否有其他应用共用同一 API Key
- 确认时区（配额按 UTC 计算）
- 联系管理员查看配额使用详情

**Q: 收到 CIRCUIT_OPEN 错误**
- 上游服务可能故障，熔断器已触发保护
- 等待 30-60 秒后重试
- 如果持续出现，联系管理员检查上游状态

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
