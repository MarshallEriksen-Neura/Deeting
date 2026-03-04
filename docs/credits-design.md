# 积分与计费设计草案

## 背景与目标
- 为用户/组织提供可审计的积分余额管理与消费记录，支撑网关高并发计费。
- 在低延迟主链路下保持计费准确性，允许后移到异步队列，不阻塞请求。
- 长期可扩展：教育/组织场景、促销赠送、退款补差、不同币种与模型计价。

## 范围（MVP → 增量）
- MVP：账户余额表、按月分区的流水表、请求幂等扣减、Celery 异步计费、日聚合表。
- 增量：额度冻结/预授权、冷数据归档（S3/OSS+Parquet）、多币种、配额上限、发票/对账导出。

## 数据模型

### 账户表 `credit_account`
| 字段 | 说明 |
| --- | --- |
| id (bigserial/uuid) | PK |
| owner_type (enum: user/org) | 账户主体类型 |
| owner_id | 主体 ID（FK 到 user/org） |
| balance numeric(20,6) | 可用余额 |
| frozen numeric(20,6) | 冻结金额（退款/争议） |
| currency varchar(8) | 币种，默认 CNY |
| version int | 乐观锁 |
| updated_at timestamptz | 更新时间 |

- 唯一索引：`(owner_type, owner_id)`；写入用乐观锁或 `FOR UPDATE`。

### 流水父表（按月分区）`credit_ledger`
| 字段 | 说明 |
| --- | --- |
| id (bigserial/uuid) | PK |
| account_id | FK -> credit_account.id |
| owner_type / owner_id | 冗余便于查询 |
| change_amount numeric(20,6) | 正入账/负扣减 |
| balance_after numeric(20,6) | 变动后的余额 |
| reason enum | `gateway_usage`, `manual_adjust`, `refund`, `promo`… |
| request_id varchar(64) | 幂等键（网关请求唯一） |
| source_model varchar(128) | 上游模型/套餐标识 |
| meta jsonb | 计价明细、token 数等 |
| created_at timestamptz | 分区键 |

- 分区：`RANGE (created_at)` 按月或季度；父表仅定义索引/约束。
- 索引：`(account_id, created_at DESC)`，`(request_id)` 唯一。
- 写入模式：只 INSERT，不 UPDATE/DELETE，保持审计。

### 日聚合表 `credit_ledger_daily`
| 字段 | 说明 |
| --- | --- |
| stat_date date | 统计日期 |
| account_id | 账户 |
| owner_type / owner_id | 主体 |
| total_spent / total_granted numeric | 当日支出/入账 |
| usage_count int | 计费次数 |
| last_request_id | 最近一次请求 |
| created_at / updated_at | 记录时间 |

- 生成：Celery 定时任务按小时/日增量聚合；可选物化视图 + 并发刷新。

## 膨胀治理
- 热数据留近 6–12 个月分区，老分区 DETACH 导出至冷存储（Parquet）保审计。
- 仅保留必要索引（account+time，request_id）；归档后删除冗余索引减写放大。
- 可结合 Timescale/pg_partman 做分区管理与压缩；定期 VACUUM 父表。
- 高频账户在网关侧限流，Celery 批量 INSERT（100–500 条/事务）降低 WAL 压力。

## 网关计费流程
- **预检**：网关读 Redis/短 TTL 缓存的账户快照判断余额是否足够，避免无谓上游调用。
- **异步扣减（推荐）**：网关发起 Celery 任务 `{request_id, owner, model, token_usage, cost}`，立即继续转发上游；worker 幂等扣减余额并写分区流水，失败可重试。
- **同步扣减（备用）**：直接在请求链路扣减余额 + 写流水，RT 变长但一致性最强；可用于内网或关键付费场景。
- **补差/回滚**：上游实际消耗与预估不符时写正/负补差流水；退款/拒付走 `reason=refund`。

