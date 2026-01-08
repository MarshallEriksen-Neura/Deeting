# Agent Plugin 权限管理与 Qdrant 集成设计方案

## 1. 背景与目标
随着 Agent 插件（Agent Plugins）数量增加，需要将其结构化入库（SQL DB），并支持细粒度的权限控制。同时，为了支持自然语言查找插件（“给我一个能处理 PDF 的工具”）以及插件自身的长时记忆能力，需要结合 Qdrant 向量数据库进行设计。

本方案解决以下核心问题：
1.  **插件元数据存储**：如何在关系型数据库中管理插件及其生命周期。
2.  **权限控制**：谁能发布、可见、使用插件。
3.  **Qdrant 赋能**：
    - **语义检索（Discovery）**：通过自然语言找到合适的插件。
    - **插件记忆（Memory）**：插件运行时的专属记忆空间隔离。

---

## 2. 数据库设计 (Relational Schema)

在现有 `backend/app/models` 中新增 `AgentPlugin` 模型，用于存储元数据。

### 2.1 新增模型：`AgentPlugin`

```python
class AgentPlugin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "agent_plugin"

    # 基础信息
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, comment="插件唯一标识名 (e.g. 'official/weather')")
    display_name: Mapped[str | None] = mapped_column(String(200), comment="展示名称")
    version: Mapped[str] = mapped_column(String(50), default="0.1.0", comment="语义化版本")
    description: Mapped[str | None] = mapped_column(Text, comment="功能描述 (用于向量检索)")
    icon_url: Mapped[str | None] = mapped_column(String(500), comment="图标 URL")
    
    # 代码/执行引用
    module_path: Mapped[str] = mapped_column(String(500), comment="Python 模块导入路径或代码引用")
    config_schema: Mapped[dict | None] = mapped_column(JSON, comment="配置 JSON Schema (用于前端生成表单)")
    capabilities: Mapped[list[str] | None] = mapped_column(JSON, comment="能力标签列表 (e.g. ['search', 'image'])")

    # 权限与归属
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id"), comment="所有者 ID (System 插件为空)")
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE", comment="可见性: PUBLIC, PRIVATE, SHARED")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否系统内置")
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否通过审核 (仅 Public 需审核)")

    # 关联
    owner = relationship("User", backref="owned_plugins")
```

### 2.2 权限枚举 (`PluginVisibility`)
- **SYSTEM**: 系统内置，所有人可用，不可修改/删除（除非超管）。
- **PUBLIC**: 所有用户可见/可用，需 `is_approved=True`。
- **PRIVATE**: 仅 Owner 可见/可用。
- **SHARED**: (未来扩展) 特定组织/Role 可见。

---

## 3. 权限控制逻辑 (Permissions)

基于现有 RBAC (`User`, `Role`, `Permission`) 和上述字段实现。

### 3.1 核心动作与鉴权
1.  **发布/创建 (Create)**:
    - 需拥有权限点 `plugin:publish`。
    - 普通用户创建后默认为 `visibility=PRIVATE`。
2.  **公开 (Publish to Marketplace)**:
    - 用户将 `visibility` 设为 `PUBLIC`。
    - 触发审核流程，`is_approved` 默认为 `False`。
    - 管理员（`plugin:review` 权限）审核通过后 `is_approved=True`。
3.  **使用/配置 (Use)**:
    - 在 Provider Preset 中添加插件时进行检查。
    - **Query Filter**:
      ```sql
      WHERE (is_system = true)
         OR (visibility = 'PUBLIC' AND is_approved = true)
         OR (owner_id = :current_user_id)
      ```
4.  **修改/删除 (Update/Delete)**:
    - 仅 `owner_id` 匹配 或 超级管理员。

---

## 4. Qdrant 集成方案

### 4.1 场景一：插件语义检索 (Discovery)
**目标**：用户输入“我想找个能画图的工具”，系统推荐 `StableDiffusion` 插件。

- **Collection**: `plugin_marketplace`
- **Embedding Source**: `display_name + " " + description + " " + capabilities`
- **Payload (Metadata)**:
    ```json
    {
      "plugin_id": "uuid...",
      "name": "official/image-gen",
      "owner_id": "uuid...",
      "visibility": "PUBLIC",
      "is_system": true,
      "capabilities": ["image", "creative"]
    }
    ```
- **Sync 机制**:
    - 插件创建/更新/审核通过时，异步任务同步到 Qdrant。
- **Retrieval Filter**:
    - 搜索时必须带上权限 Filter，防止搜到别人的私有插件。
    ```json
    {
      "filter": {
        "should": [
          { "match": { "key": "is_system", "value": true } },
          { "must": [
              { "match": { "key": "visibility", "value": "PUBLIC" } },
              { "match": { "key": "is_approved", "value": true } }
            ]
          },
          { "match": { "key": "owner_id", "value": "current_user_id" } }
        ]
      }
    }
    ```

### 4.2 场景二：插件专属记忆 (Scoped Memory)
**目标**：插件（如“私人助理”）需要存储和读取用户的偏好或历史数据，但不应与其他插件混淆。

- **Collection**: `agent_memory` (统一大表 或 分表)
- **隔离策略**: 强制 Metadata Filter。
- **Payload**:
    ```json
    {
      "content": "...",
      "plugin_id": "current_plugin_id",  // 强制注入
      "user_id": "current_user_id",      // 强制注入
      "session_id": "optional..."
    }
    ```
- **Runtime Injection**:
    - 在 `PluginContext` 中注入封装好的 `VectorStoreClient`。
    - 该 Client 的 `search` 和 `upsert` 方法底层**自动拼接** `plugin_id` 和 `user_id` 的 Filter。
    - **禁止** 插件直接访问原始 Qdrant Client，防止越权访问其他插件数据。

---

## 5. 实施步骤建议

1.  **M1 (Models & CRUD)**:
    - 创建 `AgentPlugin` 模型与 Migration。
    - 实现基本的 CRUD API（仅限 System 和 Private）。
2.  **M2 (Qdrant Discovery)**:
    - 建立 `plugin_marketplace` 集合。
    - 实现 `PluginService.sync_to_qdrant(plugin_id)`。
    - 实现“插件市场”搜索接口。
3.  **M3 (Context Isolation)**:
    - 升级 `PluginContext`，注入受限的 Memory 接口。
    - 验证插件只能读写自己的记忆数据。
