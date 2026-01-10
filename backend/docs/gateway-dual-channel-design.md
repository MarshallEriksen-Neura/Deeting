# 网关内外部双通道设计

## 目标
- 内部网关（服务内部前端）与外部网关（第三方客户端）共用核心流程，但在鉴权、配额、暴露接口和风控上可配置分级。
- 所有上游路由、价格、限流均以 provider preset / provider preset item 为单一真源，避免硬编码。

## 分层与角色
- API 层：仅做入参校验、依赖注入、鉴权、调用 orchestrator/service，不直接触碰 ORM/Session。
- Orchestrator：按步骤执行完整链路（校验→路由→模板渲染→上游调用→响应转换→计费/日志），支持并行/重试/熔断配置。
- Service：承载业务规则、计费、风控、上下文处理；调用 Repository/Client。
- Repository：统一 ORM/DB 访问，隐藏表结构；禁止业务层直接写 SQL。
- Client：封装上游 HTTP/SDK（可使用 httpx + curl_cffi 传输等）。

## 内外通道差异
- 鉴权：
  - 内部：SSO/JWT + 角色，阈值宽松，可开放调试/管理接口。
  - 外部：API Key/HMAC + 时间戳/nonce，强制签名；可选子账户。
- 限流/配额：
  - 外部：rpm/tpm/每日总量、突发上限，按租户/ak；严格超限处理。
  - 内部：主要防异常流量，阈值高，可白名单。
- 计费与审计：
  - 外部：严格计费、余额扣减、用量记账。
  - 内部：以审计/告警为主，可选成本核算。
- 数据脱敏：
  - 外部：响应与日志脱敏（去除敏感 header/body）；
  - 内部：可保留更多调试信息。
- 功能暴露：
  - 实验/管理接口仅内部开放；公共推理/embeddings/上传等在外部受控开放。

## API Key 设计（内外区分）
- Key 类型：区分 Internal Key（服务间/内部前端）与 External Key（第三方租户）。可在存储中用 `type` 或前缀标识，避免混用。
- 生成与存储：仅保存哈希/摘要（可用全局 SECRET_KEY 做 HMAC），不落明文；记录创建人/租户、状态、过期时间、权限范围、限流配置、最近使用时间。
- 权限与范围：每个 Key 绑定 capability/model 列表或 scope 集合，外部 Key 默认为最小权限；内部 Key 可按环境/团队限定。
- 限流与配额：Key 级别存 rpm/tpm/日配额，与 provider preset 中的 limit_config 叠加取最严格值；外部 Key 必须配置，内部 Key 可选择性放宽或白名单。
- 绑定实体：外部 Key 绑定租户/应用/子账号；内部 Key 绑定服务角色（如前端/批处理任务），方便审计。
- 轮换与吊销：支持多活轮换（旧 Key 设为"即将过期"并保留短期可用窗口）；吊销立即生效并触发缓存刷新。
- 封禁联动：管理员封禁用户/租户时，同步将其所有 Access Token、Refresh Token 与关联的 API Key 置为失效（状态设为 revoked），并在缓存层标记，确保外部请求立即被拒绝；解除封禁需显式恢复 Key 状态。
- 请求校验：外部强制时间戳 + nonce + 签名（HMAC）；内部至少校验 Key + IP/网络来源；统一在依赖层校验并注入 `ApiPrincipal` 对象供后续限流/计费使用。
- 审计与告警：按 Key 记录请求量、费用/配额消耗、失败率；异常（爆量、重复 nonce、签名失败）触发告警和自动冻结策略（外部）。

### API Key 数据模型设计

