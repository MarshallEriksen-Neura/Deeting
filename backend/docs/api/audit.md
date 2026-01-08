# 审计日志文档

> Gateway 审计日志机制详解

---

## 概述

Gateway 自动记录所有 API 请求的审计日志，用于：
- 合规审计
- 费用核对
- 问题排查
- 用量分析

---

## 审计日志结构

### 数据模型

审计日志存储在 `gateway_log` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 日志 ID |
| `user_id` | UUID | 调用者用户 ID |
| `preset_id` | UUID | 命中的预设 ID |
| `model` | string | 请求的模型名称 |
| `status_code` | int | HTTP 响应状态码 |
| `duration_ms` | int | 总耗时（毫秒） |
| `ttft_ms` | int | 首包时间（毫秒，流式） |
| `upstream_url` | string | 上游服务地址（已脱敏） |
| `retry_count` | int | 重试次数 |
| `input_tokens` | int | 输入 Token 数 |
| `output_tokens` | int | 输出 Token 数 |
| `total_tokens` | int | 总 Token 数 |
| `cost_upstream` | float | 上游成本 |
| `cost_user` | float | 用户扣费 |
| `is_cached` | bool | 是否命中缓存 |
| `error_code` | string | 统一错误码 |
| `meta` | JSON | 扩展元数据 |
| `created_at` | datetime | 创建时间 |

### 扩展元数据 (meta)

```json
{
  "request_summary": {
    "model": "gpt-4",
    "stream": true,
    "messages_count": 5,
    "messages_structure": [
      {"role": "system"},
      {"role": "user"},
      {"role": "assistant"},
      {"role": "user"},
      {"role": "assistant"}
    ],
    "max_tokens": 1000,
    "temperature": 0.7
  },
  "routing_result": {
    "provider": "openai",
    "preset_id": "uuid",
    "preset_item_id": "uuid",
    "template_engine": "simple_replace",
    "upstream_url": "https://api.openai.com/v1/chat/completions"
  },
  "upstream": {
    "provider": "openai",
    "url": "https://api.openai.com/v1/chat/completions",
    "latency_ms": 1234,
    "retry_count": 0,
    "status_code": 200
  },
  "billing_details": {
    "input_tokens": 100,
    "output_tokens": 50,
    "total_tokens": 150,
    "input_cost": 0.003,
    "output_cost": 0.003,
    "total_cost": 0.006,
    "currency": "USD"
  },
  "capability": "chat",
  "client_ip": "192.168.1.100"
}
```

---

## 审计流程

### 异步记录

审计日志通过 Celery 异步写入，不阻塞主请求：

```
请求处理完成
      │
      ▼
┌─────────────────┐
│  AuditLogStep   │
│  收集审计数据    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Celery Task    │
│  异步写入 DB     │
└─────────────────┘
```

### 脱敏处理

外部通道的审计日志会自动脱敏：

| 脱敏项 | 处理方式 |
|--------|----------|
| API Key | 不记录 |
| 签名信息 | 不记录 |
| 消息内容 | 仅记录结构，不记录内容 |
| 敏感请求头 | 移除 |
| 上游 URL 参数 | 移除敏感参数 |

### 内外通道差异

| 特性 | 内部通道 | 外部通道 |
|------|----------|----------|
| 详细程度 | 更详细 | 仅关键信息 |
| 消息内容 | 可选记录 | 不记录 |
| 调试信息 | 包含 | 不包含 |
| 脱敏级别 | 较低 | 较高 |

---

## 审计日志查询

### 通过日志文件

```bash
# 按 trace_id 查询
grep "trace_id=req-abc123" /var/log/gateway/app.log

# 按租户查询
grep "tenant=tenant-uuid" /var/log/gateway/app.log | grep "Audit"

# 按模型查询
grep "model=gpt-4" /var/log/gateway/app.log | grep "Audit"
```

### 通过数据库

