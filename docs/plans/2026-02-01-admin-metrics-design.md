# Admin Metrics Design (Global Admin)

> 状态：原方案未按文中 `/api/v1/admin/metrics/*` 形态落地，现已由实际监控实现替代。
> 更新时间：2026-03-06

## 当前结论
- 本文中的聚合表与统一 `admin/metrics` 路由没有成为当前主实现。
- 现行监控能力已拆分到通用监控接口和管理员路由 / MAB 视图中。

## 当前实现入口
- 通用监控接口：`backend/app/api/v1/monitoring_route.py`
- 管理员路由 / MAB 概览：`backend/app/api/v1/admin/routing_mab_route.py`
- 管理端监控页面：`deeting/app/[locale]/admin/monitoring/page-content.tsx`
- 管理端路由质量页面：`deeting/app/[locale]/admin/routing-mab/page-content.tsx`

## 维护说明
- 如需重做统一的 admin metrics 聚合层，请基于当前 `monitoring` / `routing-mab` 实现重新起草新方案。
- 本历史草案不再继续维护详细表结构和接口拆分。
