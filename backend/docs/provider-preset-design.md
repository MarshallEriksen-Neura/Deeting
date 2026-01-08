# Provider Preset 设计与功能规划

## 背景与目标
- 解决旧架构中“字段散落 + 多处耦合”导致的改动雪崩，建立单一契约与分层边界。
- 通过 Provider Preset（预设）抽象，将上游厂商/能力/模型的配置集中管理，避免在 handler/transport/billing 里各自硬编码。
- 两张表：`provider_preset`（主表，描述一个预设及其通用配置），`provider_preset_item`（子表，描述预设下具体 capability/model 的路由与参数）。

## 功能范围（首期）
- 创建/查看/编辑/禁用 Provider 预设。
- 为同一预设下的不同 capability 或模型配置独立路由与参数（子表），支持权重/优先级。
- 仅支持 HTTP 单通道上游（后续可扩展），所有调用按预设→子表→上游 client 的固定流程。
- 统一错误码、日志字段与请求/响应 schema，避免字段漂移。

## 适用范围（对外网关 + 对内服务）
- 对外：统一 API 网关（供前端/第三方）按 capability 路由到对应预设项，支持聊天、图片生成、TTS、embedding 等。
- 对内：内部服务/任务（如系统触发的聊天、批量生图、评测任务）同样通过预设查表，不再绕过网关直接写死上游配置，确保配置真源一致。
- 效果：无论外部请求还是内部作业，均复用同一套 provider_preset / provider_preset_item 数据，避免双轨配置漂移。

## 数据模型

### 表：provider_preset（主表）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | 主键 |
| name | varchar(80) | unique | 预设名称（展示用） |
| slug | varchar(80) | unique, not null | 机器可读标识，供路由引用 |
| provider | varchar(40) | not null | 上游厂商/驱动名称（如 `openai`, `anthropic`） |
| base_url | varchar(255) | not null | 上游基础 URL |
| auth_type | varchar(20) | not null, enum(`api_key`,`bearer`,`none`) | 认证方式 |
| auth_config | jsonb | not null, default '{}' | 认证配置（如 header 名称、token 前缀、密钥引用字段） |
| default_headers | jsonb | not null, default '{}' | 通用 Header 模板（可含占位符） |
| default_params | jsonb | not null, default '{}' | 通用请求体参数默认值 |
| version | int | not null, default 1 | 乐观锁，避免并发覆盖 |
| is_active | bool | not null, default true | 启用/停用 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

> 说明：能力列表以子表 `capability` 为唯一权威来源，主表不再存缓存字段，避免漂移。

### 表：provider_preset_item（子表）
| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | 主键 |
| preset_id | uuid | FK -> provider_preset.id, on delete cascade | 所属预设 |
| capability | varchar(32) | not null | 该模型线路的能力类型：`chat`,`embedding`,`tts`,`vision` 等（权威字段，主表只作缓存展示） |
| subtype | varchar(32) | null | 可选子类型（如 text-generation 下的 chat/completion） |
| model | varchar(128) | not null | 上游实际需要的模型标识/部署名（执行层，给上游 API 用） |
| unified_model_id | varchar(128) | null, index | 逻辑层统一模型 ID（映射到 public_models.id，用于前端/路由入口一致化） |
| upstream_path | varchar(255) | not null | 请求路径（相对 base_url），允许占位符（如 `/deployments/{{model}}/chat/completions`） |
| template_engine | varchar(32) | not null, default 'simple_replace' | 模板引擎类型：`simple_replace` / `jinja2` |
| request_template | jsonb | not null, default '{}' | 请求体模板/映射规则（占位符与默认参数） |
| response_transform | jsonb | not null, default '{}' | 响应变换（字段重命名/抽取规则） |
| pricing_config | jsonb | not null, default '{}' | 计费配置：`input_price_per_1k`、`output_price_per_1k`、`currency` 等 |
| limit_config | jsonb | not null, default '{}' | 限流/超时/重试：`rpm`、`tpm`、`timeout_ms`、`retry`（次数/退避） |
| tokenizer_config | jsonb | not null, default '{}' | 计费/限流所需的 tokenizer 或计数方式 |
| visibility | varchar(16) | not null, default 'private' | 可见性：`private` / `public` / `shared` |
| owner_user_id | uuid | null | 私有/共享项的拥有者（权限与审计） |
| shared_scope | varchar(32) | null | 共享作用域：`org` / `project` 等（可选） |
| shared_targets | jsonb | not null, default '[]' | 共享对象列表（org_id / project_id / user_id） |
| weight | int | not null, default 100 | 负载分配权重（同 capability/model 下多路时使用） |
| priority | int | not null, default 0 | 回退优先级，数字越大优先 |
| is_active | bool | not null, default true | 启用/停用 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 关系与索引
- 唯一约束：`provider_preset_item (preset_id, capability, model, upstream_path)`，防重复。
- 索引：
  - `provider_preset (slug)` 用于路由快速定位。
  - `provider_preset_item (preset_id, capability)` 覆盖查询。
  - 如需按启用态过滤，增加 `is_active` 部分索引。
