# 监控文档

> Gateway 可观察性与监控指南

---

## 概述

Gateway 提供完整的可观察性支持：

| 维度 | 技术方案 |
|------|----------|
| 指标 (Metrics) | Prometheus |
| 日志 (Logs) | Loguru + JSON 格式 |
| 追踪 (Traces) | trace_id 透传 |
| 告警 (Alerts) | Prometheus Alertmanager |

---

## Prometheus 指标

### 指标端点

```
GET /metrics
```

返回 Prometheus 格式的指标数据。

### 核心指标

#### 1. 请求指标

```prometheus
# 请求计数
gateway_request_total{path="/v1/chat/completions", method="POST", status="200"}

# 请求延迟直方图（秒）
gateway_request_latency_seconds{path="/v1/chat/completions", method="POST", status="200"}
```

**标签说明**:
| 标签 | 说明 |
|------|------|
| `path` | API 路径 |
| `method` | HTTP 方法 |
| `status` | HTTP 状态码 |

#### 2. 上游调用指标

```prometheus
# 上游调用延迟（秒）
gateway_upstream_latency_seconds{provider="openai", model="gpt-4", success="true"}

# 上游失败计数
gateway_upstream_failures_total{provider="openai", model="gpt-4", error="timeout"}
```

**标签说明**:
| 标签 | 说明 |
|------|------|
| `provider` | 上游提供商 |
| `model` | 模型名称 |
| `success` | 是否成功 |
| `error` | 错误类型 |

### 衍生指标

使用 PromQL 计算：

```promql
# 请求成功率 (5 分钟)
sum(rate(gateway_request_total{status=~"2.."}[5m]))
/
sum(rate(gateway_request_total[5m]))

# P95 延迟
histogram_quantile(0.95, rate(gateway_request_latency_seconds_bucket[5m]))

# P99 延迟
histogram_quantile(0.99, rate(gateway_request_latency_seconds_bucket[5m]))

# 上游成功率
sum(rate(gateway_upstream_latency_seconds_count{success="true"}[5m]))
/
sum(rate(gateway_upstream_latency_seconds_count[5m]))

# 上游失败率按类型
sum by (error) (rate(gateway_upstream_failures_total[5m]))
```

---

## Grafana 仪表板

### 概览面板

```json
{
  "title": "Gateway Overview",
  "panels": [
    {
      "title": "Request Rate",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(gateway_request_total[1m]))",
          "legendFormat": "Requests/s"
        }
      ]
    },
    {
      "title": "Success Rate",
      "type": "gauge",
      "targets": [
        {
          "expr": "sum(rate(gateway_request_total{status=~\"2..\"}[5m])) / sum(rate(gateway_request_total[5m])) * 100"
        }
      ],
      "thresholds": [
        {"value": 99, "color": "green"},
        {"value": 95, "color": "yellow"},
        {"value": 0, "color": "red"}
      ]
    },
    {
      "title": "P95 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, rate(gateway_request_latency_seconds_bucket[5m]))",
          "legendFormat": "P95"
        }
      ]
    }
  ]
}
```

### 推荐面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway Dashboard                             │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  Request Rate   │  Success Rate   │     Error Rate              │
│    (Graph)      │    (Gauge)      │      (Graph)                │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                    Latency Distribution                          │
│                      (Heatmap)                                   │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   P50 Latency   │   P95 Latency   │    P99 Latency              │
│    (Stat)       │    (Stat)       │     (Stat)                  │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                 Upstream Provider Breakdown                      │
│                      (Pie Chart)                                 │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Upstream Errors │  Circuit State  │   Rate Limit Hits           │
│    (Graph)      │   (Status)      │     (Graph)                 │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

---

## 日志

### 日志配置

```bash
# 日志级别
LOG_LEVEL=INFO

# JSON 格式（生产环境推荐）
LOG_JSON_FORMAT=true

# 日志文件
LOG_FILE_PATH=/var/log/gateway/app.log

# 日志轮转
LOG_ROTATION=500 MB
LOG_RETENTION=10 days
```

