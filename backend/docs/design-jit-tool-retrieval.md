# Just-in-Time (JIT) Tool Retrieval 设计方案

## 1. 背景与目标
随着 `Spec-Agent` 和插件生态的发展，系统可能拥有数百甚至上千个工具（Tools）。将所有工具的 Schema 一次性注入 LLM 的 Context Window 既昂贵又会降低模型推理的准确性（Attention 分散）。

本方案旨在利用 Qdrant 向量数据库实现工具的 **“按需加载 (Just-in-Time Retrieval)”**，确保无论工具库多大，模型始终只看到与当前 Query 最相关的 Top-K 个工具。

## 2. 核心架构：混合检索漏斗 (Hybrid Retrieval Funnel)

为了平衡性能与准确性，采用“核心常驻 + 动态检索”的混合策略。

**Core Tools 定义（已落地）**：
- 来源：`backend/app/core/plugins.yaml` 中 `enabled_by_default: true` 且 `is_always_on: true` 的插件工具。
- 行为：始终注入上下文，不参与向量检索。

```mermaid
graph TD
    A[User Query] --> B{Strategy Check}
    B -- Tools < 15 --> C[Load All Tools]
    B -- Tools > 15 --> D[Hybrid Retrieval]
    
    D --> E[Core Tools]
    D --> F[Vector Search]
    
    E[Core Tools (Always On)] --> G[Final Context]
    F[Qdrant: sys_tool_index] --> H[Top-K Dynamic Tools]
    H --> G
    
    G --> I[LLM Inference]
```

## 3. 数据模型设计：双索引策略 (Dual-Index Strategy)

为了严格保障用户隐私与数据隔离，工具索引物理拆分为**系统级**与**用户级**两个维度。

### 3.1 系统工具索引 (`sys_tool_index`)
*   **用途**: 存储平台预装、公共可用的标准插件工具（如 Web Search, Calculator）。
*   **权限**: 全局共享（所有用户可读），仅管理员/CI 流程可写。
*   **Collection Name**: `sys_tool_index`
*   **Payload Schema** (实际实现字段):
    ```json
    {
      "scope": "system",
      "tool_name": "weather_get_current",
      "plugin_id": "system.weather_v1",
      "description": "Get current temperature...",
      "schema_json": "{...}",
      "embedding_model": "text-embedding-3-small"
    }
    ```

### 3.2 用户工具索引 (`kb_user_{uuid}_tools`)
*   **用途**: 存储用户私有的 MCP 工具、自定义 Spec-Agent 工具。
*   **权限**: **严格私有**（仅该用户可读写）。
*   **Collection Name**: `kb_user_{uuid}_tools` (动态生成，与用户 ID 绑定)
*   **Payload Schema** (实际实现字段):
    ```json
    {
      "scope": "user",
      "user_id": "uuid",
      "origin": "mcp_server_uuid",
      "tool_name": "query_my_database",
      "plugin_id": "user_mcp",
      "description": "Query personal sales data...",
      "schema_json": "{...}",
      "embedding_model": "text-embedding-3-small"
    }
    ```

### 3.3 向量化策略
*   **Embedding Text**: `Tool Name: {name}. Description: {description}. Arguments: {key_args_summary}`
*   **Model**: 与系统 Embedding 模型保持一致 (如 `text-embedding-3-small`)。

## 4. 详细实施步骤

### Phase 1: 索引同步 (Indexing)
**目标**: 维护两套索引的实时性。

1.  **系统同步 (`ToolSyncService.sync_system_tools`)**:
    *   读取 `plugins.yaml` + `AgentService` 已加载的工具。
    *   **仅索引** `enabled_by_default=true && is_always_on=false` 的工具到 `sys_tool_index`。
    *   通过 Qdrant scroll 获取旧索引快照，使用通用 `QdrantIndexSyncService` 做 delta 更新。
    *   使用缓存指纹跳过无变化的索引同步（降低 scroll 成本）。
    *   缓存 TTL 默认 24h（`MCP_TOOL_SYSTEM_INDEX_HASH_TTL_SECONDS`）。
2.  **用户同步（增量）**:
    *   在 `sync_user_tools` 成功后触发（同请求内写 Qdrant，失败不阻断）。
    *   基于 `tools_cache` 旧值与新值做 diff，仅 upsert/删除变更项。
    *   统一走 `QdrantIndexSyncService`（通用索引同步抽象）。

### Phase 2: 动态检索逻辑 (Retrieval)
**目标**: 改造 `McpDiscoveryStep` 实现双路召回。

*   **修改前**: 直接返回 `get_all_tools()`.
*   **修改后**:
    ```python
    async def execute(self, ctx):
        user_query = last_user_message(ctx)
        vector = await embed(user_query)
        
        # 并行双路检索
        tasks = [
            # 1. 搜系统库
            qdrant.search(collection="sys_tool_index", query_vector=vector, limit=3),
            # 2. 搜用户私有库
            qdrant.search(collection=f"kb_user_{ctx.user_id}_tools", query_vector=vector, limit=5)
        ]
        results = await asyncio.gather(*tasks)
        
        # 3. 合并与去重 (Merge & Dedup)
        # 优先保留用户自定义工具（如果有同名冲突）
        all_hits = merge_results(system_hits=results[0], user_hits=results[1])
        
        # 4. 加上 Core Tools (Always On)
        final_tools = get_core_tools() + [convert(h) for h in all_hits]
        
        ctx.set("mcp_discovery", "tools", final_tools)
    ```

**统一复用说明**：
- Chat 主链路与 Spec-Agent 统一复用 `ToolContextService`，避免两套检索逻辑分叉。

**检索参数（已配置项）**
- `MCP_TOOL_USER_TOPK=5`、`MCP_TOOL_SYSTEM_TOPK=3`
- `MCP_TOOL_SCORE_THRESHOLD=0.75`
- `MCP_TOOL_JIT_THRESHOLD=15`（工具总数 <= 15 时直接全量注入）

### Phase 3: 提示词适配 (Prompt Adaptation)
**目标**: 让模型知道它“并没有看到所有工具”，如果没找到，可以请求搜索。

*   **System Prompt 注入**:
    > "Note: Only the most relevant tools are shown above. If you believe a necessary tool is missing, please ask the user or try to rephrase your request to trigger a different tool search."

## 5. 风险与缓解

| 风险点 | 缓解方案 |
| :--- | :--- |
| **检索未命中** | 1. 调低 Similarity Threshold。<br>2. 允许 LLM 输出特殊指令 `SEARCH_TOOLS: <query>` 进行二次检索（Re-ranking）。 |
| **延迟增加** | Embedding + Search 会增加约 200-500ms 延迟。**对策**: 对 `sys_tool_index` 开启 Qdrant 的内存映射 (Mmap) 或全内存模式；并行化 Embedding 请求。 |
| **工具依赖** | 有些工具必须成对出现（如 `auth_login` 和 `do_action`）。**对策**: 在 Payload 中增加 `related_tools` 字段，检索到一个时自动拉取关联工具。 |

## 6. 开发计划 (Action Items)

- [x] **M1**: 创建 `sys_tool_index` 集合与 `ToolSyncService` (Sync)。
- [x] **M2**: 改造 `McpDiscoveryStep` 支持向量检索 (Retrieval)。
- [x] **M3**: 更新 System Prompt，支持 "Tools truncated" 提示。
- [ ] **M4**: (Optional) 实现“关联工具”自动加载逻辑。