#### 核心表：api_key

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 主键 |
| key_prefix | VARCHAR(8) | Key 前缀（如 `sk-ext-`、`sk-int-`），用于快速识别类型 |
| key_hash | VARCHAR(64) | Key 的 HMAC-SHA256 哈希（使用 SECRET_KEY） |
| key_hint | VARCHAR(8) | Key 末 4 位，便于用户辨识（如 `****abcd`） |
| type | ENUM | `internal` / `external` |
| status | ENUM | `active` / `expiring` / `revoked` / `expired` |
| name | VARCHAR(100) | Key 名称/描述 |
| tenant_id | UUID | 外部 Key 绑定的租户 ID（可选，仅 external） |
| user_id | UUID | 内部 Key 绑定的用户/服务账号 ID |
| created_by | UUID | 创建人 ID |
| expires_at | TIMESTAMP | 过期时间（NULL 表示永不过期） |
| last_used_at | TIMESTAMP | 最近使用时间 |
| revoked_at | TIMESTAMP | 吊销时间 |
| revoked_reason | VARCHAR(255) | 吊销原因 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### 权限范围表：api_key_scope

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 主键 |
| api_key_id | UUID | 关联 api_key.id |
| scope_type | ENUM | `capability` / `model` / `endpoint` |
| scope_value | VARCHAR(100) | 具体值（如 `chat`、`gpt-4`、`/v1/chat/completions`） |
| permission | ENUM | `allow` / `deny`（支持黑白名单） |

#### 限流配置表：api_key_rate_limit

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 主键 |
| api_key_id | UUID | 关联 api_key.id |
| rpm | INT | 每分钟请求数限制（NULL 表示无限制） |
| tpm | INT | 每分钟 Token 数限制 |
| rpd | INT | 每日请求数限制 |
| tpd | INT | 每日 Token 数限制 |
| concurrent_limit | INT | 并发请求数限制 |
| burst_limit | INT | 突发上限 |
| is_whitelist | BOOLEAN | 是否白名单（跳过全局限流） |

#### 配额表：api_key_quota

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 主键 |
| api_key_id | UUID | 关联 api_key.id |
| quota_type | ENUM | `token` / `request` / `cost` |
| total_quota | BIGINT | 总配额 |
| used_quota | BIGINT | 已用配额 |
| reset_period | ENUM | `daily` / `monthly` / `never`（一次性） |
| reset_at | TIMESTAMP | 下次重置时间 |

#### IP 白名单表：api_key_ip_whitelist

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 主键 |
| api_key_id | UUID | 关联 api_key.id |
| ip_pattern | VARCHAR(50) | IP 或 CIDR（如 `192.168.1.0/24`） |
| description | VARCHAR(100) | 描述 |

#### 使用统计表：api_key_usage（可选，或写入时序数据库）

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BIGINT | 主键 |
| api_key_id | UUID | 关联 api_key.id |
| stat_date | DATE | 统计日期 |
| stat_hour | SMALLINT | 统计小时（0-23） |
| request_count | BIGINT | 请求数 |
| token_count | BIGINT | Token 消耗 |
| cost | DECIMAL(18,8) | 费用 |
| error_count | BIGINT | 错误数 |

### API Key 生成与校验流程

```
生成流程:
1. 生成 32 字节随机数 → Base62 编码 → 加前缀 (sk-ext-xxx / sk-int-xxx)
2. 计算 HMAC-SHA256(key, SECRET_KEY) 存入 key_hash
3. 保存 key_hint = key[-4:]
4. 返回完整 Key 给用户（仅此一次可见）

校验流程:
1. 请求头提取 Key → 计算 HMAC-SHA256
2. Redis 缓存查询 gw:api_key:{hash} → 命中则跳过 DB
3. 未命中 → DB 查询 api_key WHERE key_hash = ?
4. 校验 status、expires_at、IP 白名单
5. 构造 ApiPrincipal 对象注入上下文
6. 回填 Redis 缓存 (TTL 5min)
```

### 外部请求签名校验（HMAC）

