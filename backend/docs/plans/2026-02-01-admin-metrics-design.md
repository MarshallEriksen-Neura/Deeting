# Admin Metrics Design (Global Admin)

## 背景与目标
为管理员概览/监控页面提供稳定、可扩展的指标接口，落地
`/api/v1/admin/metrics/*`，数据以事实表 + 小时聚合表为核心，
支持全局视角与后续租户/用户筛选。

## 架构与数据流
1) 主链路异步写入 `request_fact`（按月分区），作为最细粒度事实表。
2) Celery 定时任务每小时增量聚合，生成 `usage_hourly` 与
   `provider_health_hourly`。
3) 管理端接口只读，按不同维度从聚合表读取；必要时叠加 Prometheus 指标。

## 表结构约定（与 credits-design 草案对齐）
### request_fact（月分区）
- 主键：request_id
- 关键字段：owner_type/owner_id、preset_id/preset_item_id、capability、model、
  pricing_mode、status_code、upstream_status、latency_ms_total、
  latency_ms_upstream、retry_count、fallback_reason、cache_hit、
  input_tokens/output_tokens、cost_amount/currency、created_at、trace_id
- 索引：owner_id+created_at、preset_item_id+created_at、request_id 唯一

### usage_hourly（按小时聚合）
- 主键：stat_hour + owner_id + capability + model + pricing_mode
- 指标：req_count、success_rate、p50_latency_ms、p95_latency_ms、
  input_tokens、output_tokens、cost_amount、currency

### provider_health_hourly（按上游聚合）
- 主键：stat_hour + preset_item_id
- 指标：req_count、success_rate、p50_latency_ms、p95_latency_ms、
  error_4xx、error_5xx、retry_rate

### credit_ledger（计费真源）
若短期无法落地，可暂以现有 `billing_transaction` 作为对账源，
但接口契约保持 `credit_ledger` 语义，便于后续迁移无感切换。

## 接口设计（Admin）
### GET /api/v1/admin/metrics/overview?from&to
- 全局 QPS、成功率、p50/p95/p99、错误类型堆叠
- 数据：usage_hourly + Prometheus（可选）

### GET /api/v1/admin/metrics/providers?from&to&provider&item_id
- provider/preset_item 维度：请求量、成功率、p95、重试率、4xx/5xx
- 数据：provider_health_hourly

### GET /api/v1/admin/metrics/billing-health?from&to
- request_fact 与 credit_ledger 对账差异、补差/退款量、BYO 免费调用占比
- 数据：request_fact + credit_ledger（或 billing_transaction 过渡）

### GET /api/v1/admin/metrics/tasks?from&to
- Celery 队列长度、处理耗时、失败/重试率、聚合延迟
- 数据：Celery 指标或内部聚合表

## 权限与错误处理
- 权限：新增 `metrics.view`，admin 角色默认授予；路由统一使用
  `require_permissions` 强校验。
- 错误：时间窗口非法返回 400；无权限返回 permission_denied。
- 降级：Prometheus 不可用时，overview 仅返回聚合表数据。

## 任务与迁移
- Alembic：创建 request_fact 分区父表 + 月分区模板；
  usage_hourly、provider_health_hourly；必要索引。
- ORM/Repository：异步写入 request_fact；聚合查询接口。
- Celery：每小时聚合刷新 usage_hourly/provider_health_hourly；
  计费对账任务可延后。

## 测试策略
1) Repository 单测：聚合窗口、空数据、极值、跨月分区写入。
2) Service 单测：指标计算、降级分支。
3) API 单测：权限/参数校验、响应字段完整性。

## 风险与缓解
- 明细表写入压力：异步批量写入、分区与索引优化。
- 聚合延迟：监控任务延迟并在 overview/tasks 暴露。
- 对账不一致：以 request_fact 为事实源，credit_ledger 为计费真源，
  明确补差口径与追溯字段。