- 级联删除：删除预设自动删除其子项，避免脏数据。

## 调用链与分层（避免耦合）
1) API 层：仅做校验 -> 调用 Service，输入/输出绑定统一 DTO（不可直改 ORM 模型字段）。
2) Service 层：
   - 读取 ProviderPreset + Items，决策路由与参数合成。
   - 处理额度/计费（如需要），再调上游 Client。
3) Client/Adapter 层：将合成后的请求落到 HTTP client，封装重试/限流。
4) Repository 层：集中数据库读写；业务层不可直接使用 ORM session。
5) 统一异常：`DomainError`→422/400，`NotFound`→404，`UpstreamError`→502，确保错误码稳定。

## 配置与契约
- 单一真源：所有上游字段/路径/认证信息仅存于两张表，不允许在 handler/transport 中硬编码。
- Schema 契约：
  - 输入：`ProviderPresetCreate/Update`，`ProviderPresetItemCreate/Update`（包含 jsonb 字段的结构定义）。
  - 输出：统一 `ProviderPresetDTO`，隐藏敏感字段（如密钥）。
- 变更流程：新增字段 → 更新 DTO + Pydantic schema → 增加测试 → 才能修改 Service/Repository，禁止直接改 handler。
- 可见性与权限：`provider_preset_item` 支持 `visibility`（private/public/shared）及 `owner_user_id`、`shared_scope`、`shared_targets`；官方/平台级预设在主表，用户共享的是子表项。缓存/查询必须带可见性过滤，避免暴露私有/共享数据。
- 模型分层：`model` 存上游真实参数；`unified_model_id` 逻辑映射到公共模型目录（public_models），前端只暴露统一 ID，执行层可自由切换上游线路。

## AI Agent 自动填充（数据抓取 → 预设入库）
- 方向：保持“由 AI Agent 抓取上游元数据并填充 provider_preset / provider_preset_item”的流程不变，但把写入口限制在 Service + Repository，确保契约稳定。
- 抓取来源：官方 OpenAPI/Swagger 文档、厂商模型列表 API、静态文档页。Agent 只生成结构化 metadata，不直接写业务代码。
- 处理流程（建议）：
  1) Agent 把原始抓取结果落到 `provider_metadata`（临时表或 JSON 文件），字段包括 provider、capability、model、endpoint、request/response schema 片段、限流/定价提示等。
  2) 一个“元数据→预设”转换器（服务层脚本）将 metadata 规范化为 `provider_preset` + `provider_preset_item` 结构：按 capability 分桶，填充 `upstream_path`、`request_template`、`response_transform`、`pricing_config`、`limit_config`。
  3) 人工或自动校验：必填字段校验、capability 枚举校验、重复冲突检测（unique 约束）。
  4) 通过 API（或管理脚本）批量写入两张表；写入过程中统一走乐观锁和唯一约束，避免脏数据。
