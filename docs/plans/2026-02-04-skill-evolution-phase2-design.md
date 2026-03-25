# Phase 2：智能决策与反馈闭环设计

> 状态：核心闭环已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- Skill 检索 rerank、Bandit 决策、反馈归因和 skill 维度报表已经进入现行实现。
- 这份文档不再维护详细设计推演，后续以决策服务、反馈服务和报表接口为准。

## 当前实现入口
- 决策服务：`backend/app/services/decision/decision_service.py`
- Skill 检索接入决策层：`backend/app/services/tools/tool_sync_service.py`
- 反馈归因：`backend/app/services/feedback/trace_feedback_service.py`
- Skill 维度 Bandit 报表：`backend/app/api/v1/internal/gateway.py`
- Skill 指标服务：`backend/app/services/skill_registry/skill_metrics_service.py`
- 回归测试：`backend/tests/services/test_decision_service.py`
- 回归测试：`backend/tests/api/test_internal_bandit_report.py`
- 回归测试：`backend/tests/services/test_feedback_attribution_service.py`

## 维护说明
- 如需继续演进排序策略或反馈口径，请直接围绕 `DecisionService`、feedback attribution 与 bandit report 重新开新方案。
- 本文件仅保留历史归档说明。