### 流式 / 非流式计费差异
- **非流式（一次性响应）**：在上游响应后统一统计 `input_tokens` + `output_tokens`，按模型定价直接落单次流水。
- **流式（SSE/逐段推送）**：
  - 计费时机：建议“先预估、后结算”。网关收到首包前根据请求体与模型定价预估最大费用并做余额预检；Celery 任务在流结束后根据上游返回的最终 token 计数/usage header 做补差或回滚多扣。
  - 计数方式：优先使用上游返回的 `usage` 字段；若上游不提供，需在客户端累积 delta tokens 或回退到提示+输出估算，标记低置信度并写入 `meta.confidence`。
  - 失败中断：若流中途失败，按已消费的输出 token 计费（如果可得），否则按输入 token + 最小输出估计计费，并在 `meta` 标记 `truncated=true` 以便后续人工或自动补偿。
  - 幂等：`request_id` 仍唯一。流式重试需复用同一 request_id，避免重复扣费；补差流水使用新流水记录且引用原 request_id 于 `meta.parent_request_id`。
  - 旁路缓存：对流式响应一般不做内容缓存，但可缓存 usage 结果以支持对账/补差。

### 计费配置中的模式字段（建议）
- 在 `pricing_config` 里显式区分 `stream=true/false` 的单价或计数规则；若价格一致，可用同一字段但在元数据标记支持流式。
- 为不支持流式的模型，当 `stream=true` 时直接返回错误码，避免计费异常。

### BYO（自带上游）与差异化计费模板
- **免费 BYO 场景**：用户绑定自己的上游 key/provider 时，可设置 `pricing_config.mode = 'bypass'`，网关仅做路由/监控，不扣积分。流水可选写入 0 金额以便审计，或直接跳过写入，但建议至少记录请求基数以支持流量统计。
- **平台计费场景**：使用平台提供的上游线路按模板收费。
- **定价模板结构（建议）**：  
  ```json
  {
    "mode": "charge | bypass",            // bypass 表示不计费
    "currency": "CNY",
    "stream": { "input_per_1k": 0.6, "output_per_1k": 0.8 },
    "non_stream": { "input_per_1k": 0.5, "output_per_1k": 0.7 },
    "min_charge": 0,                      // 可选，最小计费额
    "free_quota": { "tokens": 0, "deadline": null }, // 可选，促销/试用
    "notes": "provider/model specific memo"
  }
  ```
- **绑定维度**：`pricing_config` 存在 `provider_preset_item` 层，按 `provider + model + capability` 精准配置；默认继承主表/provider 级模板，子项可覆盖。
- **逻辑判定顺序**：  
  1) 请求走的 preset item -> 读取其 `pricing_config`；  
  2) 若 `mode=bypass`，跳过扣费（可写 0 金额流水，reason=free_byo）；  
  3) 否则按流式/非流式路径计费；  
  4) 若未配置该维度，回退到 provider 级或全局默认，缺失则拒绝请求并返回配置缺失错误码。
- **审计/可见性**：即便 bypass，仍需记录 request_id 与 owner_id 以防滥用；监控面板区分 “平台计费” 与 “BYO 免费”。

## 定价配置 Schema 与继承/回退
- **Schema 草案（Pydantic/jsonb）**  
  ```json
  {
    "mode": "charge | bypass",                 // 必填，默认 charge
    "currency": "CNY",
    "stream": { "input_per_1k": 0.6, "output_per_1k": 0.8 },      // 可选
    "non_stream": { "input_per_1k": 0.5, "output_per_1k": 0.7 },  // 可选
    "min_charge": 0,
    "free_quota": { "tokens": 0, "deadline": null },              // deadline 为 ISO 时间
    "supports_stream": true,
    "supports_non_stream": true
  }
  ```
- **必填校验**：`mode` 必填；当 `mode=charge` 时需至少提供 `stream` 或 `non_stream` 中的一组单价；`supports_*` 为布尔开关用于前置校验。
- **继承/覆盖顺序**：`provider_preset_item.pricing_config` > `provider_preset.pricing_config` > 全局默认；缺失则拒绝请求并返回配置缺失错误。
- **不支持的模式**：如果 `supports_stream=false` 且请求 `stream=true`，返回错误码 `pricing_stream_not_supported`；反之同理。
- **免费额度使用顺序**：当存在 `free_quota.tokens>0` 且未过期，优先消耗免费额度，再扣余额；剩余免费额度写入流水 `meta.free_quota_remaining`。

## 幂等与冲突场景补充
- 同一 `request_id` 重复请求：返回已存在的计费结果，不再扣费；跨月分区重试时先查父表 + 当前月分区。
- 余额不足策略：默认拒绝并返回 `insufficient_balance`；可选配置“微额透支”上限，透支部分单独标记 `reason=overdraft` 便于后续追补/冻结。
- Celery 堵塞/失败时的降级：可配置开关（env/数据库配置）切换为同步扣费或直接拒绝计费相关请求，伴随告警。