```
签名格式:
X-Timestamp: 1704067200
X-Nonce: abc123xyz
X-Signature: HMAC-SHA256(api_key, "{timestamp}.{nonce}.{request_body_hash}")

校验步骤:
1. 验证 timestamp 在 ±5 分钟窗口内
2. Redis SETNX 检查 nonce 去重（TTL = 10min）
3. 重算签名并比对
4. 失败计数，达阈值自动冻结 Key
```

## 配置与单一真源
- 在 provider preset/item 中增加 `visibility/channel`（internal/external）等字段，用于路由过滤；限流、pricing、template_engine、auth_config 都在此声明。
- Feature Flag/配置开关控制外部能力启停，无需发版。
- settings 中允许按 channel/tenant 读取默认限流、是否脱敏、是否记录请求体。

## 安全与风控
- 入站：外部强制签名 + 时间戳 + nonce；校验请求来源域名/上游白名单。
- 出站：剔除内部 header，限制重定向；上游域名白名单。
- 防刷与熔断：按租户/IP/User-Agent 组合限流；异常流量触发熔断/验证码/拒绝。
- 日志：统一 trace id；外部日志脱敏，不记录明文密钥或敏感 payload。

## 可观察性
- Orchestrator/Service 统一打点：耗时、状态码、重试次数、上游 RTT、token 用量/费用。
- trace id 贯穿入站→编排→上游→返回；错误码统一映射。

## 错误归因与审计（让用户看得见“谁出的问题”）
- 统一错误模型：响应体包含 `code`（网关标准码）、`source`（gateway/upstream/client）、`trace_id`、`message`、可选 `upstream_status`/`upstream_code`（脱敏）；确保用户知道是否为上游失败或网关拒绝。
- 透出可追踪信息：在响应和日志中返回同一 `trace_id`，用户可用此 ID 在审计面板查询详细链路（无需暴露内部 IP/密钥）。
- 审计数据存储：将每次请求的入口参数摘要、选路结果、上游地址、耗时、状态、重试次数、计费信息写入审计表/日志；敏感内容脱敏或仅存哈希。
- 用户可见审计界面（外部）：提供按时间/trace_id/租户/Key 查询的审计 API 或控制台页面，展示：请求时间、模型/能力、路由到的上游、上游状态码/错误、网关侧限流/鉴权结果、用量与费用。
- 内部运维面板：增加失败率分解（网关校验失败 vs 上游失败 vs 客户端取消）、关键指标（p95 延迟、上游超时率、重试率），支持按 provider/model 维度切片。
- 归因策略：遇到上游超时/5xx 时，返回网关标准错误码并在 `source` 标为 upstream，同时记录上游原始状态码；网关自身校验/限流/鉴权失败则 `source=gateway`；客户端取消/断开标记为 client。
- 告警与自愈：按 provider/model 的上游失败率和超时率设阈值触发告警；支持自动下线故障上游（权重置 0）并切换备用路由，同时在审计记录中标记“自动降级”。

### 多臂赌徒（Bandit）路由与降级策略
- 适用场景：存在多个可用上游/provider，质量与时延随时间波动；希望在保障 SLO 前提下自动探索更优上游，同时在异常时快速降级。
- 指标与奖励：可选择成功率、p95 延迟、成本（负向）、QoS（如上下文保真度）组合成奖励函数；失败/超时给予负奖励或直接视为 0。
- 算法选择：\n  - 简易：ε-greedy / UCB1，适用于少量上游、实现简单；\n  - 延迟敏感：Thompson Sampling（Beta 或高斯），可更快收敛；\n  - 约束条件：对超预算/超时的臂设置硬阈值过滤，再在剩余臂上做 bandit 选择。\n- 冷启动与探索：初始化阶段为各上游注入最小探索次数，避免权重为 0；生产环境 ε 可随时间或样本量递减。
- 数据收集：在 Orchestrator 中记录每次上游调用的奖励信号（成功/失败、延迟、费用），写入 Redis 短期聚合 + DB 长期存档；聚合周期内更新臂参数。
- 决策与执行：请求到达时先筛掉不可用/超阈值的上游，再用 bandit 算法选臂；选中的上游被调用并回写反馈。若所有臂均超阈值，触发降级/兜底（例如返回友好错误或调用本地简化模型）。
- 降级规则：当某臂连续失败率或超时率超阈值时，将其权重置 0 或暂时下线并进入冷却期；全局失败率升高时可提升 ε（加强探索）或切换到保守静态权重。
- 可观测性：在审计日志中记录每次选择的臂、ε/置信区间、奖励值；提供按 provider/model 的成功率、延迟、选择占比报表，便于人工复核。

