# Qdrant 深度应用扩展规划

> 状态：部分能力已落地，部分仍为路线图，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 本文档里的 Qdrant 应用不是同一成熟度：语义缓存、JIT Tooling、Spec Knowledge Funnel 已有现行实现；动态 Few-Shot、意图锚点路由、语义防火墙仍未看到对应落地链路。
- 因此本文件应视为“已实现能力 + 后续路线图”的混合文档，不再维护原始长篇规划。

## 当前已落地部分
- Qdrant 集合初始化与语义缓存：`backend/app/services/memory/qdrant_service.py`
- JIT Tool Retrieval：`backend/app/services/tools/tool_context_service.py`
- 工具索引同步：`backend/app/services/tools/tool_sync_service.py`
- Spec Knowledge Funnel：`backend/app/services/knowledge/spec_knowledge_service.py`
- Spec Knowledge 管理端审核 API：`backend/app/api/v1/admin/spec_knowledge_review_route.py`
- Spec Knowledge 任务：`backend/app/tasks/spec_knowledge_tasks.py`
- 回归测试：`backend/tests/services/test_spec_knowledge_service.py`

## 当前仍属路线图的部分
- `kb_fewshot` 动态少样本增强
- 基于意图锚点的语义路由分类
- `kb_guardrails` 语义防火墙 / Guardrails

## 维护说明
- 后续若要继续推进未落地部分，请按“单能力单方案”重新拆文档，避免和现行已实现能力混写。
- 本文件仅保留历史归档说明。
