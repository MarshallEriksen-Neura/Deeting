# 内部“秘书”Qdrant检索试点计划

> 状态：仍以试点规划为主，尚未按本文方案接入主 workflow，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 文档中描述的 `semantic_cache -> memory_retrieval` 编排步骤、内部专用秘书 gating、以及对应开关并未看到已接入主 workflow 的实现。
- 目前仓库里已经具备与该方案相关的基础能力：秘书模型配置、外部记忆服务、记忆抽取任务、Qdrant 语义缓存服务，但还没有形成本文描述的完整内部网关试点链路。

## 当前相关基础能力
- 用户秘书配置 API：`backend/app/api/v1/users_route.py`
- 秘书配置服务：`backend/app/services/secretary/secretary_service.py`
- Qdrant 语义缓存服务：`backend/app/services/memory/qdrant_service.py`
- 外部记忆能力：`backend/app/services/memory/external_memory.py`
- 记忆抽取：`backend/app/services/memory/extractor.py`
- 异步记忆任务：`backend/app/tasks/memory_tasks.py`
- 相关测试：`backend/tests/tasks/test_memory_tasks.py`
- 相关测试：`backend/tests/services/test_external_memory.py`

## 当前未见落地的关键点
- `semantic_cache` / `memory_retrieval` workflow step 接入
- `SECRETARY_ENABLED_INTERNAL` / `SECRETARY_ENABLED_EXTERNAL` 方案开关
- 按本文定义的内部网关秘书检索决策层

## 维护说明
- 如果之后真的要推进这条链路，建议基于现有 memory / secretary 基础能力重新起草更小、更可执行的新方案。
- 本文件仅保留试点规划说明。