### 日志格式

#### JSON 格式（生产环境）

```json
{
  "timestamp": "2026-01-06T10:30:00.123456Z",
  "level": "INFO",
  "logger": "app.api.v1.external.gateway",
  "message": "request_completed",
  "trace_id": "req-abc123",
  "tenant_id": "tenant-xyz",
  "api_key_id": "key-123",
  "model": "gpt-4",
  "latency_ms": 1234,
  "status_code": 200,
  "tokens": {
    "input": 100,
    "output": 50
  }
}
```

#### 文本格式（开发环境）

```
2026-01-06 10:30:00.123 | INFO | app.api.v1.external.gateway | request_completed | trace_id=req-abc123 tenant_id=tenant-xyz
```

### 日志级别

| 级别 | 用途 |
|------|------|
| `DEBUG` | 详细调试信息 |
| `INFO` | 正常操作日志 |
| `WARNING` | 警告信息（降级、限流） |
| `ERROR` | 错误信息（需要关注） |
| `CRITICAL` | 严重错误（需要立即处理） |

### 关键日志事件

| 事件 | 级别 | 说明 |
|------|------|------|
| `application_startup` | INFO | 服务启动 |
| `application_shutdown` | INFO | 服务关闭 |
| `request_completed` | INFO | 请求完成 |
| `rate_limit_exceeded` | WARNING | 限流触发 |
| `quota_exceeded` | WARNING | 配额耗尽 |
| `upstream_error` | ERROR | 上游调用失败 |
| `circuit_open` | WARNING | 熔断器开启 |
| `signature_failed` | WARNING | 签名验证失败 |
| `billing_deduct_failed` | ERROR | 计费扣减失败 |

---

## 请求追踪

### trace_id 透传

每个请求分配唯一的 `trace_id`：

```http
# 请求头
X-Trace-Id: req-abc123

# 响应头
X-Request-Id: req-abc123
```

### 追踪链路

```
┌────────────────┐     trace_id     ┌────────────────┐
│    客户端      │ ───────────────→ │    Gateway     │
│                │                   │                │
│                │                   │ 1. 验证签名     │
│                │                   │ 2. 检查配额     │
│                │                   │ 3. 限流检查     │
│                │                   │ 4. 路由选择     │
│                │                   │        │       │
│                │                   │        ▼       │
│                │                   │ ┌────────────┐ │
│                │                   │ │  上游调用   │ │
│                │                   │ └────────────┘ │
│                │                   │        │       │
│                │                   │ 5. 响应转换    │
│                │                   │ 6. 计费记录    │
│                │                   │ 7. 审计日志    │
│                │ ←─────────────── │                │
│                │     响应          │                │
└────────────────┘                   └────────────────┘
```

### 日志关联查询

```bash
# 按 trace_id 查询
grep "trace_id=req-abc123" /var/log/gateway/app.log

# JSON 格式日志
jq 'select(.trace_id == "req-abc123")' /var/log/gateway/app.log
```

---

## 告警规则

### Prometheus Alertmanager 配置

```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alerts@example.com'

route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pager'
    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@example.com'

  - name: 'pager'
    pagerduty_configs:
      - service_key: 'xxx'

  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/xxx'
        channel: '#alerts'
```

### 告警规则

