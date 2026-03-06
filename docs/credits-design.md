# 积分与计费设计草案

> 状态：核心链路已被现行实现吸收，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 积分、预检、扣费、补差、流式/非流式计费的主链路已经进入现行实现。
- 本文中的一些长期扩展项（如多币种、发票、归档等）仍属于后续演进，不应再与当前实现混写。

## 当前实现入口
- Credits API：`backend/app/api/v1/credits_route.py`
- 核心计费流水线：`backend/app/services/billing_pipeline.py`
- 计费仓储：`backend/app/repositories/billing_repository.py`
- 积分服务：`backend/app/services/credits/credits_service.py`
- 流式计费：`backend/app/services/workflow/stream_billing.py`
- 对外 API 文档：`docs/api/credits.md`
- 集成测试：`backend/tests/integration/test_quota_billing_flow.py`
- 单测：`backend/tests/unit/test_billing_step.py`

## 维护说明
- 如需继续推进多币种、归档、对账导出等能力，请围绕现有 `credits_route` / `billing_pipeline` 重新开新方案。
- 本文件仅保留历史归档说明。