## 旁路缓存与 Redis 设计（降低高频 DB 访问）
- 缓存对象：\n  - API Key / 租户权限与限流配置（含状态、scope、限速、过期时间）。\n  - Provider preset/item 路由决策结果（按 capability+model+channel 缓存可用上游列表）。\n  - 计费与配额快照（当次调用需的额度核验结果）。\n  - 限流/防刷计数器（RPM/TPM/突发桶、nonce 去重）。\n  - 审计查询加速：trace 摘要（状态、上游 provider、耗时）可短期缓存以减轻数据库压力。\n- Key 规划：使用前缀区分域：`gw:api_key:{id}`、`gw:preset:{cap}:{model}:{channel}`、`gw:quota:{tenant}`、`gw:rl:{tenant}:{route}`、`gw:nonce:{tenant}:{nonce}`；避免与业务缓存冲突。\n- TTL 策略：\n  - 配置类（preset、key 元数据）设置中等 TTL（如 5–15 分钟）并在写操作/封禁/轮换时主动失效。\n  - 限流计数器使用短 TTL（窗口长度）；nonce 去重 TTL 等于签名时效窗口。\n  - 审计摘要短 TTL（如 5 分钟），完整明细仍写数据库。\n- 一致性与失效：任何对 Key 状态、权限、路由的变更必须同步删除或刷新对应缓存；封禁/解封应先改 DB，再删缓存，再写 Redis 黑名单键确保即时生效。\n- 抖动与雪崩防护：TTL 加随机抖动；大列表查询使用分片键或 Bloom/Set 结构减少冷启动；必要时启用 single-flight/锁防缓存击穿。\n- 序列化与大小：使用 msgpack/JSON；大对象（如模板渲染结果）只缓存必要字段，避免超大 value。\n- 观察与告警：为关键缓存指标打点（命中率、填充失败、Redis RTT、拒绝数）；Redis 不可用时应降级为直查 DB 并快速返回错误码。\n- 隔离：与业务缓存同实例时必须分库或统一前缀；敏感数据（Key 摘要）不存明文，遵守哈希/脱敏策略。\n+
### 模型字段更新的缓存失效策略
- 触发场景：provider preset/item 中的模型相关字段变更（价格、限流、upstream_path、模板、可见性、权重、tokenizer 配置等）。
- 处理顺序：先持久化 DB → 删除相关缓存键/前缀（如 `gw:preset:*`、`gw:pricing:*`、`gw:quota:{tenant}`）→ 写入黑名单/版本号以防旧值复活。
- 冷启动再填充：下次请求 miss 后从 DB 读取最新数据并回填 Redis，确保用户立即读取新配置。
- 版本号策略：在缓存值中携带 `version` 或 `updated_at`，查询时比对，变更时递增/更新时间戳，避免并发下旧值覆盖新值。
- 批量变更：批量更新多个模型时优先用前缀失效或标记全局配置版本 `gw:cfg:version`，读取时对比版本不一致则强制重载。
- 并发保护：miss 时对单 key 使用短期分布式锁/单航班，防止击穿；锁超时应短且带重试。

