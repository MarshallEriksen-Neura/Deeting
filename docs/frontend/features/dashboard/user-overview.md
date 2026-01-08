# 用户概览页设计对照（已具备 vs 待补齐）

## 可直接使用的后端能力（已实现）
- API Key 使用量：`/api/v1/admin/api-keys/{id}/usage` 返回小时粒度的请求数、Token、费用、错误数，含总计与 `hourly_stats`（参见 `backend/app/api/v1/admin/api_keys_route.py`）。
- Bandit 路由表现：`/api/v1/internal/bandit/report` 聚合各上游的 trial、成功率、延迟 p95、成本、选择占比等（`backend/app/repositories/bandit_repository.py`）。
- Prometheus 基础指标：`/metrics` 提供网关请求计数、耗时直方图、上游失败计数（`backend/app/core/metrics.py`）。
- 前端图表库：`recharts` 已在依赖中，可用 `Area/Bar/Pie/ScatterChart` 渲染趋势、分布和对比。

## 仍缺失的能力（需新增接口/聚合）
- 模型/能力维度的调用与费用分布：有 `gateway_log` 表，但无对外聚合查询接口，无法直接画模型占比饼图、错误原因榜。
- 延迟分位与 TTFT 趋势：`gateway_log` 字段具备，但缺少 p50/p95/p99 聚合 API；Prometheus 端未提供查询代理。
- 多 Key 对比榜单：目前 `/usage` 仅支持单个 API Key，不支持多 Key 汇总排行。
- 成本/余额/配额视图：`tenant_quota`、`billing_transaction` 模型存在，尚未暴露查询 API，无法展示积分/余额、充值扣费流水。
- 实时流量与异常检测：缺少基于时间窗的速率、突增与异常错误监测接口。

## 设计呈现建议（基于现状可落地）
- 趋势：使用 `/usage` 数据绘制请求 & Token 堆叠面积图、错误率折线（支持 24h/7d/30d 时间窗）。
- 上游健康：用 `bandit/report` 渲染成功率 + 延迟对比柱/气泡图，并显示冷却/优先级等状态标签。
- KPI 卡片：总请求、总 Token、总费用、错误率（来自 `/usage` 聚合字段），配迷你趋势线。

## 后续优先补齐的接口
1) `gateway_log` 聚合查询（按时间、模型、错误码），驱动模型分布、错误榜单、延迟分位图。
2) 多 Key 使用榜（跨 Key 汇总请求/Token/费用/错误）。
3) 余额/配额查询（基于 `tenant_quota`、`billing_transaction`），支持余额预警与流水表。
4) Prometheus 查询代理或简易聚合（p95/p99、速率），用于性能与异常视图。
