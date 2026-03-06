# Assistant / Skill Marketplace Plan

> 状态：已被当前助手市场、审核流程与 Skill Registry 实现吸收，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 早期“Assistant / Skill Marketplace” 规划，已经拆分并落入多条现行实现：助手市场、助手审核、Skill Registry、技能同步与管理端页面。
- 原始分阶段计划不再适合作为当前文档源，后续请直接参考现行模块。

## 当前实现入口
- 助手路由：`backend/app/api/v1/assistants_route.py`
- 助手审核 API：`backend/app/api/v1/admin/assistant_review_route.py`
- 助手市场服务：`backend/app/services/assistant/assistant_market_service.py`
- Skill Registry 模型：`backend/app/models/skill_registry.py`
- Skill Registry 服务：`backend/app/services/skill_registry/skill_registry_service.py`
- Skill Registry 异步任务：`backend/app/tasks/skill_registry.py`
- 管理端 Skills 页面：`deeting/app/[locale]/admin/skills/page-content.tsx`
- 管理端助手页面：`deeting/app/[locale]/admin/assistants/page-content.tsx`
- 管理端助手审核页面：`deeting/app/[locale]/admin/assistant-reviews/page-content.tsx`

## 维护说明
- 若后续还要做真正统一的 marketplace 抽象，请基于 assistant market 与 skill registry 的现有边界重新起草。
- 本文件仅保留历史归档说明。