### 缓存 Key 失效清单与矩阵（避免遗漏）
- 维护“Key 注册表”：在配置文件或常量模块（如 `app/core/cache_keys.py`）集中定义所有 Redis key/prefix，禁止在业务处散落字符串字面量，便于统一失效。
- 事件→Key 矩阵：为每类变更列出必须失效的 key 列表，作为代码与发布 checklist：
  - ProviderPreset 结构/可见性/权重更新：`gw:preset:{cap}:{model}:{channel}`，`gw:preset:list:{channel}`，`gw:routing:{cap}:{channel}`，若涉及价格/限流同步失效 `gw:pricing:{preset}`、`gw:limit:{preset}`。
  - Pricing/Limit 变更：`gw:pricing:{preset}`，`gw:limit:{preset}`，`gw:quota:{tenant}`（确保下次额度校验刷新），相关路由缓存 `gw:preset:{cap}:{model}:{channel}`。
  - 模板/上游路径更新：`gw:preset:{cap}:{model}:{channel}`，`gw:upstream_tpl:{preset_item}`。
  - API Key 状态/权限/封禁变更：`gw:api_key:{id}`，`gw:api_key:list:{tenant}`，黑名单键 `gw:api_key:revoked:{id}`。
  - 租户额度或配额更新：`gw:quota:{tenant}`，`gw:pricing:{preset}`（若单价变更），限流键按需重置 `gw:rl:{tenant}:*`。
  - 全局配置版本变更：`gw:cfg:version`（递增）；读取侧若检测版本不一致，强制重载并回填缓存。
- 失效实现：封装通用函数 `invalidate_keys(events: list[str], context)`，按事件枚举失效目标，避免在业务代码中手写 key；批量删除支持通配前缀扫描（注意控制扫描大小）或使用版本号方案减少删除开销。
- 发布前检查：在变更评审/PR 模板中增加“缓存失效覆盖”项，要求列出受影响的事件与 key；上线脚本可在迁移后调用失效函数。

## 其他易漏设计点
- 租户/Key 公平性：全局资源采用双层限流（per-tenant/ak + global bucket），防止单租户占满带宽；队列亦需按租户权重隔离。
- 压测与容量：分别为主流程与降级路径做基线压测，记录各 provider 吞吐、p95/99、超时率与成本；变更后跑对比。
- 灰度与回滚：路由策略、bandit 参数、价格/限流变更走版本化配置，支持按租户/百分比灰度；出现异常可一键回滚到上一版本。
- 幂等与重试：为可能被重放的请求定义幂等键与去重窗口（可用 Redis SETNX/TTL），避免重复扣费；重试语义在审计中标注。
- 数据留存与合规：审计/请求摘要设定保存周期与脱敏规则；支持导出与删除（满足合规要求）。
- 成本与告警阈值：为上游成本、失败率、RTT 设置多级告警；计费异常（费用突增/为负）单独报警并可自动暂停扣费。
- 时钟与签名：依赖时间戳的签名/限流需有 NTP 校时与漂移容忍；时钟异常时可暂时放宽窗口并发出告警。
- Schema 演进：API/DTO 的前后向兼容策略，旧字段保留周期，利用 feature flag 控制新字段返回；DB 迁移需先加字段再切换读写，完成后清理旧字段。
- 自助与可视化：外部用户的健康面板/trace 查询，展示主要上游可用性、错误分布和最近的降级/切换记录，减少“全怪网关”的误解。
- 安全边界：明确不支持的请求类型（超大文件直传等）并早返回；管理/调试接口需 IP+角色双重限制。

