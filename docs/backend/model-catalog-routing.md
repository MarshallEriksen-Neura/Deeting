# 模型目录与路由分层设计（Catalog / Runtime）

## 背景
- 现有执行层（`provider_preset` / `provider_preset_item`）直接存储上游需要的 `model` 字符串，路由时按等值匹配。
- 已有展示层表 `public_model` 与 `provider_preset_item.unified_model_id` 字段，但当前未被查询/路由实际使用，`/v1/models` 仍直接从 item 聚合。
- 目标：引入“展示层 Catalog + 执行层 Runtime”双层分离，既保持上游多样性，又给用户稳定的统一模型 ID 与属性。

## 设计目标
- **解耦上游标识**：上游 `model` 作为路由参数留在执行层，不与展示层强外键绑定。
- **统一对外 ID**：`public_model.model_id` 作为用户可见的逻辑模型 ID，可映射到多条 provider preset item。
- **灵活路由**：支持按 `unified_model_id` 聚合多渠道（OpenAI/Azure/Bedrock 等），可调权重、优先级、灰度。
- **安全下线/降级**：调整权重或禁用 item 即可切流，用户无感；展示层可暂存“隐藏”模型（`is_public=False`）。

## 数据模型
### 展示层：`public_model`
- 字段：`model_id`（唯一、对外 ID）、`display_name`、`family`、`type`、`context_window`、`description`、`icon_url`、`input_price_display`、`output_price_display`、`sort_order`、`is_public`。
- 用途：提供前端可浏览的模型目录与文案/价格信息；不存上游调用细节。

### 执行层：`provider_preset_item`
- 关键字段：`capability`、`model`（上游真实参数）、`unified_model_id`（逻辑关联到 `public_model.model_id`）、`upstream_path`、`pricing_config`、`limit_config`、`weight`、`priority`、`visibility`、`channel`。
- 关系：无外键约束，`unified_model_id` 仅作逻辑映射，允许同一逻辑模型映射到多个上游部署。

## 路由与接口行为
1) **模型列表** `/v1/models`
   - 数据源切换到 `public_model`，过滤 `is_public=True`，按 `sort_order`/`display_name` 返回。
   - 兼容字段：继续输出 `{id, object="model", owned_by="gateway"}`，其中 `id=public_model.model_id`。

2) **路由选择**
   - 请求中的 `model` 视为逻辑模型 ID。优先按 `unified_model_id == requested_model` 选取 item；若找不到，回退到 `model == requested_model` 兼容旧行为。
   - 负载策略（权重/优先级/灰度/bandit）沿用现有 `RoutingSelector`，仅输入筛选条件变化。

3) **可见性与通道**
   - 外部通道仅使用 `visibility in {public, shared}` 且 `channel in {external, both}` 的 item。
   - 内部通道可使用 `private` item。

## 迁移与落地步骤（建议）
1. **接口对齐**：修改 `/v1/models`（内外部路由）改读 `public_model`。
2. **路由查询改造**：`ProviderPresetItemRepository.get_by_capability` 支持 `unified_model_id` 参数并先查之；`RoutingSelector` 调用更新。
3. **数据填充**：
   - 补齐 `public_model` 初始种子数据（OpenAI/Azure/B edrock 常用模型）。
   - 为现有 `provider_preset_item` 填写匹配的 `unified_model_id`（可与 `model` 相同作为初始值）。
4. **管理入口**（后续）：增补内部管理 API / CLI 用于维护 `public_model` 与映射关系。
5. **测试**：新增/更新用例覆盖：
   - `/v1/models` 返回顺序与过滤。
   - 路由在有/无 `unified_model_id` 时的回退逻辑。
   - 外部通道只选 public/shared 的约束。

## 不采用外键的理由
- 上游同名不同物（OpenAI gpt-4 vs Azure deployment）、定价/RPM 差异，强外键难以表达。
- 允许多个异构上游映射到同一逻辑模型 ID（AB 测、灾备）而无需拆行。
- 便于为“虚拟”模型（如营销别名）做映射，不要求上游存在同名实体。

## 风险与缓解
- **数据未填充**：若 `unified_model_id` 为空，将回退旧逻辑，保障兼容；需补数据以发挥新设计优势。
- **目录/路由不一致**：通过管理 API 或离线校验任务定期比对 `public_model` 与 `provider_preset_item` 的映射覆盖率。
- **性能**：路由查询仍依赖缓存；新增的 `unified_model_id` 过滤可复用现有索引。

## 重构阶段的兼容性说明
- “兼容”指防止在切换到双层模型目录/路由时影响现网请求，并非当前存在兼容性问题。
- 旧客户端仍可能传上游原始 `model` 值；因此路由需在 `unified_model_id` 未匹配时回退按 `model` 等值匹配。
- 已发行的 API Key、既有 `provider_preset_item` 数据不含新字段/Scope 时，应保持旧行为；新增 provider/preset 限制或模型目录映射时，再启用更细粒度控制。
- 路由候选使用缓存，新增过滤条件（如按 provider/preset/preset_item）时必须写入缓存键，避免权限/可见性串用。
