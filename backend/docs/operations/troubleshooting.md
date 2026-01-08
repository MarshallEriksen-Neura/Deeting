# 故障排查指南

> Gateway 常见问题诊断与解决

---

## 快速诊断流程

```
问题发生
    │
    ▼
┌──────────────────┐
│ 1. 收集 trace_id │
│ 2. 检查错误码    │
│ 3. 查看日志      │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 分类问题 │
    └────┬────┘
         │
    ┌────┴────────────────────┬────────────────────┬────────────────────┐
    │                         │                    │                    │
    ▼                         ▼                    ▼                    ▼
┌─────────┐           ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│ 认证问题 │           │  限流/配额   │      │  上游问题   │      │  系统问题   │
└─────────┘           └─────────────┘      └─────────────┘      └─────────────┘
```

---

## 一、认证问题

### 1.1 INVALID_SIGNATURE - 签名验证失败

**症状**: 返回 401，错误码 `INVALID_SIGNATURE`

**排查步骤**:

```bash
# 1. 检查系统时间
date
# 确保时间与服务器同步（±5 分钟内）

# 2. 验证签名算法
# 确保使用 HMAC-SHA256
# 消息格式: {api_key}{timestamp}{nonce}{body_hash}

# 3. 检查请求体序列化
# JSON 必须：无空格、键排序
python3 -c "import json; print(json.dumps({'b':2,'a':1}, separators=(',',':'), sort_keys=True))"
# 输出: {"a":1,"b":2}
```

**常见原因**:
- 时间戳过期（超过 5 分钟）
- 请求体 JSON 序列化方式不一致
- 使用了错误的签名密钥

**解决方案**:

```python
# 正确的签名实现
import hashlib
import hmac
import json
import time
import uuid

def sign_request(api_key: str, api_secret: str, body: dict) -> dict:
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex

    # 关键：使用 separators 和 sort_keys
    body_json = json.dumps(body, separators=(',', ':'), sort_keys=True)
    body_hash = hashlib.sha256(body_json.encode('utf-8')).hexdigest()

    message = f"{api_key}{timestamp}{nonce}{body_hash}"

    # 使用 api_secret 签名
    signature = hmac.new(
        api_secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    return {
        "X-API-Key": api_key,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
    }
```

### 1.2 NONCE_REUSED - Nonce 重复

**症状**: 返回 401，错误码 `NONCE_REUSED`

**原因**: 同一个 Nonce 在 30 分钟内重复使用

**解决方案**:
```python
# 每次请求使用新的 UUID
import uuid
nonce = uuid.uuid4().hex
```

### 1.3 TOKEN_EXPIRED - JWT 过期

**症状**: 返回 401，错误码 `TOKEN_EXPIRED`

**解决方案**:
```python
# 使用 refresh_token 刷新
response = httpx.post(
    f"{base_url}/api/v1/auth/refresh",
    json={"refresh_token": refresh_token}
)
new_tokens = response.json()
```

### 1.4 SIGNATURE_FROZEN - API Key 被冻结

**症状**: 返回 401，错误码 `SIGNATURE_FROZEN`

**原因**: 连续 5 次签名失败触发安全保护

**解决方案**:
1. 联系管理员解冻
2. 检查签名实现是否正确
3. 考虑轮换 API Key

---

## 二、限流和配额问题

### 2.1 RATE_LIMIT_RPM - 请求频率超限

**症状**: 返回 429，错误码 `RATE_LIMIT_RPM`

**排查**:
```bash
# 查看当前限流配置
curl -H "Authorization: Bearer $TOKEN" \
  "https://gateway.example.com/api/v1/admin/api-keys/{id}"
```

**解决方案**:

```python
# 1. 实现请求速率控制
import asyncio
import time

class RateLimiter:
    def __init__(self, rpm: int):
        self.interval = 60 / rpm
        self.last_request = 0

    async def wait(self):
        now = time.time()
        wait_time = self.last_request + self.interval - now
        if wait_time > 0:
            await asyncio.sleep(wait_time)
        self.last_request = time.time()

# 2. 使用指数退避重试
async def call_with_retry(func, max_retries=3):
    for attempt in range(max_retries):
        response = await func()
        if response.status_code != 429:
            return response

        retry_after = int(response.headers.get("Retry-After", 60))
        await asyncio.sleep(retry_after)

    raise Exception("Rate limit exceeded")
```