```yaml
# prometheus-rules.yml
groups:
  - name: gateway_slo
    rules:
      # 可用性告警
      - alert: GatewayAvailabilityLow
        expr: |
          sum(rate(gateway_request_total{status=~"2.."}[5m]))
          /
          sum(rate(gateway_request_total[5m]))
          < 0.999
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Gateway availability below 99.9%"
          description: "Current availability: {{ $value | humanizePercentage }}"

      # P95 延迟告警
      - alert: GatewayLatencyHigh
        expr: |
          histogram_quantile(0.95, rate(gateway_request_latency_seconds_bucket[5m]))
          > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Gateway P95 latency > 2s"
          description: "Current P95: {{ $value | humanizeDuration }}"

      # 错误率告警
      - alert: GatewayErrorRateHigh
        expr: |
          sum(rate(gateway_request_total{status=~"5.."}[5m]))
          /
          sum(rate(gateway_request_total[5m]))
          > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Gateway error rate > 1%"

      # 上游失败告警
      - alert: UpstreamFailureRateHigh
        expr: |
          sum(rate(gateway_upstream_failures_total[5m]))
          /
          sum(rate(gateway_upstream_latency_seconds_count[5m]))
          > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Upstream failure rate > 5%"

      # 限流触发告警
      - alert: RateLimitExcessive
        expr: |
          sum(rate(gateway_request_total{status="429"}[5m])) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Rate limit being hit frequently"

  - name: gateway_infrastructure
    rules:
      # Redis 连接告警
      - alert: RedisConnectionError
        expr: redis_connected == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis connection lost"

      # PostgreSQL 连接告警
      - alert: PostgresConnectionError
        expr: pg_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL connection lost"

      # Celery Worker 告警
      - alert: CeleryWorkerDown
        expr: celery_workers < 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "No Celery workers available"
```

---

## SLO/SLI 定义

### 服务等级目标 (SLO)

| 指标 | 目标 | 计算方式 |
|------|------|----------|
| 可用性 | 99.9% | 成功请求数 / 总请求数 |
| P95 延迟 | < 2s | 95 分位延迟 |
| P99 延迟 | < 5s | 99 分位延迟 |
| 错误率 | < 0.1% | 5xx 错误数 / 总请求数 |

### 服务等级指标 (SLI)

```promql
# 可用性 SLI
sum(rate(gateway_request_total{status=~"2.."}[30d]))
/
sum(rate(gateway_request_total[30d]))

# 延迟 SLI
histogram_quantile(0.95, rate(gateway_request_latency_seconds_bucket[30d]))

# 错误率 SLI
sum(rate(gateway_request_total{status=~"5.."}[30d]))
/
sum(rate(gateway_request_total[30d]))
```

---

## Celery 监控

### Flower 仪表板

访问 `http://localhost:5555` 查看：

- 活跃任务
- 任务统计
- Worker 状态
- 队列深度

### Celery 指标

```python
# celery worker 指标
celery_worker_up{worker="worker-1"} 1
celery_task_sent_total{task="app.tasks.billing.process_billing"} 1000
celery_task_succeeded_total{task="app.tasks.billing.process_billing"} 995
celery_task_failed_total{task="app.tasks.billing.process_billing"} 5
celery_task_runtime_seconds{task="app.tasks.billing.process_billing", quantile="0.95"} 0.5
```

### 队列监控

```bash
# 查看队列深度
redis-cli LLEN celery

# 查看各队列任务数
redis-cli LLEN default
redis-cli LLEN billing
redis-cli LLEN internal
redis-cli LLEN external
redis-cli LLEN retry
```

---

## 健康检查

### 端点

```bash
# 简单存活检查
GET /health
# 响应: {"status": "ok"}

# 就绪检查（检查依赖）
GET /ready
# 响应: {"status": "ready", "checks": {"database": "ok", "redis": "ok"}}
```

### Kubernetes 配置

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /ready
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3
```

---

## 日志聚合

### ELK Stack 配置

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/gateway/*.log
    json.keys_under_root: true
    json.add_error_key: true

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "gateway-logs-%{+yyyy.MM.dd}"
```

### Kibana 查询

```json
// 查询错误日志
{
  "query": {
    "bool": {
      "must": [
        {"match": {"level": "ERROR"}},
        {"range": {"timestamp": {"gte": "now-1h"}}}
      ]
    }
  }
}

// 按 trace_id 查询
{
  "query": {
    "match": {"trace_id": "req-abc123"}
  },
  "sort": [{"timestamp": "asc"}]
}
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
