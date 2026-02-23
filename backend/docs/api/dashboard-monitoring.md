# Dashboard / Monitoring API

## 鉴权

- 所有接口都需要 `Authorization: Bearer <token>`。
- 路由前缀：`/api/v1`。

## Dashboard

### GET `/dashboard/stats`

- 返回概览 KPI（财务、流量、速度、健康度）。
- 口径说明：
  - 数据归属：优先按 `gateway_log.user_id`，并补充统计 `gateway_log.api_key_id` 对应到当前用户/租户的记录（兼容历史 `user_id` 缺失日志）。
  - `speed.avgTTFT`：优先 `ttft_ms`，为空/0 时回退 `duration_ms`，0 视为无效值。
  - `health.successRate`：近 24 小时内，以 `status_code > 0` 为可判定请求总数，`2xx/3xx` 为成功请求。

### GET `/dashboard/token-throughput`

- Query:
  - `period`: `24h | 7d | 30d`（默认 `24h`）
- 返回 Token 吞吐趋势。

### GET `/dashboard/smart-router-stats`

- 返回智能路由价值指标。

### GET `/dashboard/provider-health`

- 返回上游实例健康状态。
- `status` 取值：`active | degraded | down | unknown`（后端会将历史值 `healthy/up` 归一为 `active`）。
- 状态来源：以真实用户请求结果实时回写为主（2xx/3xx/4xx 视为可达，5xx 视为 `degraded`，超时/网络错误视为 `down`）。
- 过期策略：若实例超过约 5 分钟无新的健康回写，则自动降级为 `unknown`，避免旧状态误导。

### GET `/dashboard/recent-errors`

- Query:
  - `limit`: `1~50`（默认 `10`）
- 返回最近错误列表。

## Monitoring

以下接口统一支持：

- `timeRange`: `24h | 7d | 30d`（默认 `24h`）
- `model`: 可选，按模型过滤
- `apiKey`: 可选，按 API Key ID 过滤（UUID 字符串）
- `errorCode`: 可选，支持：
  - `4xx`：HTTP 4xx
  - `5xx`：HTTP 5xx
  - `429`：HTTP 429
  - 其他字符串：按 `gateway_log.error_code` 精确匹配
- 延迟口径：优先使用 `gateway_log.ttft_ms`，若为空则回退 `gateway_log.duration_ms`；`0` 视为无效值并过滤。

### GET `/monitoring/latency-heatmap`

- 返回延迟热力图（grid / peakLatency / medianLatency）。

### GET `/monitoring/percentile-trends`

- 返回 `p50/p99` 时间序列。

### GET `/monitoring/model-cost-breakdown`

- 返回模型成本占比。

### GET `/monitoring/error-distribution`

- 返回错误分布分类（4xx/5xx/429/others）。

### GET `/monitoring/key-activity-ranking`

- Query:
  - `limit`: `1~20`（默认 `5`）
- 返回 API Key 活跃度排行。
