# Phase 2：智能决策与反馈闭环设计

**版本**: v1.0  
**日期**: 2026-02-04  
**状态**: 设计确认

## 目标与范围
本设计覆盖 Phase 2 的增量能力：统一决策服务（Bandit 通用化）、反馈归因闭环、Skill 维度报表与可配置化排序策略。目标是让系统从“能用”升级为“好用”，同时保证现有 LLM 路由不受影响。

## 架构与数据流
系统在现有 Phase 1 链路上新增决策与反馈闭环：

1. **检索链路（Discovery）**  
`ToolSyncService` 在向量检索得到 Top‑K skill 候选后，调用 `DecisionService.rank_candidates(scene, candidates)` 做 rerank。候选包含 `arm_id` 与 `base_score`，决策层计算 `bandit_score` 并用配置化融合函数得到 `final_score`。  
**Fail‑open**：决策异常回退向量排序，保证稳定性。

2. **反馈链路（Attribution）**  
`/v1/feedback` 接收用户评分，归因引擎回放 trace 并定位触发的 tool/skill。若 tool 成功但评分差，降低对应 skill 的 bandit 权重；若 tool 失败，增加失败计数并可能触发下线；若无 tool 调用，则调整 assistant/prompt 相关权重。  
`DecisionService.record_feedback` 统一写回 `BanditArmState`。

3. **场景隔离（Scene Segmentation）**  
`BanditArmState` 通过 `(scene, arm_id)` 进行唯一索引；`reward_metric_type` 用于区分场景目标（如 `router:llm` 的 `latency_success` vs `retrieval:skill` 的 `task_success`）。

## 决策策略与冷启动
`DecisionService` 支持多策略：Thompson / UCB / epsilon‑greedy。  
冷启动候选统一引入 **探索加成**（Exploration Bonus）或 UCB 的置信上界，确保新技能有曝光机会，避免“强者恒强”。

**融合逻辑（Final Rank）**：  
默认采用 `weighted_sum`（向量分数 + bandit 分数 + exploration bonus），并支持配置切换 `bandit_only` / `vector_only`。  
策略与权重均可按 `scene` 管理，避免硬编码。

## 报表与可观测性
新增内部接口 `/bandit/report/skills`（与 `/bandit/report` 同级）用于 skill 维度健康度与满意度统计。  
支持过滤参数：`skill_id`、`status`；返回 `summary + items` 结构，并关联 `bandit_arm_state (scene=retrieval:skill)` 与 skill_registry 元信息（名称/状态/成功率等）。

可观测性指标：
- 决策层：scene、候选数量、bandit/向量分数分布、cold‑start 触发次数、rerank 耗时  
- 反馈层：归因成功率、归因到 skill/assistant 的比例、bandit 更新成功率  
- 质量层：按 reward_metric_type 统计 success rate 与失败类型分布

## 错误处理
所有决策与反馈写回均采用 **fail‑open** 机制：
- 决策失败回退向量排序  
- 反馈写回失败仅记录日志，不阻断主链路  
异常日志统一包含 `trace_id / scene / arm_id`，方便回溯。

## 测试策略
1. **DecisionService**  
   - Thompson/UCB/epsilon‑greedy 排序稳定性与差异性  
   - cold‑start exploration 覆盖  
   - final_score 融合函数覆盖
2. **ToolSyncService**  
   - rerank 行为与 fail‑open 回退  
3. **API / Report**  
   - `/bandit/report/skills` 返回结构  
   - 过滤参数（`skill_id`、`status`）  
4. **回归**  
   - router:llm 场景路由与 bandit 记录正常  

## 配置建议（按 scene 管理）
- `decision.strategy`: thompson / ucb / epsilon_greedy  
- `decision.final_score`: weighted_sum / bandit_only / vector_only  
- `decision.weights`: vector_weight / bandit_weight / exploration_bonus  
- `decision.ucb`: c / min_trials  
- `decision.thompson`: prior_alpha / prior_beta

## 验收标准
1. 在相同语义相似度下，成功率高、用户评分高的 skill 排在前面  
2. 用户点“踩”后，对应 skill 的指标实时更新  
3. rerank 延迟开销 < 50ms，且异常时可降级  
4. router:llm 现有逻辑不受影响