### 2.2 QUOTA_*_EXCEEDED - 配额耗尽

**症状**: 返回 403，错误码 `QUOTA_DAILY_EXCEEDED` 等

**排查**:
```bash
# 查看 API Key 用量
curl -H "Authorization: Bearer $TOKEN" \
  "https://gateway.example.com/api/v1/admin/api-keys/{id}/usage?start_date=2026-01-01&end_date=2026-01-06"
```

**解决方案**:
1. 等待配额重置（daily: 次日 UTC 00:00，monthly: 次月 1 日）
2. 联系管理员提升配额
3. 优化请求，减少 Token 消耗

### 2.3 INSUFFICIENT_BALANCE - 余额不足

**症状**: 返回 402，错误码 `INSUFFICIENT_BALANCE`

**解决方案**:
1. 充值账户余额
2. 联系财务部门

---

## 三、上游问题

### 3.1 UPSTREAM_TIMEOUT - 上游超时

**症状**: 返回 504，错误码 `UPSTREAM_TIMEOUT`

**排查**:
```bash
# 1. 检查上游服务状态
curl -I https://api.openai.com/v1/models

# 2. 查看网关日志
grep "trace_id=$TRACE_ID" /var/log/gateway/app.log | grep upstream

# 3. 检查网络连通性
ping api.openai.com
traceroute api.openai.com
```

**常见原因**:
- 上游服务过载
- 网络延迟
- 请求过于复杂（大量 Token）

**解决方案**:
1. 稍后重试
2. 减少请求复杂度（减少 max_tokens）
3. 联系管理员检查上游配置

### 3.2 CIRCUIT_OPEN - 熔断器开启

**症状**: 返回 503，错误码 `CIRCUIT_OPEN`

**原因**: 上游连续失败超过阈值，熔断器触发保护

**排查**:
```bash
# 检查熔断状态
redis-cli GET "gw:circuit:{provider}:{model}"
```

**解决方案**:
1. 等待熔断器自动恢复（默认 30 秒）
2. 检查上游服务状态
3. 切换到备用提供商

### 3.3 NO_AVAILABLE_UPSTREAM - 无可用上游

**症状**: 返回 503，错误码 `NO_AVAILABLE_UPSTREAM`

**排查**:
```bash
# 1. 检查模型配置
curl -H "Authorization: Bearer $TOKEN" \
  "https://gateway.example.com/internal/v1/models"

# 2. 检查 provider preset 配置
# (需要管理员权限访问数据库)
```

**解决方案**:
1. 确认请求的模型已配置
2. 检查 provider preset 状态
3. 联系管理员添加上游配置

---

## 四、系统问题

### 4.1 服务启动失败

**排查**:
```bash
# 1. 检查依赖服务
pg_isready -h localhost -p 5432
redis-cli ping

# 2. 检查配置
cat .env | grep -E "DATABASE_URL|REDIS_URL"

# 3. 检查日志
tail -f /var/log/gateway/app.log

# 4. 手动启动查看错误
uvicorn main:app --host 0.0.0.0 --port 8000
```

**常见问题**:
- 数据库连接失败
- Redis 连接失败
- JWT 密钥文件缺失
- 端口被占用

### 4.2 Redis 连接问题

**症状**: 限流/缓存功能异常

**排查**:
```bash
# 测试连接
redis-cli -h localhost -p 6379 ping

# 检查内存
redis-cli INFO memory

# 检查连接数
redis-cli INFO clients
```

**解决方案**:
```bash
# 重启 Redis
systemctl restart redis

# 清理内存（谨慎操作）
redis-cli FLUSHDB
```

### 4.3 数据库连接问题

**症状**: API 请求返回 500，日志显示数据库错误