## 失败与补偿路径
- 上游缺少 usage：落“估算计费”并在 `meta.confidence='low'`，同时写补偿待办队列（可用 Celery beat 轮询），必要时人工审核后写补差/退款流水。
- 流式中断：按已知输出 token 计费；未知时按最小估算并标记 `truncated=true`，后续若用户投诉或后台校正可写负向补差。

## 冷数据与聚合补充
- 归档格式：Parquet 分区键 `year=YYYY/month=MM`，记录 schema 版本；在 Trino/Presto/Glue 外表可直接查询。
- 日聚合去重：使用游标 `last_ledger_id` 或 `last_created_at`，每次聚合仅处理新增区间；聚合结果带 `source_range` 便于追溯。

## 访问控制与租户
- BYO key 共享：允许 org 管理员为成员配置共享 BYO，同时可设置共享额度上限/到期时间；计费逻辑仍按 `pricing_config.mode` 决定是否扣费。
- 管理面变更：编辑定价模板、切换 mode、修改免费额度需写审计日志（操作者、字段 diff、时间），并清理相关缓存。

## 观测与告警
- 指标需区分 `pricing_mode`（charge/bypass）、`supports_stream`、`provider/model`；关键阈值：扣费失败率、计费-流水差异、分区写入延迟、余额低/透支。

## 测试清单补充
- BYO bypass：不扣费但记录请求；平台 charge 正常扣费。
- stream/not_stream 不支持场景返回预期错误码。
- 同 request_id 重放只写一条扣费；跨月分区重试可查询到旧流水。
- 免费额度耗尽边界：最后一笔用免费额度与余额混合结算。
- usage 缺失的估算计费、后续补差/退款路径。

## 幂等与一致性
- `request_id` 唯一索引防双扣；Celery 重试前先查是否已有记录。
- 扣减事务：锁定账户 → 校验余额 → 更新 balance/version → 写流水 → 提交；失败回滚不落账。
- 缓存策略：余额短 TTL 缓存带版本号；扣减仍以数据库为准，成功后异步刷新缓存。

## 监控与对账
- 指标：Celery 失败/重试率、分区表写入 TPS、锁等待、余额为负告警。
- 对账：日终比对 `credit_account.balance` 与当日流水聚合差异；流水增量推送到对象存储供 BI/审计。

## 落地清单
- [ ] Alembic 迁移：`credit_account`、分区 `credit_ledger` 父表 + 月分区模板、`credit_ledger_daily`、必要索引与约束。
- [ ] ORM 与 Repository：账户 CRUD、乐观锁扣减、流水写入、聚合查询（含 async/sync 版本，供 FastAPI 与 Celery）。
- [ ] 计费 Service：提供同步/异步入口，统一幂等校验与补差逻辑。
- [ ] Celery 任务：`charge_usage_task` 批量扣减 + 聚合刷新；定时任务生成 `credit_ledger_daily`。
- [ ] 测试：并发扣减、幂等重放、跨月分区写入、聚合正确性；请人工运行 `pytest` 验证。
- [ ] 文档：若 API 错误码/行为有改动，同步更新 `docs/api/*` 与前端 i18n 文案。

## 指标与日志存储 DDL 草案

> 仅为初稿，落地时需结合实际 Alembic 迁移与分区管理工具（pg_partman/Timescale）。

### request_fact（月分区，追加写）
```sql
CREATE TABLE request_fact (
  request_id       varchar(64) PRIMARY KEY,
  owner_type       varchar(8)   NOT NULL,
  owner_id         uuid         NOT NULL,
  preset_id        uuid         NULL,
  preset_item_id   uuid         NULL,
  capability       varchar(32)  NOT NULL,
  model            varchar(128) NOT NULL,
  unified_model_id varchar(128) NULL,
  pricing_mode     varchar(16)  NOT NULL, -- charge/bypass
  stream           boolean      NOT NULL DEFAULT false,
  status_code      int          NOT NULL,
  upstream_status  varchar(32)  NULL,
  latency_ms_total int          NOT NULL,
  latency_ms_upstream int       NULL,
  retry_count      int          NOT NULL DEFAULT 0,
  fallback_reason  varchar(64)  NULL,
  cache_hit        boolean      NOT NULL DEFAULT false,
  input_tokens     int          NULL,
  output_tokens    int          NULL,
  token_confidence numeric(3,2) NULL,      -- 0–1
  cost_amount      numeric(20,6) NULL,
  currency         varchar(8)   NULL,
  created_at       timestamptz  NOT NULL
) PARTITION BY RANGE (created_at);

-- 月分区示例
CREATE TABLE request_fact_2025_01 PARTITION OF request_fact
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE INDEX ix_req_owner_time ON request_fact (owner_id, created_at DESC);
CREATE INDEX ix_req_item_time ON request_fact (preset_item_id, created_at);
CREATE UNIQUE INDEX uq_req_id ON request_fact (request_id);
```