## 必备保障项
- SLO/SLI：明确可用性、p95/99 延迟、错误率、上游超时率等目标，告警与降级阈值配置化。
- 熔断与隔离舱：对上游设置熔断阈值与舱壁隔离（连接池/线程池/队列），半开探测恢复，避免单 provider 拖垮全局。
- 背压与超时：入口统一超时与最大并发/队列长度，超限快速失败或降级，返回可识别过载错误码。
- 大小限制：请求体/流式帧/响应大小上限，超限要求分页或异步回调，防止内存/带宽占用。
- 安全基线：输入校验、内容过滤（防 prompt/SQL 注入）、出站域名白名单、DNS 缓存策略，禁止明文敏感信息回显。
- Secrets 管理：上游凭证使用引用 ID + 密钥管理存储与轮换，轮换后同步缓存失效。
- 混沌与演练：定期注入故障/延迟，验证熔断、降级、bandit 切换与告警链路，记录演练结果。
- 运行手册：常见故障排查与缓解步骤（下线上游/调整 ε/切换静态权重）、联系人与升级路径。
- 合规与数据驻留：日志/审计留存周期、脱敏与存储区域限制，满足地域/行业要求。
- 变更保护：配置/策略变更的前后对比校验、灰度发布与快速回滚（版本化配置 + 开关），变更期间监控关键指标并可一键恢复。

## 编排框架设计（如何把复杂能力落地）
- 定义层（DAG/步骤声明）：用声明式配置（DB/provider preset/JSON）描述步骤列表、依赖、超时、重试、所需上下文字段；支持版本化与灰度。
- 步骤注册表：每个原子步骤实现统一接口（如 `name/depends_on/execute(ctx)`），集中注册，禁止在路由里用 if/else 手写分支。
- 执行引擎：拓扑排序 + 并行执行；无依赖步骤用 `asyncio.gather`，失败时按错误类型决定重试、跳过或降级（兜底响应/切换上游）。
- 上下文管理：`WorkflowContext` 统一承载请求元数据、租户/Key、选路结果、计费、trace_id；步骤在各自命名空间读写，避免键冲突。
- 配置驱动：不同通道（internal/external）、租户或能力绑定不同编排模板，Feature Flag 控制切换与灰度发布。
- Bandit 集成：在“路由决策”节点调用 bandit 选择臂，并将成功率/延迟/成本反馈回写以实时调节权重。
- 横切中间件：编排前后挂中间件链（限流、签名校验、日志脱敏、审计快照），与业务步骤解耦。
- 幂等与去重：入口处理幂等键/去重窗口（Redis），避免重复扣费或重复副作用；重试需标注在审计中。
- 观测与审计：步骤开始/结束打点耗时、状态、重试次数、选中上游，统一 trace_id；错误归因 `source` 由编排器设置。
- 目录落地：建议放置 `app/services/orchestrator`（引擎）与 `app/services/workflow/steps/*`（步骤），便于扩展。

### Redis 特性与模式利用
- 数据结构选型：\n  - 计数/限流：`INCRBY` + `EXPIRE` 或 Lua 实现漏桶/令牌桶；需要精准窗口可用 `PFADD`/`HLL` 估计去重。\n  - 去重/nonce：`SET key value NX EX ttl`；大量 nonce 可用 `BITSET`/Bloom Filter 防爆内存。\n  - 路由/配置缓存：`HASH` 或 `JSON`（若启用 ReJSON 模块），便于部分字段更新；或直接存序列化字符串。\n  - 排队/重试：`LIST`/`STREAM`（适合事件流和消费者组）记录失败请求、异步补偿任务。\n- 管道与批量：批量读写使用 pipeline/`MGET`/`MSET`，减少 RTT；缓存失效批量删除时用 pipeline + `UNLINK` 避免阻塞。\n- 过期策略：使用 `EX` + 随机抖动，避免同一时刻大规模过期导致抖动；对热点 key 可采用逻辑过期 + 后台刷新。\n- 原子性：使用 Lua 脚本封装复合操作（如限流计数 + 返回剩余额度），避免竞态；脚本需设置合理超时并注意可观测性。\n- 分布式锁：仅在需要的场景使用（缓存击穿 single-flight）；优先短 TTL + `SET NX PX`，避免长锁；不可用锁做业务互斥。\n- 观测：开启 `latency monitor`/`slowlog` 阈值告警；对关键操作打 metrics（hit/miss、RTT、fail、命令分布）。\n- 内存与淘汰：选择合适的 `maxmemory-policy`（推荐 `volatile-lru` 或 `allkeys-lru` 视业务）；大值分片或压缩，定期巡检 big keys。\n- 高可用：生产环境使用主从 + 哨兵或集群；应用侧配置短超时、重试和降级路径（直接查 DB 或返回可识别错误码）。\n- 安全：启用 ACL/密码、网段隔离；禁止在生产用 `FLUSHALL`，运维脚本使用精确 key/prefix；敏感数据不存明文。\n+
## 流程示例（可配置步骤）
1) 入参校验（schema + 签名/JWT）。
2) 配额/额度检查（外部必选）。
3) 路由决策：按 capability+model 选择 provider preset item，按 priority/weight 排序。
4) 模板渲染：根据 template_engine 渲染 upstream_path/body。
5) 上游调用：带超时/重试/限流；支持流式响应。
6) 响应转换：字段映射、错误码翻译、脱敏。
7) 计费与日志：记录 token/费用（外部），审计（内部）。
8) 返回统一 DTO。