- 安全与幂等：
  - Agent 不能直接写密钥；`auth_config` 仅引用密钥 ID/名称。
  - 同一 provider/capability/model 重复抓取时，转换器使用 `slug + model + capability` 作为幂等键，必要时增量更新 `version` 字段。
- 可观测性：记录抓取时间、来源 URL、转换结果摘要与失败原因，方便回溯。

## API 草案（管理侧）
- `GET /admin/provider-presets`：列表（可按 provider/capability 过滤）。
- `POST /admin/provider-presets`：创建主表 + 可选子项。
- `GET /admin/provider-presets/{slug}`：详情（含子项）。
- `PUT /admin/provider-presets/{slug}`：更新主表。
- `POST /admin/provider-presets/{slug}/items`：新增子项。
- `PUT /admin/provider-presets/{slug}/items/{item_id}`：更新子项。
- `DELETE /admin/provider-presets/{slug}/items/{item_id}`：软删/禁用（建议 `is_active=false`）。

## 迁移与数据策略
- Alembic 迁移：创建两表 + 索引 + 级联外键；后续字段变更必须伴随迁移与回填脚本。
- 秘钥管理：`auth_config` 存储引用（如 secret_id/header 名称），实际密钥由现有密钥表或密钥服务管理，避免明文分布。
- 幂等写：更新接口使用 `version` 乐观锁；冲突返回 409，客户端重试需带最新版本。

## 测试与回归
- Repository 层：CRUD + 级联删除 + 唯一约束冲突用例。
- Service 层：
  - 路由决策：同 capability 多子项时按权重/priority 选择。
  - 配置合成：默认 header/params 与子项模板的覆盖规则。
  - 乐观锁冲突、禁用状态、缺失子项的错误路径。
- API 层：schema 校验、分页/过滤、敏感字段不外泄。

## 未决事项（需确认）
- pricing_config 与 limit_config 的字段细粒度（按 token 还是按请求计费）。
- auth_config 是否需要统一引用密钥表的 `secret_id` 字段。
- capability 枚举的完整列表及是否需要自定义扩展字段。

## 进一步落地建议
- Metadata 临时表：新增 `provider_metadata`（或物化视图），字段包含 provider、capability、model、endpoint、schema_snippet、rate_limit_hint、pricing_hint、source_url、fetched_at、content_hash；用 content_hash 做幂等比对与变更检测。
- 映射规则可配置：将 “metadata → preset item” 的字段映射、默认参数覆盖、路径拼接写成独立的 mapping 配置（JSON/YAML），避免脚本硬编码，方便随官方文档调整。
- Schema 校验与快照：抓取后对 request/response 片段做 JSON Schema 校验，并存压缩快照，便于对比官方更新与选择性回归测试。
- 分级发布：按 capability 分批启用（内部灰度 -> 外部公开），灰度期间标记 preset item 状态，仅允许内部流量。
- 观测与告警：对 preset item 记录成功率、上游 4xx/5xx、超时、重试次数；阈值告警快速定位具体 provider/model。
- 乐观锁与重试：409 返回最新 version，客户端/Agent 侧带 If-Match 或 version 重试，避免覆盖写。
- 敏感信息治理：auth_config 只存密钥引用 ID；DTO 统一脱敏；管理 API 与 Agent 写接口需鉴权分级。
- 回滚策略：为 preset/item 记录历史版本或 previous_version，出现上游变更导致故障时可快速回滚。
- 测试基线：为各 capability 建立模板填充、路由决策、响应转换、限流/重试的合成测试，CI 里用模拟上游跑，防止字段漂移回归。
- 模板与路径占位符：新增 `template_engine` 与占位符化 `upstream_path`，统一用渲染器生成最终请求体/路径，减少 provider 特判。
- 计费与限流细化：`pricing_config` 约定 input/output per 1k token + currency；`limit_config` 约定 rpm/tpm/timeout/retry。
- Tokenizer 配置：`tokenizer_config` 记录计数方式，为计费/限流提供统一 token 计算。
- schema 快照与 hash：抓取后保存 schema hash，发现上游变更时告警并触发回归。
- 模型目录分层：新增展示层表 `public_models`（不做外键），字段含 id、display_name、family、type、context_window、description、icon_url、input/output_price_display、sort_order、is_public。`provider_preset_item.unified_model_id` 逻辑映射到该表，支持同一统一模型映射多条上游线路（AB/灾备）。

