# 挑战者模型方案（草案）

## 背景与目标
- 为内部聊天增加“挑战者”回答，供用户对比并评分，后续可用于商业化模型验证和路由调优。
- 要求：对主链路零侵入，不写入正式会话窗口；可并行迭代，不阻塞现有聊天体验。

## 设计原则
- 旁路式：挑战者链路独立于主聊天编排，结果仅缓存与前端展示，不落正式会话。
- 复用现有能力：历史上下文由既有 ConversationService 读取；上游调用复用 Gateway 编排能力。
- 异步优先：使用 Celery 任务拉取上下文、调用模型，避免阻塞 API。
- 可观测：挑战者请求、结果、评分均带 challenge_id，便于追踪与报表。

## 接口草案（内部通道）
1) `POST /v1/chat/challenge/request`
   - 入参：`session_id`（必填）、`model`（挑战者模型标识）、`prompt` 或 `messages`（默认取最近一轮用户消息）、`trace_ctx?`。
   - 行为：生成 `challenge_id`，投递 Celery 任务，立即返回 `{challenge_id, status: "pending"}`。

2) `GET /v1/chat/challenge/result/{challenge_id}`
   - 返回：`{status: pending|success|failed, answer?, usage?, latency_ms?, model, session_id}`。
   - 读取 Redis/缓存；可选 `once=true` 读取后删除以控 TTL。

3) `POST /v1/chat/challenge/feedback`
   - 入参：`{challenge_id, score(1-5), reason?}`。
   - 行为：记录评分（DB + BanditRepository.record_feedback，reward=score），用于后续路由/模型评估。

## 任务队列流程（Celery）
- 任务名：`challenge.generate`（新建）。
- 步骤：
  1. 通过 `ConversationService.load_window(session_id)` 拉取 summary + window（只读）。
  2. 组装 messages：`[summary(system?)] + window + 本次 prompt`。
  3. 调用编排：使用 `GatewayOrchestrator.for_channel(Channel.INTERNAL)` 配自定义 Workflow（去掉 conversation_append），或直接复用 `upstream_call + response_transform`。
  4. 结果写入 Redis：`CacheKeys.challenge_result(challenge_id)`，包含 answer/usage/latency/status_code/provider/model/session_id，TTL 与会话一致。
  5. 失败时写 error_code/ message；不重试时保留 failed 状态供前端提示。

## 数据与存储
- Redis：挑战者结果缓存（key 需新增到 `CacheKeys`）。
- DB（可选但推荐）：`challenge_feedbacks` 表存原始评分；Bandit reward 与评分联动。
- 审计：在 `audit_log` 中标记 `experiment=is_challenge` 便于过滤。

## 前端交互要点
- 聊天界面新增“挑战者”按钮：
  - 调用 request → 短轮询 result → 展示挑战者回答卡片（不写入主对话列表）。
  - 评分控件：星级或点赞/踩+原因，提交至 feedback；成功后 toast。
- 文案提示：说明“实验模型，结果仅作参考；评分用于模型优化”。

## 用户自带模型对比（同一会话，最多 3 路返回）
- 槽位约束：主模型 + 最多 2 个附加候选（含挑战者或用户自带模型），总计不超过 3 条可展示答案。
- 触发方式：用户在同一对话点击“使用我的模型”即可发起一条与挑战者相同的旁路请求（复用 challenge.request/result 流程，区别在 `model` 来自用户自定义配置/密钥）。
- 展示规则：三条回答并排卡片展示；仅主模型写入会话窗口，候选不写入。
- 覆盖规则：用户点击“采用此回答”后，将该候选回答写入 ConversationService，覆盖主模型当轮 assistant 消息（需携带 `session_id` 与原 turn_index/trace 标识）；被覆盖的主回答可选在缓存中保留一份用于审计，不再出现在窗口。
- 计量与审计：覆盖后计量以最终采用的回答为准；challenge_id 仍用于追踪候选调用，便于对比成本/质量。
- 安全限制：每轮最多触发一次“我的模型”请求，避免超过 3 路；若已有 3 路候选则禁止再发起，给出提示。

## 待决事项 / 风险
- 模型路由：挑战者模型的 ProviderPreset 配置（channel=internal, capability=chat）需确认。
- 流式支持：首版建议非流式，后续视需求扩展 SSE。
- 配额与限流：是否复用内部 rate_limit；如需隔离，可单独 key 前缀。
- 安全与脱敏：挑战者返回是否需要额外 sanitize；可复用现有 `sanitize` 步骤。
- 观测指标：需在 metrics/usage 中新增 `challenge_id` 维度用于报表。
 - 覆盖落库细节：覆盖写回时如何处理原回答的 token 计量与审计记录，需要明确（建议以“最终采用”口径为准，并保留原调用 trace 仅作审计，不计入窗口）。