## 异步任务与 Celery 配置指引
- 适用任务：长耗时或可延迟操作（大文本/音视频处理、批量推理、账单结算、外部回调推送、报表生成、重试型上游调用、日志/指标批量写入）。
- Broker/Backend：推荐 Redis（broker + result_backend）；若与缓存共用实例需分库/前缀隔离；高可靠可选 RabbitMQ + Redis 结果存储。
- 结构：`app/celery_app.py` 定义 Celery 实例与公共配置；任务按领域放 `app/tasks/*.py`（如 `tasks/billing.py`, `tasks/async_inference.py`）。
- 配置要点：\n  - 环境变量 `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` 由 `app/core/config.py` 读取，`.env.example` 同步。\n  - `task_default_queue` 区分内/外/计费队列；`task_routes` 将任务分发至 `internal`, `external`, `billing`, `retry` 等队列。\n  - `task_annotations` 控制超时与重试：如 `autoretry_for=(HTTPError,) max_retries=3 retry_backoff=True retry_jitter=True`，计费任务可设 `rate_limit`。\n  - 并发：IO 任务可提高 `worker_concurrency` 与 `prefetch_multiplier`；CPU 任务视情况用 `-P solo` 或进程池，避免阻塞事件循环。\n  - 可靠性：开启 `task_acks_late=True` 与 `task_reject_on_worker_lost=True`，防止任务丢失。\n- 调用模式：Service 内封装异步任务提交 `task.delay(...)`/`apply_async(...)`；API 立即返回并提供 task_id 查询，结果查询可用状态接口或 webhook 回调。\n- 监控：开启 `task_send_sent_event=True`，结合 Flower/Prometheus 观测任务状态、耗时、失败率；关键任务写审计日志。\n- 安全：外部触发的任务在 worker 侧再次校验租户/Key，不在任务参数中传明文密钥，改传引用 ID。\n- 部署：提供 `celery -A app.celery_app worker -Q internal,external,billing -l info` 以及可选 `celery beat`（周期任务）；Docker Compose 增加 worker 与 flower 服务。\n\n
## 测试策略
- 单元：编排拓扑、错误/重试分支、限流与计费逻辑。
- 合成：外部租户全链路（成功、额度不足、签名错误、上游超时）；
- 冒烟：内部前端核心路径。

## 落地建议顺序
1) 拆分内/外 API 前缀与路由注册（或通过前缀区分）。
2) 扩展 provider preset 增加可见性字段并在路由查询中使用。
3) 实现/接入 Orchestrator，步骤化执行链路。
4) 下沉 API 中的仓库/ORM 直访到 Service。
5) 补充外部签名校验、租户限流、日志脱敏。
6) 补文档与测试（`docs/api`、`tests/`）。