```sql
-- 按用户查询
SELECT * FROM gateway_log
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC
LIMIT 100;

-- 按时间范围查询
SELECT * FROM gateway_log
WHERE created_at BETWEEN '2026-01-01' AND '2026-01-07'
ORDER BY created_at DESC;

-- 按错误码查询
SELECT * FROM gateway_log
WHERE error_code IS NOT NULL
ORDER BY created_at DESC
LIMIT 100;

-- 费用统计
SELECT
  DATE(created_at) as date,
  COUNT(*) as requests,
  SUM(total_tokens) as total_tokens,
  SUM(cost_user) as total_cost
FROM gateway_log
WHERE user_id = 'user-uuid'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### 通过 API（计划中）

```bash
# 外部通道用户审计查询（计划中）
GET /external/v1/audit?start_date=2026-01-01&end_date=2026-01-07

# 内部运维审计查询（计划中）
GET /internal/v1/admin/audit?user_id=xxx&limit=100
```

---

## 日志格式

### 结构化日志（INFO 级别）

**内部通道**:
```
Audit[internal] trace_id=req-abc123 model=gpt-4 success=true duration_ms=1234.56
```

**外部通道**:
```
Audit[external] trace_id=req-abc123 tenant=tenant-uuid success=true tokens=150 cost=0.006000
```

### JSON 格式日志

```json
{
  "timestamp": "2026-01-06T10:30:00.123456Z",
  "level": "INFO",
  "logger": "app.services.workflow.steps.audit_log",
  "message": "Audit[external]",
  "trace_id": "req-abc123",
  "tenant_id": "tenant-uuid",
  "model": "gpt-4",
  "success": true,
  "tokens": 150,
  "cost": 0.006,
  "duration_ms": 1234
}
```

---

## 审计数据留存

### 留存策略

| 数据类型 | 默认留存期 | 配置项 |
|----------|-----------|--------|
| gateway_log | 30 天 | `AUDIT_LOG_RETENTION_DAYS` |
| 日志文件 | 10 天 | `LOG_RETENTION` |

### 自动清理

通过 Celery Beat 定时任务自动清理过期数据：

```python
# 每日清理任务
"daily-cleanup-at-midnight": {
    "task": "app.tasks.periodic.daily_cleanup_task",
    "schedule": 86400.0,  # 每 24 小时
}
```

### 合规导出

```sql
-- 导出指定租户的审计数据
COPY (
  SELECT * FROM gateway_log
  WHERE user_id IN (
    SELECT id FROM users WHERE tenant_id = 'tenant-uuid'
  )
  AND created_at BETWEEN '2026-01-01' AND '2026-01-31'
) TO '/tmp/audit_export.csv' WITH CSV HEADER;
```

---

## 审计字段说明

### trace_id

每个请求的唯一标识，用于：
- 关联同一请求的所有日志
- 跨服务追踪
- 问题排查

### error_code

统一错误码，参考 [错误码文档](./error-codes.md)

### 计费字段

| 字段 | 说明 |
|------|------|
| `input_tokens` | 输入 Token 数（包括 system prompt） |
| `output_tokens` | 输出 Token 数（模型生成） |
| `total_tokens` | 总 Token 数 |
| `cost_upstream` | 上游实际成本 |
| `cost_user` | 向用户收取的费用 |

### 性能字段

| 字段 | 说明 |
|------|------|
| `duration_ms` | 总请求耗时 |
| `ttft_ms` | Time To First Token（流式响应） |
| `retry_count` | 重试次数 |

---

## 最佳实践

### 1. 日志关联

在客户端记录 trace_id，便于问题排查：

```python
response = call_gateway(...)
trace_id = response.headers.get("X-Request-Id")
logger.info(f"Gateway request completed", extra={"trace_id": trace_id})
```

### 2. 费用对账

定期核对审计日志与计费记录：

```sql
-- 对比审计日志与计费记录
SELECT
  DATE(gl.created_at) as date,
  SUM(gl.cost_user) as audit_cost,
  SUM(bt.amount) as billing_cost
FROM gateway_log gl
LEFT JOIN billing_transaction bt ON gl.id = bt.trace_id
WHERE gl.created_at BETWEEN '2026-01-01' AND '2026-01-07'
GROUP BY DATE(gl.created_at);
```

### 3. 异常监控

监控审计日志中的异常模式：

```promql
# 错误率突增
rate(gateway_request_total{status=~"5.."}[5m]) > 0.01

# 单用户请求量异常
topk(10, sum by (user_id) (rate(gateway_request_total[1h])))
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
