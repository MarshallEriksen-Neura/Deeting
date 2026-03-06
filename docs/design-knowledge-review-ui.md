# Admin UI Design: Knowledge Review & Ingestion Workbench

> 状态：主体页面与接口已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 这份文档中的后台工作台范围，大部分已经拆分为现行的管理端页面、API 路由和侧边栏入口。
- 本文件不再维护完整 UI 设计细节，后续以实际页面和 API 为准。

## 当前实现入口
- 管理端知识审核页：`deeting/app/[locale]/admin/knowledge/reviews/page-content.tsx`
- 管理端助手审核页：`deeting/app/[locale]/admin/assistant-reviews/page-content.tsx`
- 管理端助手管理页：`deeting/app/[locale]/admin/assistants/page-content.tsx`
- 管理端 Spec Knowledge 页：`deeting/app/[locale]/admin/spec-knowledge-candidates/page-content.tsx`
- 管理端 Provider 实例页：`deeting/app/[locale]/admin/provider-instances/page-content.tsx`
- 管理端通知页：`deeting/app/[locale]/admin/notifications/page-content.tsx`
- 管理端 Embedding 设置页：`deeting/app/[locale]/admin/settings/embedding/page-content.tsx`
- 助手审核 API：`backend/app/api/v1/admin/assistant_review_route.py`
- Spec Knowledge 审核 API：`backend/app/api/v1/admin/spec_knowledge_review_route.py`
- 管理端导航入口：`deeting/components/layout/sidebar/navigation-config.ts`

## 维护说明
- 如需继续补做知识审核工作台，请直接以现有 admin 页面和 API 为基础重新开新方案。
- 本文件仅保留历史归档说明。