## 数据库访问策略（异步主路，Celery 同步）
- 业务/API：默认使用 Async SQLAlchemy（AsyncEngine + AsyncSession），配合 FastAPI 全链路异步，Repository 提供异步接口。
- Celery 任务：使用同步 Engine/Session，避免事件循环冲突；共用同一 ORM 模型与连接串，分开 engine/session factory。
- 封装：在 Repository 层提供 async 版本与 sync 版本的会话工厂（或 Unit of Work），对上暴露同名接口，内部选择对应实现，避免业务层感知差异。
- 事务边界：API 层请求内由依赖注入管理 async session 生命周期；Celery 任务内显式上下文管理 sync session，必要时使用短事务分段提交，防止长事务阻塞。

## 指标设计（gateway_logs 真源 + 聚合表）
- 真源表 `gateway_logs`（按月/日 Range 分区 + BRIN created_at）：字段 id(uuid)、user_id、preset_id、model、status_code、duration_ms、ttft_ms、input_tokens、output_tokens、total_tokens、cost_upstream、cost_user、is_cached、error_code、created_at。索引 user_id/preset_id/status_code；写入通过异步队列/Celery 批量落盘。
- 用户聚合 `stats_user_daily`：date、user_id、total_requests、total_tokens、total_cost、error_count、avg_latency；定时从 gateway_logs 聚合，用于账单/配额/体验展示。
- 上游健康 `stats_provider_health`（分钟级）：bucket_time、preset_id、total_requests、success_count、client_error_count、server_error_count、p95_latency、p99_latency；驱动熔断/降级与告警。
- 财务大盘 `stats_finance_monthly`：month、gross_revenue(sum cost_user)、cogs(sum cost_upstream)、margin、token_burn_rate。
- 关键指标与标签：Error/Throttling Rate、TTFT、p95/p99、RPM/TPM、Cache Hit Rate、Unit Margin；标签控制在 capability/provider/model/preset_slug/transport/status_class，禁止高基数 user_id 进实时指标。
- 告警建议：上游 5xx/timeout 突升、p99 超阈、重试率飙升、TTFT 异常。
- 变更与测试：新增字段需同步 Schema/迁移 + 合成测试（日志写入与聚合正确性）；对分区查询与批量写入做基线压测。

## 访问控制与授权
- 复用现有用户/角色/权限表（user、role、permission、user_role、role_permission），若有 org/project/tenant 维度，优先用作共享范围。
- 策略接口：统一通过策略函数/依赖（如 `can_use_item(user, item)`）检查 `visibility`（private/public/shared）、`owner_user_id`、`shared_scope`、`shared_targets`，避免在 handler 分散判断。
- 可见性规则：  
  - `private`：仅 owner（或具备管理员权限的用户）可见/可用。  
  - `shared`：按 `shared_scope/shared_targets` 校验（org/project/user 列表）。  
  - `public`：所有认证用户可见；是否允许匿名由全局策略决定。  
- 缓存与脱敏：权限/可见性结果可缓存（Redis ACL），返回前端需脱敏，不暴露密钥或内部权限细节。
- 审计：创建/分享/禁用 preset_item，变更 visibility 或角色时写审计日志。
- 测试清单：私有拒绝、共享命中、公共可见、禁用拒绝、跨 tenant 拒绝、管理员放行。