**排查**:
```bash
# 测试连接
psql -h localhost -U postgres -d ai_gateway -c "SELECT 1"

# 检查连接数
psql -c "SELECT count(*) FROM pg_stat_activity"

# 检查慢查询
psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active'"
```

**解决方案**:
```bash
# 增加连接池大小（如果连接耗尽）
# 在 .env 中调整 DATABASE_URL 参数
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db?min_size=10&max_size=50
```

### 4.4 Celery Worker 问题

**症状**: 异步任务不执行

**排查**:
```bash
# 检查 worker 状态
celery -A app.core.celery_app inspect ping

# 查看活跃任务
celery -A app.core.celery_app inspect active

# 查看队列
redis-cli LLEN celery
redis-cli LLEN billing

# 查看日志
tail -f /var/log/celery/worker.log
```

**解决方案**:
```bash
# 重启 worker
celery -A app.core.celery_app control shutdown
celery -A app.core.celery_app worker --loglevel=info
```

---

## 五、日志分析

### 5.1 按 trace_id 查询

```bash
# 单条 trace 完整日志
grep "trace_id=req-abc123" /var/log/gateway/app.log

# JSON 格式日志
jq 'select(.trace_id == "req-abc123")' /var/log/gateway/app.log
```

### 5.2 错误日志分析

```bash
# 最近 1 小时错误
grep "ERROR" /var/log/gateway/app.log | tail -100

# 按错误类型统计
grep "ERROR" /var/log/gateway/app.log | grep -oP 'error_code=\K\w+' | sort | uniq -c | sort -rn

# 上游错误
grep "upstream_error" /var/log/gateway/app.log | tail -50
```

### 5.3 性能分析

```bash
# 慢请求（>2秒）
grep "latency_ms" /var/log/gateway/app.log | awk -F'latency_ms=' '{if($2>2000) print}' | tail -20

# 按模型统计延迟
jq -r 'select(.latency_ms != null) | "\(.model) \(.latency_ms)"' /var/log/gateway/app.log \
  | awk '{sum[$1]+=$2; count[$1]++} END {for(m in sum) print m, sum[m]/count[m]}'
```

---

## 六、常见问题 FAQ

### Q1: 为什么签名一直失败？

**检查清单**:
1. [ ] 系统时间是否同步？
2. [ ] JSON 序列化是否正确（无空格、键排序）？
3. [ ] 使用的是 api_secret 还是 api_key？
4. [ ] 请求体是否有改动（如 Content-Type 不同导致的格式差异）？

### Q2: 为什么内部通道也被限流？

**原因**: 内部通道也有限流保护，但阈值更高（600 RPM vs 60 RPM）

**解决**:
1. 检查是否有循环调用
2. 优化调用频率
3. 联系管理员调整阈值

### Q3: 流式响应中断怎么处理？

**排查**:
```python
# 检查连接是否被关闭
# 检查客户端超时设置
# 检查代理/负载均衡器配置
```

**解决**:
```python
# 增加超时时间
async with httpx.AsyncClient(timeout=300) as client:
    async with client.stream(...) as response:
        async for chunk in response.aiter_bytes():
            # 处理 chunk
            pass
```

### Q4: 如何查看 API Key 的详细用量？

```bash
# 1. 通过管理 API
curl -H "Authorization: Bearer $TOKEN" \
  "https://gateway.example.com/api/v1/admin/api-keys/{id}/usage?start_date=2026-01-01&end_date=2026-01-06"

# 2. 通过日志
grep "api_key_id=$KEY_ID" /var/log/gateway/app.log | wc -l
```

### Q5: 熔断器什么时候恢复？

- **默认行为**: 30 秒后自动进入半开状态
- **半开状态**: 允许少量请求探测
- **恢复条件**: 连续 2 次成功请求

```bash
# 检查熔断状态
redis-cli GET "gw:circuit:{provider}:{model}"
# 返回: OPEN / HALF_OPEN / CLOSED
```

---

## 七、紧急联系

| 问题类型 | 联系方式 |
|----------|----------|
| 服务不可用 | ops@example.com |
| 安全问题 | security@example.com |
| 计费问题 | billing@example.com |
| 一般咨询 | support@example.com |

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
