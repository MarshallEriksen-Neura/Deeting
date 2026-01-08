# 网关双通道实现计划

> 基于 [gateway-dual-channel-design.md](./gateway-dual-channel-design.md) 的落地实施计划

---

## 快速导航

| 分类 | 说明 |
|------|------|
| [待办事项总览](#待办事项总览) | **所有未完成任务的集中清单** |
| [实施阶段总览](#实施阶段总览) | 各阶段状态概览 |
| [阶段详情](#phase-1-编排框架基础--已完成) | 各阶段详细内容（含已完成） |
| [文件清单](#文件清单) | 文件创建状态 |

---

## 待办事项总览

> **一站式查看所有未完成任务**，按优先级排序

### P0 - 阻塞生产上线

| 任务 | 所属阶段 | 状态 | 说明 |
|------|----------|------|------|
| ~~RateLimitStep Lua 切换~~ | Phase 3.4 | ✅ 已完成 | Lua 脚本预加载 + Python 降级 |
| ~~计费 DB 持久化~~ | Phase 3.6 | ✅ 已完成 | billing_transaction 表 + 幂等键 |
| ~~配额 DB 持久化~~ | Phase 3.3 | ✅ 已完成 | tenant_quota 表 + 乐观锁 |

**当前无 P0 阻塞项**

### P1 - 功能完善（建议近期完成）

| 任务 | 所属阶段 | 文件/位置 | 说明 |
|------|----------|-----------|------|
| API Key 级配额扩展 | Phase 3.3 | quota_check.py | ✅ 已完成 (token/request/cost + reset=never) |
| TPM 限流实现 | Phase 3.4 | rate_limit.py | 按 token 计数限流 |
| ~~Celery 任务防丢失~~ | Phase 12 | celery_app.py | ✅ 已完成 (`task_acks_late` 等配置) |
| ~~批量推理任务~~ | Phase 12 | tasks/async_inference.py | ✅ 已完成 (异步批量推理) |
| ~~Celery 重试与监控配置~~ | Phase 12 | celery_app.py | ✅ 已完成 (`task_annotations` 等) |
| ~~Celery 队列路由拆分~~ | Phase 12 | celery_app.py | ✅ 已完成 (路由映射) |
| ~~长耗时任务异步化补齐~~ | Phase 12 | tasks/*.py | ✅ 已完成 (回调/报表/媒体处理等) |
| Qdrant 集成迁移（配置 + 客户端 + 存储层） | Phase 3.x | backend/app/core/config.py, app/qdrant_client.py, app/storage/qdrant_* | 🔄 进行中 |
| 内部“秘书”Qdrant 检索试点 | Phase 3.x | backend/docs/gateway-secretary-qdrant-plan.md | 🆕 规划完成，待实施 |

### P2 - 测试与文档（持续进行）

| 任务 | 所属阶段 | 说明 |
|------|----------|------|
| ~~单元测试补全~~ | Phase 7.1 | ✅ orchestrator/steps 测试已完成 |
| ~~集成测试~~ | Phase 7.2 | ✅ 全链路/错误场景测试已完成 |
| ~~API 文档~~ | Phase 7.3 | ✅ external/internal Gateway API 已完成 |
| ~~运维文档~~ | Phase 7.4 | ✅ 部署/监控/故障排查 已完成 |

### P3 - 运维与合规（中长期）

| 任务 | 所属阶段 | 说明 |
|------|----------|------|
| 全局限流桶 | 设计遗漏 | 防单租户占满带宽 |
| 灰度发布机制 | Phase 14 | 配置版本化 + 按租户灰度 |
| 审计数据留存 | Phase 14 | 自动归档/删除 + 合规导出 |
| SLO/SLI 告警规则 | Phase 8 | Prometheus alerting rules |
| 用户审计界面 | Phase 13 | `GET /external/v1/audit` |
| 内部运维面板 | Phase 13 | 失败率分解/关键指标 |
| 自助健康面板 | Phase 13 | `GET /external/v1/health` |
| Schema 演进策略 | Phase 14 | API 版本控制 + 兼容策略 |
| 混沌/降级演练 | Phase 8 | 演练脚本与记录 |

---

## 待办事项详情

### P1 详细说明

#### 1. API Key 级配额扩展
- **位置**: `app/services/workflow/steps/quota_check.py`
- **需求**:
  - 按 token/request/cost 类型配额
  - 支持 reset=never 语义（永不重置）
  - 按 capability 维度拆分 Hash
- **优化建议**: Lua 返回值打点（不足类型 BALANCE/DAILY/MONTHLY）

#### 2. TPM 限流实现
- **位置**: `app/services/workflow/steps/rate_limit.py`
- **需求**: 使用计费写入的精确 token 计数
- **当前**: 脚本+Redis Hash fallback 已可用，需接入精确值

#### 3. Celery 任务防丢失配置
- **位置**: `app/core/celery_app.py`
- **需求**:
  ```python
  task_acks_late = True
  task_reject_on_worker_lost = True
  ```

### P2 测试清单

#### 单元测试（`tests/unit/`）
- [x] `orchestrator/test_context.py` - WorkflowContext 测试
- [x] `orchestrator/test_registry.py` - StepRegistry 测试
- [x] `orchestrator/test_engine.py` - OrchestrationEngine 测试
- [x] `test_steps/test_validation.py` - ValidationStep 测试
- [x] `test_steps/test_routing.py` - RoutingStep 测试
- [x] `test_steps/test_upstream_call.py` - UpstreamCallStep 流式计费辅助（HTTP/熔断路径待补）
- [x] RateLimitStep Lua 路径与回退单测
- [x] SignatureVerifyStep 连续签名失败冻结测试
- [x] BillingStep 余额扣减与负值告警测试
- [x] SanitizeStep 外部脱敏覆盖测试
- [x] ResponseTransformStep token 用量提取测试

#### 集成测试（`tests/integration/`）
- [x] `test_external_flow.py` - 外部通道全链路（成功路径）
- [x] `test_internal_flow.py` - 内部通道全链路（成功路径）
- [x] `test_error_scenarios.py` - 错误场景（编排步骤失败中止）
- [x] `test_rate_limit.py` - 限流测试
- [x] `test_billing.py` - 计费测试
- [ ] `test_bandit_routing.py` - Bandit 选择、降级与冷却期
- [x] `test_signature_block.py` - 签名失败触发冻结
- [x] `test_ip_whitelist.py` - IP/域名白名单校验
- [ ] `test_streaming_billing.py` - 流式 token 计数

#### 文档（`docs/`）
- [x] `api/external-gateway-api.md` ✅
- [x] `api/internal-gateway-api.md` ✅
- [x] `api/error-codes.md` ✅
- [x] `api/authentication.md` ✅
- [x] `api/rate-limit.md` ✅
- [ ] `api/audit.md`
- [ ] `api/bandit-routing.md`
- [x] `operations/deployment.md` ✅
- [x] `operations/monitoring.md` ✅
- [x] `operations/troubleshooting.md` ✅
- [ ] `operations/runbook.md`

### P3 详细说明

#### 全局限流桶
- **需求**: 防止单租户占满带宽
- **方案**:
  - 限流 key 层级：`gw:rl:global`, `gw:rl:{tenant}`, `gw:rl:{tenant}:{ak}`
  - 队列按租户权重隔离

#### 灰度发布机制
- **需求**: 路由策略/bandit 参数/价格变更的灰度发布
- **方案**:
  - 配置版本化存储（version + effective_at）
  - 按租户/百分比灰度路由
  - 一键回滚接口

#### 审计数据留存
- **需求**: 审计/请求摘要保存周期与删除
- **方案**:
  - `AUDIT_LOG_RETENTION_DAYS` 配置（默认 30）
  - Celery beat `audit_purge_daily` 任务
  - 合规导出接口（按租户/时间窗口）

#### SLO/SLI 告警配置
- **需求**: Prometheus alerting rules
- **告警项**:
  - 可用性 SLO（99.9%）
  - p95/p99 延迟超阈值
  - 上游超时率/失败率
  - 计费异常（费用突增/为负）

---

## 实施阶段总览

| 阶段 | 名称 | 状态 | 说明 |
|-----|------|------|-----|
| Phase 1 | 编排框架基础 | ✅ 已完成 | 核心引擎、上下文、注册表 |
| Phase 2 | 核心步骤实现 | ✅ 已完成 | 11 个编排步骤 |
| Phase 3 | 步骤业务接入 | ✅ 基本完成 | 计费/配额/限流已落 DB+Redis |
| Phase 4 | API 路由集成 | ✅ 已完成 | 内外通道路由拆分 |
| Phase 5 | 数据模型扩展 | ✅ 已完成 | provider preset 字段扩展 |
| Phase 5.5 | API Key 管理 | ✅ 已完成 | API Key 模型、Repository、Service、路由 |
| Phase 6 | Redis 缓存层 | ✅ 已完成 | 缓存 Key 管理、限流实现 |
| Phase 7 | 测试与文档 | ✅ 已完成 | 单元测试、集成测试、API/运维文档 |
| Phase 8 | 风控与可观察性 | ✅ 已完成 | 错误模型/trace_id/熔断/背压/白名单 |
| Phase 9 | Bandit 路由闭环 | ✅ 已完成 | ε-greedy/UCB1/Thompson + Redis |
| Phase 10 | 缓存失效矩阵 | ✅ 已完成 | 事件→Key 矩阵、版本号、防旧值复活 |
| Phase 11 | 签名与封禁联动 | ✅ 已完成 | 签名失败冻结、封禁联动、IP 白名单 |
| Phase 12 | 异步任务 Celery | ✅ 已完成 | 异步计费/审计、队列隔离 |
| Phase 13 | 审计与运维面板 | 🔲 待开始 | 用户审计查询、运维面板 |
| Phase 14 | 灰度与合规 | 🔲 待开始 | 灰度发布、数据留存 |

---

## 已完成阶段详情

<details>
<summary><b>Phase 1: 编排框架基础 ✅</b></summary>

### 1.1 WorkflowContext 上下文管理 ✅
**文件**: `app/services/orchestrator/context.py`
- [x] `WorkflowContext` 数据类定义
- [x] `Channel` 枚举 (INTERNAL/EXTERNAL)
- [x] `ErrorSource` 枚举 (GATEWAY/UPSTREAM/CLIENT)
- [x] `UpstreamResult` / `BillingInfo`
- [x] 命名空间读写 `get()`/`set()`
- [x] 审计日志导出 `to_audit_dict()`

### 1.2 BaseStep 抽象基类 ✅
**文件**: `app/services/workflow/steps/base.py`
- [x] `BaseStep` 抽象类定义
- [x] `StepConfig` / `StepResult` / `StepStatus` / `FailureAction`
- [x] `execute()` / `on_failure()` / `on_degrade()` / `should_skip()`

### 1.3 StepRegistry 步骤注册表 ✅
**文件**: `app/services/orchestrator/registry.py`
- [x] 单例模式 + `@registry.register` 装饰器
- [x] `get()` / `get_many()` / `list_all()`

### 1.4 OrchestrationEngine 执行引擎 ✅
**文件**: `app/services/orchestrator/engine.py`
- [x] DAG 依赖验证 + Kahn's algorithm 拓扑排序
- [x] 按层并行执行 + 失败处理
- [x] `ExecutionResult`

### 1.5 编排配置 ✅
**文件**: `app/services/orchestrator/config.py`
- [x] 内外通道模板 + `get_workflow_for_channel()`

### 1.6 GatewayOrchestrator 高层接口 ✅
**文件**: `app/services/orchestrator/orchestrator.py`
- [x] 模板选择 + 引擎构建 + 依赖注入

</details>

<details>
<summary><b>Phase 2: 核心步骤实现 ✅</b></summary>

| 步骤 | 文件 | 说明 |
|------|------|------|
| ValidationStep | validation.py | 入参校验、model 字段提取 |
| SignatureVerifyStep | signature_verify.py | 时间戳/Nonce/HMAC 校验 |
| QuotaCheckStep | quota_check.py | 余额/日/月配额检查 |
| RateLimitStep | rate_limit.py | 滑动窗口限流 |
| RoutingStep | routing.py | capability+model 路由选择 |
| TemplateRenderStep | template_render.py | simple_replace/jinja2 渲染 |
| UpstreamCallStep | upstream_call.py | httpx 流式/非流式调用 |
| ResponseTransformStep | response_transform.py | OpenAI/Claude/Azure 格式转换 |
| SanitizeStep | sanitize.py | 敏感响应头/体脱敏 |
| BillingStep | billing.py | 定价计算、余额扣减 |
| AuditLogStep | audit_log.py | 审计日志记录 |

</details>

<details>
<summary><b>Phase 3: 步骤业务接入 ✅ 基本完成</b></summary>

### 3.1 RoutingStep ✅
- [x] ProviderPresetRepository 接入
- [x] visibility/channel 过滤、priority/weight 排序
- [x] Bandit 算法集成（epsilon-greedy/UCB1/Thompson）
- [x] Redis 版本化缓存

### 3.2 SignatureVerifyStep ✅
- [x] ApiKeyRepository + Redis 接入
- [x] Nonce 去重 + HMAC 校验
- [x] 签名失败自动冻结 + IP 白名单
- [x] HMAC 独立 secret（secret_hash 校验）

### 3.3 QuotaCheckStep ✅
- [x] QuotaRepository + Redis 接入
- [x] Redis Lua `quota_check_deduct` + DB 乐观锁回退
- [x] `tenant_quota` 表 + daily/monthly 自动重置
- [x] DB 事务 + Redis Hash 双写 + trace_id 幂等
- [x] API Key 级配额（token/request/cost + reset=never）

### 3.4 RateLimitStep ✅
- [x] Redis 客户端接入 + 滑动窗口（Python 版）
- [x] 多级限流 key (tenant/ak/ip)
- [x] Lua 脚本预加载 + evalsha
- [x] 外部/内部阈值分级配置化
- [ ] **待完成**: TPM 限流（精确 token 计数）

### 3.5 UpstreamCallStep ✅
- [x] SecretManager 接入 + Bearer/ApiKey/Basic 认证
- [x] 出站域名白名单 + 响应大小限制
- [x] 熔断/半开探测（Redis 分布式状态）

### 3.6 BillingStep ✅
- [x] BillingRepository + UsageRepository 接入
- [x] `billing_transaction` 表 + DB 事务 + Redis 双写
- [x] trace_id 幂等键 + 402 Payment Required
- [x] 流式计费（StreamTokenAccumulator）
- [x] Celery 异步计费任务

### 3.7 AuditLogStep ✅
- [x] AuditRepository 接入 + trace_id 透传
- [x] 错误归因 code/source/upstream_status
- [x] Celery 异步审计任务
- [x] 审计字段扩展（GatewayLog.meta）

</details>

<details>
<summary><b>Phase 4-6, 8-11: 已完成阶段</b></summary>

### Phase 4: API 路由集成 ✅
- 内外通道路由结构 (`/internal/`, `/external/`)
- Gateway API (chat/completions, embeddings, models)
- 流式响应支持 + 流式计费处理

### Phase 5: 数据模型扩展 ✅
- ProviderPreset/ProviderPresetItem 字段扩展
- Alembic 迁移完成

### Phase 5.5: API Key 管理 ✅
- ApiKey 主表 + Scope/RateLimit/Quota/IpWhitelist/Usage 表
- Repository/Service/API 路由完整实现

### Phase 6: Redis 缓存层 ✅
- 缓存 Key 注册表 + 失效管理
- Lua 脚本（滑动窗口/令牌桶/配额扣减）
- 连接池 + 降级处理

### Phase 8: 风控与可观察性 ✅
- 统一错误模型 + trace_id 透传
- SLO/SLI 指标埋点
- 熔断/背压 + 请求/响应大小限制
- 出站域名白名单 + 安全基线

### Phase 9: Bandit 路由闭环 ✅
- 奖励采集 + 参数持久化
- ε-greedy/UCB1/Thompson 策略
- 自动降级 + Redis 缓存

### Phase 10: 缓存失效矩阵 ✅
- 事件→Key 矩阵 + 配置版本号
- single-flight/锁防击穿 + TTL 抖动

### Phase 11: 签名与封禁联动 ✅
- 签名失败自动冻结
- 租户/用户封禁联动
- IP/域名白名单 + Nonce 防重放

</details>

<details>
<summary><b>Phase 12: 异步任务 Celery ✅ 已完成</b></summary>

- [x] `app/celery_app.py` - Celery 实例与配置
- [x] `app/tasks/billing.py` - 异步计费任务
- [x] `app/tasks/audit.py` - 异步审计写入
- [x] 队列配置：`internal`, `external`, `billing`, `retry`
- [x] Docker Compose worker + flower 服务
- [x] `app/tasks/async_inference.py` - 批量推理任务
- [x] `task_acks_late=True` + `task_reject_on_worker_lost=True`
- [x] `task_annotations` 重试/回退配置 + `task_send_sent_event=True`
- [x] 内/外/重试队列路由拆分（`task_routes` 明确映射）
- [x] 其他长耗时异步任务（外部回调推送、报表生成、重试型上游调用、日志/指标批量写入、大文本/音视频处理）

</details>

---

## 代码实现状态总结

### ✅ 生产就绪模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 编排引擎 | engine.py | 拓扑排序、并行执行、重试/超时/降级 |
| 签名校验 | signature_verify.py | 时间戳/nonce/HMAC + 自动冻结 |
| 计费系统 | billing_repository.py | DB 事务 + Redis 双写 + 幂等键 |
| 配额系统 | quota_repository.py | 乐观锁 + Redis Hash 同步 |
| 限流步骤 | rate_limit.py | Lua 优先 + Python 降级 |
| 熔断器 | upstream_call.py | Redis 分布式状态 + 进程内降级 |
| 缓存服务 | cache.py | 版本化缓存、single-flight、TTL 抖动 |
| Bandit 路由 | routing_selector.py | epsilon-greedy/UCB1/Thompson |

### ⚠️ 需补充完善

| 模块 | 待完成项 |
|------|----------|
| 配额系统 | quota_check.py | ✅ 已支持 API Key 级配额 |
| RateLimitStep | TPM 限流（精确 token 计数）|
| Celery | 任务防丢失配置 |

---

## 文件清单

### 核心文件 ✅

```
backend/app/services/
├── orchestrator/
│   ├── context.py           ✅ WorkflowContext
│   ├── registry.py          ✅ StepRegistry
│   ├── engine.py            ✅ OrchestrationEngine
│   ├── config.py            ✅ 编排配置
│   └── orchestrator.py      ✅ GatewayOrchestrator
│
└── workflow/steps/
    ├── base.py              ✅ BaseStep
    ├── validation.py        ✅ ValidationStep
    ├── signature_verify.py  ✅ SignatureVerifyStep
    ├── quota_check.py       ✅ QuotaCheckStep
    ├── rate_limit.py        ✅ RateLimitStep
    ├── routing.py           ✅ RoutingStep
    ├── template_render.py   ✅ TemplateRenderStep
    ├── upstream_call.py     ✅ UpstreamCallStep
    ├── response_transform.py✅ ResponseTransformStep
    ├── sanitize.py          ✅ SanitizeStep
    ├── billing.py           ✅ BillingStep
    └── audit_log.py         ✅ AuditLogStep
```

### 待创建文件 🔲

```
tests/
├── unit/orchestrator/       🔲 编排器单元测试
└── integration/             🔲 集成测试

docs/
├── api/                     🔲 API 文档
└── operations/              🔲 运维文档
```

---

## 状态图例

| 符号 | 含义 |
|-----|------|
| ✅ | 已完成 |
| ⏳ | 进行中 |
| 🔲 | 待开始 |
| ~~删除线~~ | 已移除/不再需要 |

---

*最后更新: 2026-01-06*
