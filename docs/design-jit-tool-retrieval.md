# Just-in-Time (JIT) Tool Retrieval 设计方案

> 状态：核心机制已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- JIT Tool Retrieval 的核心机制已经进入现行实现：工具总量阈值、系统/用户双路检索、Qdrant 索引同步、ToolContextService 统一组装。
- 本文件中的原始设计细节不再作为当前源文档，后续以 tool context / tool sync 现行代码为准。

## 当前实现入口
- 工具上下文组装：`backend/app/services/tools/tool_context_service.py`
- 系统/用户工具索引同步：`backend/app/services/tools/tool_sync_service.py`
- 通用 Qdrant 索引同步抽象：`backend/app/services/indexing/index_sync_service.py`
- 用户工具同步入口：`backend/app/services/mcp/discovery.py`
- 配置项：`backend/app/core/config.py`
- 系统工具集合名：`backend/app/storage/qdrant_kb_collections.py`
- 回归测试：`backend/tests/test_tool_context_service.py`
- ToolSyncService 与决策层联动测试：`backend/tests/test_tool_sync_service.py`

## 维护说明
- 如需继续扩展二次检索、关联工具拉取或更复杂的提示词适配，请基于现有 tool context / tool sync 链路另开新方案。
- 本文件仅保留历史归档说明。
