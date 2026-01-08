# 限流文档

> Gateway 限流机制详解

---

## 概述

Gateway 实施多层限流保护，防止服务过载和资源滥用：

| 限流层级 | 说明 |
|----------|------|
| 全局限流 | 保护整体服务容量 |
| 租户级限流 | 防止单租户占满资源 |
| API Key 级限流 | 细粒度流量控制 |
| IP 级限流 | 防止恶意攻击 |

---

## 限流维度

### 1. RPM (Requests Per Minute)

每分钟请求数限制。

| 通道 | 默认值 | 配置项 |
|------|--------|--------|
| 外部 | 60 | `RATE_LIMIT_EXTERNAL_RPM` |
| 内部 | 600 | `RATE_LIMIT_INTERNAL_RPM` |

### 2. TPM (Tokens Per Minute)

每分钟 Token 数限制，用于控制资源消耗。

| 通道 | 默认值 | 配置项 |
|------|--------|--------|
| 外部 | 100,000 | `RATE_LIMIT_EXTERNAL_TPM` |
| 内部 | 1,000,000 | `RATE_LIMIT_INTERNAL_TPM` |

### 3. RPD (Requests Per Day)

每日请求数限制。

| 级别 | 默认值 |
|------|--------|
| API Key | 可配置 |

### 4. TPD (Tokens Per Day)

每日 Token 数限制。

| 级别 | 默认值 |
|------|--------|
| API Key | 可配置 |

### 5. 并发限制 (Concurrent)

同时进行的请求数限制。

| 级别 | 默认值 |
|------|--------|
| API Key | 可配置 |

### 6. 突发限制 (Burst)

瞬时请求峰值限制。

| 级别 | 默认值 |
|------|--------|
| API Key | 可配置 |

---

## 限流算法

### 滑动窗口算法

Gateway 使用 **滑动窗口** 算法实现精确限流：

```
时间轴:
|------ 窗口 1 ------|------ 窗口 2 ------|
    ↑                    ↑
    请求 A               请求 B

请求 B 的限流计算:
- 统计当前窗口内的请求数
- 加上前一窗口按时间比例的请求数
```

**优势**:
- 比固定窗口更平滑
- 避免窗口边界突发

### Redis 实现

```lua
-- 滑动窗口限流 Lua 脚本
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 移除过期记录
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 获取当前窗口请求数
local count = redis.call('ZCARD', key)

if count >= limit then
    return 0  -- 超限
end

-- 添加当前请求
redis.call('ZADD', key, now, now .. math.random())
redis.call('EXPIRE', key, window)

return 1  -- 允许
```

---

## 限流 Key 层级

```
gw:rl:{type}:{identifier}

示例:
gw:rl:tenant:tenant-uuid        # 租户级
gw:rl:ak:api-key-uuid           # API Key 级
gw:rl:ip:192.168.1.100          # IP 级
gw:rl:global                    # 全局级
```

### 优先级

```
IP 级 → API Key 级 → 租户级 → 全局级
```

任意一级触发限流，请求即被拒绝。

---

## 配置限流

### 1. 环境变量配置

```bash
# 外部通道默认值
RATE_LIMIT_EXTERNAL_RPM=60
RATE_LIMIT_EXTERNAL_TPM=100000

# 内部通道默认值
RATE_LIMIT_INTERNAL_RPM=600
RATE_LIMIT_INTERNAL_TPM=1000000

# 窗口大小（秒）
RATE_LIMIT_WINDOW_SECONDS=60
```

### 2. API Key 级配置

通过管理接口为单个 API Key 配置限流：

```bash
curl -X PUT "https://gateway.example.com/api/v1/admin/api-keys/{id}/rate-limit" \
  -H "Authorization: Bearer <admin_token>" \
  -d "rpm=100&tpm=200000&rpd=10000&tpd=50000000&concurrent_limit=10&burst_limit=20"
```

**参数说明**:

| 参数 | 说明 |
|------|------|
| `rpm` | 每分钟请求数 |
| `tpm` | 每分钟 Token 数 |
| `rpd` | 每日请求数 |
| `tpd` | 每日 Token 数 |
| `concurrent_limit` | 并发数限制 |
| `burst_limit` | 突发上限 |
| `is_whitelist` | 是否白名单（跳过限流） |

### 3. 白名单配置

对于信任的客户端，可以设置为白名单跳过限流：

```bash
curl -X PUT "https://gateway.example.com/api/v1/admin/api-keys/{id}/rate-limit" \
  -H "Authorization: Bearer <admin_token>" \
  -d "is_whitelist=true"
```

---

## 限流响应

### HTTP 状态码

当请求被限流时，返回 `429 Too Many Requests`。

### 响应头

| 响应头 | 说明 |
|--------|------|
| `X-RateLimit-Limit` | 限流阈值 |
| `X-RateLimit-Remaining` | 剩余配额 |
| `X-RateLimit-Reset` | 重置时间（Unix 时间戳） |
| `Retry-After` | 建议重试等待秒数 |

