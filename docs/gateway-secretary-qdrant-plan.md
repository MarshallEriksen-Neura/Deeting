# 内部“秘书”Qdrant检索试点计划

## 范围与目标
- 仅作用于 **内部网关** 请求，作为编排中的“秘书”决策层：在需要时检索 Qdrant 记忆或语义缓存，未命中/不可用时不阻塞主链路。
- 未来可灰度到外部网关，但默认关闭；外部开启须满足鉴权/审计/配额等前置条件。

## 架构接入点
1) 编排步骤：`semantic_cache` → `memory_retrieval` 插入 orchestrator，仅 internal 渠道启用。两步都要求熔断/降级。
2) 决策策略（秘书 gating）：
   - 规则+轻量分类：检测指代/回溯关键词（如“上次/刚才/记得”）+ 意图分类阈值。
   - 未通过则跳过检索；通过则检索 user+system collection（强制 filter `owner_user_id & project_id & approved=true`）。
3) 数据隔离：维持 shared user 集合 + system 集合；必要时新增 semantic_cache/fewshot/guardrails 集合避免污染。
4) 写入路径：聊天异步摘要/抽取 → embedding → ensure collection → upsert（Celery 旁路）；上传文档走单独 ingest 但复用同一存储规范。

## 配置与开关
- `SECRETARY_ENABLED_INTERNAL`（新增）：控制内部通道是否启用秘书。
- `SECRETARY_ENABLED_EXTERNAL`（预留，默认 false）。
- Qdrant 相关：`QDRANT_ENABLED / QDRANT_URL / QDRANT_API_KEY` 等已在 config 补齐；检索/写入开关可在步骤内再做细分（cache/memory 分别可关）。

## 里程碑与任务
### M1 配置与步骤接入（内部）
- [ ] 新增 settings 开关（internal on / external off）。
- [ ] 实现并注册 `semantic_cache`、`memory_retrieval` 步骤（只对 internal 生效）。
- [ ] 熔断/降级：Qdrant 异常或判定失败时直接走主链路。

### M2 异步写入与上传整合
- [ ] 迁移/实现聊天记忆抽取任务（Celery），落库 Qdrant。
- [ ] 文档上传 ingest 管道：解析→embedding→upsert，复用 collection 策略。
- [ ] 去重与最小相似度阈值（MIN_SCORE）。

### M3 观测与安全
- [ ] 指标：检索命中率、延迟、降级次数、Qdrant 健康；日志携带 trace_id。
- [ ] 权限：检索强制 filter；秘书查询内部数据（用量/错误）暂不开放。
- [ ] 审计：记录秘书决策、检索参数（脱敏）、命中来源。

### M4 灰度到外部前置
- [ ] 签名/nonce 校验、租户隔离、RBAC 校验到位。
- [ ] 配额/成本控制（检索预算、阈值）。
- [ ] 回滚/开关策略：外部默认关闭，灰度按租户或比例启用。

## 风险与缓解
- Qdrant 不可用 → 统一降级并告警；不影响主链路。
- 串读/权限泄露 → 服务层强制 filter + RBAC；外部灰度前必须审计完善。
- 召回污染 → 按用途拆 collection；命中阈值与去重策略前置。

## 向量维度与隔离方案（新增）
- 嵌入模型由平台统一提供，秘书仅负责检索/写入，用户侧无 embedding 选择入口。
- 用户数据与系统数据分离：用户只写入用户 collection（含 user_id/tenant/project 过滤），系统 collection 由平台维护，默认用户不可写，避免混维度/污染；默认策略为 per_user collection（kb_user_<userhex>）。
- 每条向量记录携带 `embedding_version` 与 `secretary_phase_id` 元数据，检索时按版本过滤，便于后续升级与淘汰旧数据。
- 写入时强校验维度（collection schema + client 校验），维度不符即降级跳过写入并告警，主流程继续。
- 若需更换 embedding：按“新 collection + 双写/迁移 + 切流 + 旧库只读”流程，确保不同维度隔离；现阶段不做跨维兼容逻辑。

## 验收标准（内部试点）
- 编排链路可用且默认延迟影响 <30ms（未命中路径）。
- 单测覆盖：决策命中/跳过、熔断、过滤、防串读、写入/检索闭环。
- 观测：核心指标可在监控面板查询，告警触发正确。