### usage_hourly（增量物化/汇总表）
```sql
CREATE TABLE usage_hourly (
  stat_hour        timestamptz NOT NULL,
  owner_type       varchar(8)  NOT NULL,
  owner_id         uuid        NOT NULL,
  capability       varchar(32) NOT NULL,
  model            varchar(128) NOT NULL,
  pricing_mode     varchar(16) NOT NULL,
  req_count        int         NOT NULL,
  success_rate     numeric(6,4) NOT NULL,
  p50_latency_ms   int         NOT NULL,
  p95_latency_ms   int         NOT NULL,
  input_tokens     bigint      NULL,
  output_tokens    bigint      NULL,
  cost_amount      numeric(20,6) NULL,
  currency         varchar(8) NULL,
  PRIMARY KEY (stat_hour, owner_id, capability, model, pricing_mode)
);
```

### provider_health_hourly（按上游/预设聚合）
```sql
CREATE TABLE provider_health_hourly (
  stat_hour      timestamptz NOT NULL,
  provider       varchar(64) NOT NULL,
  preset_item_id uuid        NOT NULL,
  req_count      int         NOT NULL,
  success_rate   numeric(6,4) NOT NULL,
  p50_latency_ms int         NOT NULL,
  p95_latency_ms int         NOT NULL,
  error_4xx      int         NOT NULL,
  error_5xx      int         NOT NULL,
  retry_rate     numeric(6,4) NOT NULL,
  PRIMARY KEY (stat_hour, preset_item_id)
);
```

### 日常维护要点
- 分区管理：request_fact 按月预创建分区，老分区定期 DETACH 导出 Parquet；活跃分区保留必要索引（owner+time、item+time、request_id）。
- 批量写入：异步 Worker 每批 200–500 行插入；必要时开启 Timescale/pg_partman 压缩。
- 聚合刷新：usage_hourly / provider_health_hourly 支持并发刷新（物化视图）或直接写入增量表。

## 观测接口契约（草案）

> 面向前端 Dashboard；鉴权沿用 access token / X-User-Id，默认按用户隔离；管理端需 `metrics.view` 权限。

### 用户侧
- `GET /api/v1/metrics/me/overview?from=2025-01-01&to=2025-01-07`
  - 返回：余额/冻结、最近扣费时间（credit_account/ledger）、近7日消耗折线（cost, req_count）、成功率、p95 延迟。
- `GET /api/v1/metrics/me/model-breakdown?from&to`
  - 返回：按 capability/model 的请求数、成本占比、成功率、p95。
- `GET /api/v1/metrics/me/requests?from&to&model&status&cursor`
  - 分页明细：request_id、模型、状态码、耗时、费用、pricing_mode、stream、created_at；数据源 request_fact。
- `GET /api/v1/metrics/me/billing-daily?from&to`
  - 返回 credit_ledger_daily 的支出/入账曲线。

### 系统/运维侧
- `GET /api/v1/admin/metrics/overview?from&to`
  - 全局 QPS、成功率、p50/p95/p99、错误类型堆叠（Prometheus + usage_hourly）。
- `GET /api/v1/admin/metrics/providers?from&to&provider&item_id`
  - 按 provider/preset_item 的请求量、成功率、p95、重试率、4xx/5xx；数据源 provider_health_hourly。
- `GET /api/v1/admin/metrics/billing-health?from&to`
  - request_fact 与 credit_ledger 差异、补差/退款量、BYO 免费调用占比。
- `GET /api/v1/admin/metrics/tasks?from&to`
  - Celery 队列长度、处理耗时、失败/重试率、聚合延迟。

### 响应字段约定（摘要）
- 时间字段 ISO8601；货币跟随 credit 系统 `currency`。
- 分页使用 cursor/next_cursor。
- 错误码复用现有统一错误体；未配置/无权限返回既有 `permission_denied`。