### 响应体

```json
{
  "code": "RATE_LIMIT_RPM",
  "message": "Rate limit exceeded. Please retry after 45 seconds.",
  "source": "gateway",
  "trace_id": "req-abc123"
}
```

### 错误码

| 错误码 | 说明 |
|--------|------|
| `RATE_LIMIT_RPM` | 每分钟请求数超限 |
| `RATE_LIMIT_TPM` | 每分钟 Token 数超限 |
| `RATE_LIMIT_RPD` | 每日请求数超限 |
| `RATE_LIMIT_TPD` | 每日 Token 数超限 |
| `RATE_LIMIT_CONCURRENT` | 并发数超限 |
| `RATE_LIMIT_BURST` | 突发请求超限 |

---

## 限流降级

当 Redis 不可用时，Gateway 会自动降级：

### 降级策略

1. **Lua 脚本优先**: 使用预加载的 Lua 脚本执行限流
2. **Python 回退**: Redis 不可用时，使用 Python 内存限流
3. **默认放行**: 极端情况下，记录告警但放行请求

### 降级配置

```python
# 降级开关
RATE_LIMIT_DEGRADE_ENABLED = True

# 降级模式下的默认限制（比正常更宽松）
RATE_LIMIT_DEGRADE_RPM = 120
```

---

## 客户端最佳实践

### 1. 指数退避重试

```python
import asyncio
import random

async def call_with_backoff(request_func, max_retries=5):
    for attempt in range(max_retries):
        response = await request_func()

        if response.status_code != 429:
            return response

        # 获取 Retry-After
        retry_after = int(response.headers.get("Retry-After", 0))

        if retry_after > 0:
            wait_time = retry_after
        else:
            # 指数退避 + 随机抖动
            wait_time = min(60, (2 ** attempt) + random.uniform(0, 1))

        await asyncio.sleep(wait_time)

    raise Exception("Max retries exceeded")
```

### 2. 令牌桶平滑请求

```python
import asyncio
from asyncio import Semaphore
from time import time

class RateLimiter:
    def __init__(self, rpm: int):
        self.rpm = rpm
        self.interval = 60 / rpm  # 每个请求间隔
        self.last_request = 0
        self.lock = asyncio.Lock()

    async def acquire(self):
        async with self.lock:
            now = time()
            wait_time = self.last_request + self.interval - now

            if wait_time > 0:
                await asyncio.sleep(wait_time)

            self.last_request = time()


# 使用
limiter = RateLimiter(rpm=50)  # 略低于限制

async def make_request():
    await limiter.acquire()
    return await client.post(...)
```

### 3. 并发控制

```python
from asyncio import Semaphore

# 限制并发数
semaphore = Semaphore(10)

async def make_request():
    async with semaphore:
        return await client.post(...)

# 批量请求
async def batch_requests(items):
    tasks = [make_request(item) for item in items]
    return await asyncio.gather(*tasks)
```

### 4. 监控限流状态

```python
def log_rate_limit_headers(response):
    remaining = response.headers.get("X-RateLimit-Remaining")
    reset = response.headers.get("X-RateLimit-Reset")

    if remaining:
        logger.info(f"Rate limit remaining: {remaining}, reset at: {reset}")

        # 预警：剩余配额低于 10%
        if int(remaining) < 6:  # 假设限制是 60
            logger.warning("Rate limit nearly exhausted!")
```

---

## 监控与告警

### Prometheus 指标

```
# 限流触发次数
gateway_rate_limit_hits_total{type="rpm", level="tenant"}

# 当前使用率
gateway_rate_limit_usage_ratio{type="rpm", level="tenant"}

# 限流配置
gateway_rate_limit_config{type="rpm", level="tenant"}
```

### 告警规则示例

```yaml
groups:
  - name: rate_limit
    rules:
      - alert: HighRateLimitUsage
        expr: gateway_rate_limit_usage_ratio > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Rate limit usage > 80%"

      - alert: RateLimitHitsSpike
        expr: rate(gateway_rate_limit_hits_total[5m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Rate limit being hit frequently"
```

---

## 常见问题

### Q: 为什么我的请求被限流，但我没有发很多请求？

**可能原因**:
1. 其他应用共用同一 API Key
2. TPM 限流（单次请求 Token 数过多）
3. 时钟不同步导致窗口计算偏差

**排查步骤**:
1. 检查响应头中的具体错误码
2. 查看 API Key 使用统计
3. 确认系统时间同步

### Q: 如何申请提升限流阈值？

1. 联系管理员提供使用场景说明
2. 管理员通过 API 更新 API Key 限流配置
3. 更新立即生效，无需重启

### Q: 限流配置多久生效？

- API Key 级配置：即时生效
- 环境变量配置：需重启服务

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
