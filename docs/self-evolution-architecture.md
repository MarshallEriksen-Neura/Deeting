# Deeting 自进化架构（Sovereign Self-Adjustment）

> 适用范围：桌面端本地对话（local chat）的"自进化 / 自调整"子系统。
> 不覆盖：RAG / 上下文编排（见 [rag-architecture.md](./rag-architecture.md)）。

本文档是 Deeting 桌面端"自进化"子系统的权威说明书，目标和 [`rag-architecture.md`](./rag-architecture.md) 一致：让未来回顾、其他人接手维护、想学 agent 的新人可以从这一篇直接读懂：

- 系统的设计动机（为什么 Deeting 要"自己调整自己"）
- 系统的拓扑（谁在观察、谁在判断、谁在更新先验）
- 系统的边界（什么允许、什么禁止）
- 在哪里加东西、在哪里改东西

## 1. TL;DR

Deeting 桌面端 **不是**一个固定行为的 agent。它会基于每一次任务的执行结果，**调整自己下一次的路由 / 检索 / 执行 / 验证倾向**。

它的自进化采用一个非常克制的回路：

1. 进入一次任务前，runtime 用一个 **TaskFingerprint**（任务指纹）把"这是哪一类任务"压缩成 8 个语义维度。
2. 对每个**决策点**（route / worker_selection / discovery / capability_attach / execution / verification），系统去**先验库**取这个指纹下的历史权重（priors）。
3. 任务真实跑完之后，runtime 用**启发式判官**评估这次跑得"好不好"，结合**用户事后信号**（accepted / corrected / rejected）算出一个 `PolicyDelta`。
4. 这个 delta **加权写回**到先验库，时间会让旧 delta **半衰减**（21 天半衰期）。
5. 下一次同类指纹的任务进来时，先验影响路由倾向，但**永远不能突破安全锁**（destructive / approval_sensitive / 用户显式路由）。

这个结构叫 **Sovereign Architecture（主权架构）**。它住在 [`deeting/src-tauri/src/modules/desktop_runtime/runtime/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/) 下的 `task_learning/`、`posterior_signal/`、`sovereign/` 三个模块里。

> 命名说明：业界类似工作（如 EvoMap 的 GEP/GDI 方法论）有自己的术语体系。Deeting **借鉴思想、不借用词汇**——核心代码里你看不到 `gene` / `fitness` / `phenotype` / `evolver` 这些词。原因见 §6。

## 2. 为什么这么做

直觉版的"自进化 agent"很容易长成这两种坏样子：

1. **黑盒进化**：模型在某个隐藏的 fitness 函数上不断"进化"，工程师无法解释、无法回滚、无法在 PR review 里讨论一个具体的权重变更。
2. **单一信号独裁**：要么"用户点踩"一票否决，要么"模型自评分"一票通过。任何一个机制单独说了算，都会在边缘案例里悄悄毁掉用户体验。

Deeting 选择的设计：

| 朴素自进化的坑 | Deeting 的做法 |
|---|---|
| 一个全局 fitness 决定一切 | **多决策点 + 多信号**：6 个独立决策点、4 类信号源、启发式判官与用户后验信号相互制衡 |
| 学到的 prior 永久压制用户意图 | 安全锁（`decision_has_safety_lock`）一票否决，用户显式指令永远赢 |
| 老 prior 永远生效 | 21 天半衰期（`PRIOR_HALF_LIFE_MS`）；不更新就慢慢忘 |
| 引入一个外部信号源就要重写核心 | **Sovereign Charter**：外部源只能通过 `Ingress` 边界进来，核心只看 `Observation` |
| 用 LLM 自评来自我强化（幻觉风险） | 任务评估**只用启发式**，不在评估阶段二次调用模型，避免"模型给模型打分"的隐藏回路 |
| Bandit 算法越调越激进 | `ROUTE_BANDIT_COEFF = 0.25`，bandit 只做平局拆解，无法独自翻盘 |

一句话：**Deeting 是主语，所有信号是观察。**

## 3. 架构总览

```text
┌────────────────────────────────────────────────────────────────┐
│ 一次本地对话（chat_tool_runtime/mod.rs）                       │
│                                                                │
│  ① 接收 user query                                             │
│  ② build_task_fingerprint(query) → TaskFingerprint             │
│  ③ Self_::consult(locus, query)                                │
│        └→ task_learning::query_task_policy_hint                │
│              ├─ 从 McpStore 取该指纹下的 priors                 │
│              ├─ 按 21 天半衰期 decay_weight                     │
│              └─ 输出 TaskPolicyHint                             │
│  ④ apply_route_prior(base_decision, hint, bandit_scores)       │
│        ├─ 加 prior 权重                                         │
│        ├─ 加 bandit 平局分（系数 0.25）                         │
│        └─ 安全锁存在 → 不允许翻盘                               │
│  ⑤ 执行（直跑 / 工人 / 委托 / 执行代码 plan / …）              │
│        └─ 收集 tool_trace_blocks、error_codes、latency 等       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ 任务结束后：evaluate_task_learning_with_runtime                │
│                                                                │
│  ① collect_task_learning_signals(trace) → TaskLearningSignals  │
│  ② 启发式推导                                                  │
│       final_status / verification_result / route_judgment /    │
│       discovery_judgment / execution_judgment / cost_class /   │
│       error_profile / confidence …                             │
│  ③ resolve_posterior_signal(user_text / score / explicit)      │
│       └─ accepted / corrected / rejected / unknown              │
│  ④ primary_stage_from_outcome → 决定 PolicyDelta 落到哪个决策点│
│  ⑤ compute_policy_delta → 算 direction & magnitude              │
│  ⑥ apply_policy_delta → 写入 task_policy_priors（McpStore）    │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       下一次同指纹任务进来 → 回到顶部，priors 已经更新
```

### 模块树

```
deeting/src-tauri/src/modules/desktop_runtime/runtime/
├── AGENTS.md                  // Sovereign Charter（架构纪律）
├── task_learning/
│   ├── mod.rs                 // re-exports
│   ├── types.rs               // TaskFingerprint / EvaluatedOutcome / PolicyDelta / 6 个 DECISION_POINT
│   ├── fingerprint.rs         // build_task_fingerprint（8 维度分类器）
│   ├── policy.rs              // query_task_policy_hint / apply_route_prior / apply_policy_delta / decay
│   ├── evaluator.rs           // evaluate_task_learning（纯启发式，无二次模型调用）
│   └── revision.rs            // 历史回放、人工修订
├── posterior_signal/
│   ├── mod.rs
│   ├── types.rs               // PosteriorSignalKind / Source / Input / Decision
│   ├── rules.rs               // 启发式规则（explicit_outcome / score / user_text）
│   └── resolver.rs            // 多规则裁决 + ≥0.5 置信度阈值
├── sovereign/
│   ├── mod.rs                 // Self_::consult / DecisionLocus / Observation / Ingress trait
│   └── ingress.rs             // PosteriorSignalIngress / TaskExecutionIngress / UserActionIngress / ExternalIngress
└── ../../providers/store/bandit.rs   // Thompson / ε-greedy 多臂老虎机
```

## 4. 数据骨架：TaskFingerprint

自进化的**最小学习单元**不是 query 文本，而是**任务指纹**——把 query 压成 8 个语义维度，相同指纹的任务共享同一组 priors。

定义在 [`task_learning/types.rs::TaskFingerprint`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs)，由 [`fingerprint.rs::build_task_fingerprint`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs) 产出：

| 维度 | 取值 | 例子 |
|---|---|---|
| `goal_shape` | investigate / repair / transform / orchestrate / produce / answer | "排查 / 修复 / 迁移 / 自动化 / 实现 / 问答" |
| `output_shape` | artifact / diagnosis / comparison / changed_state / explanation | "代码补丁 / 根因 / 对比 / 状态变更 / 解释" |
| `scope_shape` | batch / open_ended / single_target | "全部文件 / 架构级 / 单点" |
| `risk_class` | destructive / approval_sensitive / high_regret / low | "删除 / 涉密 / 生产 / 普通" |
| `execution_pressure` | high / medium / low | 是否需要真正改变状态 |
| `discovery_pressure` | high / medium / low | 是否依赖外部检索 |
| `environment_dependency` | high / medium / low | 是否依赖本机现场 |
| `verification_demand` | strict / normal / weak | 是否必须验证 |

整体序列化后 SHA-1 → `fingerprint_key`，这是先验表的主键。

> **为什么不用 embedding？** embedding 会让"自进化"变成连续空间里的黑盒搜索，**无法 PR review**。8 个枚举维度都是工程师能看懂、能在 commit message 里写出来的标签。这是刻意的可解释性取舍。

## 5. 决策点（DecisionLocus）

Deeting **不学"模型应该说什么"**，只学**这一类任务在 6 个工程决策点上应该偏向哪种做法**：

| 决策点 | 备选 action | 含义 |
|---|---|---|
| `route` | `direct` / `worker` | 主线程直接跑还是丢给 worker |
| `worker_selection` | `<profile_id>` | 选哪个 custom task agent profile |
| `discovery` | `search_sdk_early` | 是否早早调 `search_sdk` 拉外部检索 |
| `capability_attach` | `attach_capability` | 是否动态接入 MCP 能力 |
| `execution` | `execute_code_plan` | 是否升级到代码执行 plane |
| `verification` | `stronger_checks` | 是否对结果做更强验证 |

规范字符串常量在 [`types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs)（`DECISION_POINT_*` / `ACTION_*`），运行时类型在 [`sovereign/mod.rs::DecisionLocus`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs)。两者通过单元测试 `decision_locus_strings_match_canonical_constants` 强制 1:1 对齐。

**重要**：新加决策点的成本是高的。每加一个就要：
- 在 types.rs 加常量
- 在 DecisionLocus 加变体
- 在 evaluator.rs 加 `derive_*_judgment`
- 在 `compute_policy_delta` 加分支
- 在 `apply_route_prior`（如果是路由型）加权重融合
- 在 chat_tool_runtime 找一个明确的 gate 调用 `Self_::consult`

不要为了"看起来更全"就加。每个决策点必须能产出可观测、可评估、可回滚的行为。

## 6. Sovereign Charter（最重要的纪律）

如果说 RAG 子系统的红线是 [No Double Lifecycle Rule](./rag-architecture.md#6-no-double-lifecycle-rule最重要的规则)，自进化子系统的红线就是 **Sovereign Charter**（[`runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)）。

它由四条核心承诺构成：

### 6.1 The Self（决策中心）
唯一决定 Deeting 如何调整自己的实体。今天它分布在 `task_learning/policy.rs` 和 `chat_tool_runtime/mod.rs` 的安全门里；长期目标是 `Self_::decide(locus, observation) -> Decision` 一个入口。**调用方永远不能跨过 `Self_` 直接去问底层的 bandit / scorer**。

### 6.2 Canonical Substrate（自有词汇）
类型名描述**观察到的现象**，不描述任何理论。允许：`TaskFingerprint`、`EvaluatedOutcome`、`PolicyDelta`、`effective_weight`、`confidence`、`evidence_count`、`maturity`。**禁止**：`Fitness`、`Gene`、`Mutation`、`Phenotype`、`EvolutionEngine`、`GDI` 等出现在核心代码里——它们只允许出现在某个 `ingress/sources/<name>.rs` 这一个边界文件里。

### 6.3 Ingress（输入边界）
所有信号源**平权**。用户操作、工具轨迹、后验信号、未来的外部能力源（EvoMap GEP capsule / 朋友共享技能 / GitHub 模式 / 合成数据），都通过 `trait Ingress` 进来，对核心系统而言只有一个不透明的 `SourceTag`。

> 现存四种 Ingress 都在 [`sovereign/ingress.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/ingress.rs)：`PosteriorSignalIngress` / `TaskExecutionIngress` / `UserActionIngress` / `ExternalIngress`。新信号源**只往这里加文件**，不动核心类型。

### 6.4 Boundary Translation（防腐层）
外部协议进来时，必须在自己的 `ingress/sources/<name>.rs` 里完整翻译成 `Observation`。**`Gene`、`Capsule` 等外部术语不允许泄漏到核心模块**。删掉任何一个 boundary 文件，核心 `cargo check` 必须依然通过。

### 6.5 不可越线（PR review 拒绝清单）

- ❌ 给类型改名为 `Fitness` / `Gene` / `Mutation`
- ❌ 把 `effective_weight` 改成 `fitness`
- ❌ `if source == "evomap" { ... }` 出现在 boundary 文件之外
- ❌ 提高 `ROUTE_BANDIT_COEFF` 让 bandit 独自能翻盘
- ❌ 删除 `decision_has_safety_lock` 检查"为了简化"
- ❌ 让外部源比 user_action 更"权威"
- ❌ 增加只对某一个外部源有意义的字段到 canonical 类型上

完整的反模式列表见 [`runtime/AGENTS.md` §ANTI-PATTERNS](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)。

## 7. 评估管线（Evaluator）

定义在 [`task_learning/evaluator.rs::evaluate_task_learning_with_runtime`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)。

```text
input:
  - TaskFingerprint
  - LocalRouteDecision（这次走的路由）
  - LocalExecutionPolicy（这次的执行平面）
  - response_text + finish_reason
  - tool_trace_blocks（所有工具调用的结果）
  - delegated_execution（如果有 worker 委托）
  - user_response_signal（如果有用户事后信号）

step 1: collect_task_learning_signals(trace)
        → TaskLearningSignals { tool_call_count, search_sdk_calls,
          used_attach_capability, used_execute_code_plan,
          attach_capability_errors, observed_error_codes, ... }

step 2: heuristic_pass
        derive_final_status        // success / partial / failed / blocked
        derive_verification_result // passed / weak_pass / unverified / failed
        derive_route_judgment      // good / acceptable / wasteful / wrong
        derive_discovery_judgment  // sufficient / shallow / excessive / skipped_when_needed
        derive_execution_judgment  // justified / fragile / failed
        derive_cost_class          // low / medium / high / disproportionate
        derive_retry_profile       // none / light / heavy / looping
        derive_error_profile       // none / recoverable / structural / environment_blocked
        derive_confidence          // 0.0 - 1.0

step 3: resolve_posterior_signal(user 事后输入)
        → accepted / corrected / rejected / unknown
        → 只在 confidence ≥ 0.5 时被采纳

step 4: primary_stage_from_outcome
        按优先级决定这次"主要在哪个决策点上学到了东西"：
        worker_selection > verification（如果用户 corrected/rejected）
                          > route（如果 wasteful/wrong）
                          > discovery > capability_attach > execution
                          > verification（兜底）> route（兜底）

step 5: compute_policy_delta
        decision_point / action_key / direction(strengthen|weaken) / magnitude / state(provisional|confirmed)

step 6: apply_policy_delta(store, fingerprint_key, delta)
        → 写入 task_policy_priors 表
```

**关键纪律**：

- 任务评估**只用启发式**，不在评估阶段二次调用模型。这条边界由 `evaluate_task_learning_with_runtime` 的同步签名保护——它不再依赖 `AppState` / `LocalModelConnection`。
- `learning_eligible` 卡控：环境阻塞、blocked、置信度 < 0.45 且无后验信号的样本，**不写入先验**。脏数据宁可丢，也不要污染。

## 8. Prior 更新 & 衰减

写入在 [`policy.rs::apply_policy_delta`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)：

```text
signed_delta = direction == "strengthen" ? +|magnitude| : -|magnitude|
store.apply_task_policy_delta(
    fingerprint_key,
    decision_point,
    action_key,
    signed_delta,
    state,            // "provisional" / "confirmed"
    confidence,       // 0..=1
    run_id,
)
```

读取与衰减在 `query_task_policy_hint`：

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;
fn decay_weight(raw, updated_at, now) -> f64 {
    let age = now - updated_at;
    raw * 0.5_f64.powf(age / PRIOR_HALF_LIFE_MS)
}
```

**21 天半衰期**意味着：

- 一个月前学到的强偏好，今天大约只剩 1/3 权重。
- 三个月前的偏好基本被遗忘，让位给最近的数据。
- 不需要"主动清洗"，自动忘记是基础设施特性。

`recommended_action` 的阈值是 `effective_weight > 0.1`：弱信号不出推荐。

## 9. 路由融合（apply_route_prior）

定义在 [`policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)。

```text
direct_score = (base_decision == direct ? 1.0 : 0.0) + prior_direct_weight
worker_score = (base_decision == worker ? 1.0 : 0.0) + prior_worker_weight
direct_score += 0.25 * bandit_direct_score   // ROUTE_BANDIT_COEFF
worker_score += 0.25 * bandit_worker_score

preferred = arg max(direct_score, worker_score)
override_applied =
       NOT has_safety_lock(base_decision)
   AND has_signal
   AND preferred != base_decision.route
   AND |direct_score - worker_score| >= 0.35   // ROUTE_OVERRIDE_THRESHOLD
```

三道关：

1. **安全锁优先**：`explicit_route` / `explicit_task_agent` / `destructive_intent` / `approval_sensitive` / `mutating_capability` / `high_risk_capability` —— 任何一个出现，prior 都不能翻盘。
2. **bandit 系数 = 0.25**：bandit 是平局拆解，不是判官。即使 bandit 给 direct 满分（1.0）、给 worker 零分（0.0），它带来的差距只有 0.25，**单独不够触发 0.35 翻盘阈值**。这是测试 `apply_route_prior_bandit_scores_surface_on_application` 强制保证的不变式。
3. **0.35 翻盘阈值**：差距不足就只在 reasons 里追加 `task_learning_route_prior_observed`，**不改 route**。可观测但不行动，是 Deeting 学到不确定信号时的默认姿态。

## 10. 后验信号（Posterior Signal）

定义在 [`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/)。

**输入来源**（按优先级）：

1. `explicit_outcome`：用户在 UI 上明确点了 accept / correct / reject。
2. `feedback_score` + `feedback_comment`：±1 评分 + 文本注释。
3. `user_text`：用户接下来一条消息的文本（启发式判别是肯定 / 否定 / 修正）。

裁决：[`resolver.rs::resolve_posterior_signal`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs) 按优先级顺序尝试三类规则，第一个命中的获胜。

**应用门槛**：[`should_apply_posterior_signal`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs)
- source 不能是 `Unknown`
- signal 不能是 `unknown`
- confidence ≥ 0.5

**协议版本号**：`posterior-signal/v1`，跟 envelope 一样，将来要做 incompatible change 必须改版本号。

## 11. Bandit 机制（平局拆解）

完整实现在 [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs)，多臂结构通过 `BANDIT_SCENE_TASK_ROUTE` 命名隔离。

调用入口：[`policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)。

```rust
let arms = provider_store.list_bandit_arm_states(BANDIT_SCENE_TASK_ROUTE).await?;
let strategy = BanditStrategy::parse(arm.strategy).unwrap_or(Thompson);
let cfg = BanditConfig { epsilon: arm.epsilon, ..default };
let direct = score_arm(find("direct"), strategy, &cfg, &mut rng);
let worker = score_arm(find("worker"), strategy, &cfg, &mut rng);
RouteBanditScores { direct, worker }
```

策略可在 store 层切换（Thompson Sampling / ε-greedy），coefficient 锁在 `ROUTE_BANDIT_COEFF = 0.25` 不允许在业务层调高。

## 12. 显式反馈经验回路（Explicit-Feedback Experience Loop）

§7-§11 描述的是**先验回路**：用启发式判官把每次执行落成一行 `task_policy_priors`（数字权重）。本节描述与它**并行**的另一条回路——**经验回路**，住在 [`evolution/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/) 模块。

它解决的不是"下次该往哪条路由走"，而是：

> 下次同类任务进来时，**让模型在 system prompt 里看到过去同类任务的经验文字**。不修改它的决策，只递给它冷启动上下文。

两条回路并存、互不污染：

| 维度 | 先验回路（§7-§11） | 经验回路（本节） |
|---|---|---|
| 数据落点 | `task_policy_priors`（数字权重） | `evolution_cases`（自然语言摘要） |
| 输入证据 | 启发式判官 + 后验信号 | **只能**是 `ExplicitTraceFeedback`（用户显式 Accept / Reject / Correct） |
| 注入位置 | 路由 / 工人选择层（决策融合） | 冷启动 system message（`ColdStartPacket`） |
| 注入强度 | 加权融合，达到阈值会翻盘 | **只读引导**，模型可忽略 |
| 学习触发 | 每次任务跑完都计算 | 仅在显式反馈到达时升格 |

### 12.1 拓扑

```text
任务结束 → 用户在 UI 上点 Accept / Reject / Correct
              │
              ▼
        ExplicitTraceFeedback 信号
              │
              ▼
  submit_evolution_signal（evolution/service.rs）
              │
   ┌──────────┴──────────────────────────────────┐
   ▼                                             ▼
持久化为 EvolutionSignal                     route_case_type
（带 fingerprint_key、trace_id、run_id）       (Rejected  → Negative case)
                                              (Accepted  → Reference case)
                                              (Corrected → Constraint case)
                                                   │
                                                   ▼
                                          evolution_cases 表
                                                   │
        下一次同 fingerprint_key 任务开始：
                                                   ▼
  build_cold_start_packet → ColdStartPacket {
      priors_summary,    // 来自 task_policy_priors（read-only 投影）
      reference_cases,   // 至多 2 条
      negative_cases,    // 至多 2 条
  }
                                                   │
                                                   ▼
  render_cold_start_packet_prompt → 注入 system message
                                                   │
                                                   ▼
                                              模型自由决策
```

### 12.2 信号源分类（EvolutionSignalSource）

[`evolution/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/types.rs) 列出五种信号源，但**只有一种**允许升格为 Case：

| 信号源 | 入口 | 是否允许升格为 Case |
|---|---|---|
| `ExplicitTraceFeedback` | `admin/commands.rs`（用户 UI 点 Accept / Reject / Correct） | ✅ **唯一**允许 |
| `DeetingThink` | `chat_tool_runtime/mod.rs`（任务前预飞行计划） | ❌ 仅持久化为审计信号 |
| `ManualTaskLearningRevision` | `admin/commands.rs`（人工修订历史 run） | ❌ 仅持久化为审计信号 |
| `MonitorObservation` | `monitor/mod.rs`（运行时监控观察） | ❌ 仅持久化为审计信号 |
| `MonitorFeedback` | `monitor/workflow.rs`（监控反馈分数） | ❌ 仅持久化为审计信号 |

**为什么死锁在用户显式反馈**：这条边界是 charter invariant。任何"程序自己判断这次跑得好"或"另一个模型判断这次跑得好"都会构成隐藏的二级 agent，污染经验库。Gate 写死在 [`service.rs::route_case_type`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs)，由 `reference_case_does_not_trigger_for_other_sources_with_accepted` / `constraint_case_does_not_trigger_for_other_sources_with_corrected` / `monitor_feedback_rejected_does_not_trigger_negative_case` 多重测试守护。

### 12.3 Case 升格规则

`(source, classification) → case_type` 映射（[`service.rs::route_case_type`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs)）：

| classification | case_type | 含义 |
|---|---|---|
| `Rejected`  | `Negative`   | "下次同类任务避免这种 framing" |
| `Accepted`  | `Reference`  | "下次同类任务可以参考这种回答" |
| `Corrected` | `Constraint` | "下次同类任务必须遵守这条边界" |
| `Neutral` / `Unknown` | — | 不升格，仅持久化为信号 |

升格成功后，`EvolutionSignal.status` 由 `Classified` 推进到 `Applied`；写入 `evolution_cases` 时携带 `fingerprint_key` + `source_run_id` + `evidence_signal_ids`，保留追溯链。Case 摘要由 [`service.rs::render_case_summary`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/service.rs) 纯函数从用户 note 直接拼出，缺省 note 时落到固定 placeholder——**不调用任何模型**做润色或重写。

### 12.4 冷启动包（ColdStartPacket）

构建入口在 [`evolution/packet.rs::build_cold_start_packet`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/packet.rs)，由 [`local_orchestrator/workflow.rs`](../deeting/src-tauri/src/modules/desktop_runtime/local_orchestrator/workflow.rs) 在每次任务启动时调用。

渲染模板（任一段缺失则该段被省略）：

```text
## Evolution Context (from prior runs of similar tasks)
These notes are guidance only — use them when assessing context. Do not treat
them as overriding the user's current request.

### Prior direction         ← priors_summary（read-only 投影自 §8）
- route:direct (favor, weight +0.42, confidence 0.71)
- discovery:search_sdk_early (avoid, weight -0.18, confidence 0.55)

### Reference cases — past successes for this task family
- User accepted the assistant's prior response with note: ...

### Negative cases — avoid repeating
- User rejected the assistant's prior response with note: ...
```

Token 预算（[`packet.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/evolution/packet.rs) 顶部常量）：

| 段 | 上限 | 出处 |
|---|---|---|
| `priors_summary` | 200 token（≈ 800 字符） | `PRIORS_SUMMARY_CHAR_BUDGET` |
| `reference_cases` + `negative_cases` 合计 | 600 token（≈ 2400 字符） | `CASES_CHAR_BUDGET`，由 `enforce_case_budget` 按 `confidence × recency_decay` 最低处先丢 |
| 每段单类 Case 数 | 2 条 | `CASE_PACKET_PER_TYPE_LIMIT` |
| Case 半衰期 | ≈ 14 天（`exp(-age_days/20)`） | `CASE_HALFLIFE_DAYS` |
| Prior 半衰期 | 21 天 | `PRIOR_HALF_LIFE_MS`，与 §8 一致 |

**只读纪律**：`priors_summary` 段从 `task_policy_priors` 读出后衰减展示，**永不写回**。`task_learning::policy::apply_policy_delta` 仍然是 priors 表的唯一写入点。

### 12.5 不可越线（PR review 拒绝清单）

- ❌ 让 `ExplicitTraceFeedback` 以外的任何信号源升格 Case（charter invariant，由 `route_case_type` gate 强制）
- ❌ 在 `evolution/packet.rs` 或 `service.rs` 里调用任何模型给 case 打分、重写摘要、生成新 case
- ❌ 把 `ColdStartPacket` 的内容标记为"必须遵守"——它是 guidance，render 模板里的免责声明不能删
- ❌ 让 `evolution/packet.rs` 写 `task_policy_priors` 表（priors 写入路径由 `task_learning::policy::apply_policy_delta` 独占）
- ❌ 把 Case 摘要异步化或丢到 LLM 后处理 pipeline 去"润色"——摘要由 `render_case_summary` 纯函数从用户 note 直接拼
- ❌ 在 `evolution_cases` 之外开辟第二个"经验"存储位置

## 13. Self_ Consult API

调用方推荐姿势（[`sovereign/mod.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs)）：

```rust
use sovereign::{Self_, DecisionLocus};

let advisory = Self_::consult(
    &app_state.mcp_store,
    DecisionLocus::Route,
    user_query,
    8, // limit
).await;

let weight = advisory.weight_for("direct");
let recommended = advisory.recommended_action();
let gate_meta = advisory.gate_meta("direct"); // 喂进 tool-call telemetry
```

**不要绕过 `Self_` 直接调 `task_learning::query_task_policy_hint`**。`Self_` 是未来融合 bandit、安全过滤、新机制的统一入口，绕过它等于把未来的扩展点钉死在调用方。

`Self_::consult_named(store, "discovery", ...)` 是给 stringly-typed 调用方的过渡桥，新代码用强类型 `DecisionLocus`。

## 14. 端到端流程：一次任务的完整生命周期

```text
T0  ─ user query "把 src 下所有 ts 文件改成 tsx"
T1  ─ build_task_fingerprint → {goal_shape: transform, scope_shape: batch, ...}
T2  ─ Self_::consult(Route, query)
       └─ 命中 fingerprint_key=abc 的两条 prior：
           direct  effective_weight = 0.18 (provisional, 3 evidence)
           worker  effective_weight = 0.42 (confirmed,  9 evidence)
T3  ─ base router 算出 direct（capability 充足）
T4  ─ apply_route_prior(direct, hint, bandit)
       direct_score = 1.0 + 0.18 + 0.25*0.5 = 1.305
       worker_score = 0.0 + 0.42 + 0.25*0.4 = 0.520
       不翻盘（差距 > 0.35 但 preferred==base）
T5  ─ chat_tool_runtime 走 direct 路径，调 5 个工具，1 个报错
T6  ─ 模型给出补丁，response_text 非空
T7  ─ evaluate_task_learning_with_runtime
       signals = { tool_call_count: 5, tool_error_count: 1, ... }
       final_status         = partial
       route_judgment       = acceptable
       discovery_judgment   = sufficient
       execution_judgment   = justified
       error_profile        = recoverable
       confidence (启发式)   = 0.55
T8  ─ 用户回了 "perfect"
       resolve_posterior_signal → accepted, source=user_text, confidence=0.7
       outcome.user_response_signal = "accepted"
T9  ─ primary_stage = route（无 corrected/rejected, route 不是 wrong/wasteful）
       PolicyDelta {
         decision_point: "route",
         action_key:     "direct",
         direction:      "strengthen",
         magnitude:      0.18 + 0.55*0.22 * 0.8 ≈ 0.245
         state:          "confirmed" (confidence ≥ 0.8? 否 → "provisional")
       }
T10 ─ apply_policy_delta 写入 priors 表（direct weight 升至 ~0.44）

下一次类似任务进来：
T0' ─ user query "把 lib 下所有 js 文件改成 ts"
T1' ─ 同一个 fingerprint_key=abc
T2' ─ direct prior 已经更大，更倾向 direct
       但只要 query 带 destructive 词（如 "删除老文件"），safety lock 仍然
       会拦下 prior 翻盘
```

## 15. 文件地图

按"我想改什么"反向定位：

| 我想… | 看这里 |
|---|---|
| 改任务指纹的分类规则 | [`task_learning/fingerprint.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs) |
| 改先验的衰减周期 / 翻盘阈值 / bandit 系数 | 顶部常量 in [`task_learning/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| 改启发式判官（route/discovery/execution） | [`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) `derive_*_judgment` |
| 改 PolicyDelta 的算法 | [`evaluator.rs::compute_policy_delta`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| 改"哪个决策点这次承担学习"的归因 | [`evaluator.rs::primary_stage_from_outcome`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs) |
| 改后验信号识别 | [`posterior_signal/rules.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/rules.rs) + [`resolver.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/resolver.rs) |
| 加新决策点 | §16.1 |
| 加新外部信号源（EvoMap / 朋友共享技能 / 合成数据） | §16.2 |
| 改 bandit 策略（Thompson / ε-greedy） | [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) + `arm.strategy` 字段 |
| 改 safety lock 名单 | [`policy.rs::decision_has_safety_lock`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| 查看 / 回放历史 run | [`task_learning/revision.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/revision.rs) |
| 调用入口（推荐用 Self_） | [`sovereign/mod.rs::Self_::consult`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs) |

## 16. 怎么扩展

### 16.1 加一个新的决策点（例：`memory_write`）

> 场景：你想让 Deeting 学会"这一类任务该不该往长期 memory 里写"。

1. 在 [`task_learning/types.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/types.rs)：
   ```rust
   pub(crate) const DECISION_POINT_MEMORY_WRITE: &str = "memory_write";
   pub(crate) const ACTION_MEMORY_WRITE_STRONG: &str = "memory_write_strong";
   ```
2. 在 [`sovereign/mod.rs::DecisionLocus`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/sovereign/mod.rs) 加 `MemoryWrite` 变体，更新 `as_canonical_str` / `from_canonical_str` 和 `decision_locus_strings_match_canonical_constants` 测试。
3. 在 [`policy.rs::normalize_decision_point`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) 加别名映射、`guidance_for_decision_point` 加引导文案。
4. 在 [`evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)：
   - 加 `derive_memory_write_judgment(...)`
   - 在 `compute_policy_delta` 的 `match primary_stage` 里加分支
   - 在 `primary_stage_from_outcome` 决定它的归因优先级
5. 在 chat_tool_runtime 找一个明确的位置 `Self_::consult(MemoryWrite, query)`，把 `gate_meta` 写进遥测。
6. 写一个端到端测试：构造一次任务、产出 trace、断言 prior 写入并被下一次读取。

**最关键的判断题**：这个决策点的 action 是不是 **runtime 自己能选** 的？如果选择权在用户（如"该不该删文件"），那它属于 safety lock 范畴，**不该**做成自进化决策点。

### 16.2 加一个新的外部信号源（例：EvoMap GEP capsule）

1. 新建 `runtime/sovereign/ingress/sources/evomap.rs`（这是 boundary 文件）：
   ```rust
   //! EvoMap GEP capsule ingress.
   //!
   //! Borrowing concept: GDI ranking methodology. Vocabulary stays local.
   //! `GepCapsule`, `Fitness`, `Gene` appear nowhere outside this file.

   use crate::modules::desktop_runtime::runtime::sovereign::{
       Ingress, Observation, SourceTag,
       TaskExecutionIngress, PosteriorSignalIngress,
   };

   pub(crate) struct EvoMapIngress { /* foreign payload here */ }

   impl EvoMapIngress {
       pub(crate) fn into_observation(self) -> Observation {
           // 翻译成 TaskExecution / UserSignal / External 中能映射的那一个
           // 不能映射的字段直接丢，不要污染 canonical 类型
       }
   }

   impl Ingress for EvoMapIngress {
       fn source_tag(&self) -> SourceTag {
           SourceTag::new("evomap_gep_v1")
       }
   }
   ```
2. **不要**在 `task_learning/` 或 `sovereign/mod.rs` 任何地方引用 `GepCapsule` / `Gene` / `Fitness`。
3. 写一个 invariant 测试：删除这个 boundary 文件后 `cargo check -p deeting-tauri` 必须仍然绿。
4. PR 描述里说明"借鉴 EvoMap GDI 方法论"作为出处，但**不要**把这个出处写进核心类型名。

### 16.3 改半衰期 / 翻盘阈值 / bandit 系数

只改 `policy.rs` 顶部三个常量：

```rust
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
const ROUTE_BANDIT_COEFF: f64 = 0.25;
```

调高 `ROUTE_BANDIT_COEFF` 之前**必须**回到 §6.5 复读一遍："Bandit 不能独自翻盘"是 charter 的硬性 invariant，由测试 `apply_route_prior_bandit_scores_surface_on_application` 守护。如果改了系数让 bandit 能独自翻盘，这条测试会红——别"修复"它，回去想清楚。

## 17. 反模式（PR review 时拒绝）

- 把 `effective_weight` 重命名为 `fitness`
- 在 `query_task_policy_hint` 之外的地方做先验衰减（双重衰减）
- 给某个外部信号源加 `if source == "x"` 分支到核心代码
- 在任务评估阶段二次调用模型给自己打分（评估必须保持启发式纯函数）
- 把 `should_apply_posterior_signal` 的阈值降到 0.5 以下（噪声会污染先验）
- 把 prior 的写入路径"简化"成绕过 `apply_task_policy_delta`
- 在 chat_tool_runtime 里直接调 bandit，绕过 `Self_::consult` + `apply_route_prior`
- 把 `decision_has_safety_lock` 检查"重构"成可配置（safety lock 必须硬编码）
- 加一个新的 ingress 但不实现 `Ingress` trait 而是直接塞进 `Observation::TaskExecution`
- 给 canonical 类型加只有外部源用得到的字段（substrate drift）

## 18. 已知决策与权衡

| 决策 | 为什么 |
|---|---|
| 用 8 维度枚举指纹而不是 embedding | 可解释、可在 PR 里讨论；embedding 让自进化变成黑盒 |
| 半衰期 21 天 | 工作内容大概以 sprint 节奏变化；超过 1 个月的偏好通常不再适用 |
| 翻盘阈值 0.35 | 经验上小于 0.3 会让 prior 太激进；大于 0.4 让学习几乎不影响行为 |
| Bandit 系数 0.25 | 让 bandit 永远做不到独自翻盘（0.25 × 1.0 = 0.25 < 0.35） |
| 任务评估只用启发式，不二次调模型 | "模型给模型打分"会构成隐藏的二级 agent，且把评估从纯函数变成异步状态依赖；用户显式反馈才是更强的证据来源 |
| 先验衰减不主动清洗 | 自然遗忘 > 主动 GC；不需要后台任务、不需要存活窗口配置 |
| 把 charter 写成 AGENTS.md 而不是设计文档 | "已经在做的事"的纪律 > "想要做的事"的设计；先把现状名命好，再讨论改进 |

## 19. 验证清单

改动自进化链路的 PR 必须自检以下相关项：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib posterior_signal --no-fail-fast`
- [ ] `cargo test --lib sovereign --no-fail-fast`
- [ ] `cargo test --lib chat_tool_runtime --no-fail-fast`
- [ ] `apply_route_prior_does_not_override_safety_locked_*` 仍然绿
- [ ] `apply_route_prior_bandit_scores_surface_on_application` 仍然绿（bandit 无法独自翻盘）
- [ ] `decision_locus_strings_match_canonical_constants` 仍然绿
- [ ] 词汇 lint：`fitness` / `gene` / `gep` / `evolver` / `phenotype` 不出现在 `ingress/sources/*.rs` 之外
- [ ] 桌面端手测：同一个任务跑 3 次，观察 priors 表是否有 delta；故意点 reject，下一次同指纹任务路由是否倾向变化

> Windows 主机已知 caveat：`cargo test` 的二进制偶尔会因 DLL 加载失败启动失败（STATUS_ENTRYPOINT_NOT_FOUND）。区分"编译失败"和"运行失败"——前者必须修，后者通常是宿主环境问题，应在 CI/Linux 复跑。

## 20. FAQ

**Q：为什么不直接让 LLM 写一段 "self-reflection" 然后照着改自己的 prompt？**
A：因为：(1) 自由文本反思不可 PR review、不可回滚、不可解释；(2) LLM 反思自己时倾向自我强化，没有外部 ground truth 制衡；(3) Deeting 的目标是"调整自己的行为"，不是"修改自己的 prompt"——后者是 prompt engineering，前者是策略学习。

**Q：自进化和 RAG 是什么关系？**
A：相互独立但配合。RAG（Context Orchestrator）解决"这一轮该不该 / 怎么去查上下文"；自进化（Sovereign）解决"这一类任务整体该不该走 worker / 早一点 search / 升级到 execute_code_plan"。前者管单轮 IO 边界，后者管跨任务行为漂移。

**Q：能不能加一个"用户最喜欢的回答风格"的决策点？**
A：能，但请非常小心。`verification` 决策点已经吸收了"用户是否接受"的信号。再加一个"风格偏好"很容易变成对单一用户过拟合，最后产生"回声室"。如果一定要加，应该让 action 集合是**风格 family**（如简洁 / 详尽 / 步骤化），而不是连续参数。

**Q：half-life 太长导致旧 prior 阻塞新偏好怎么办？**
A：不要"清洗 prior"。正确做法是连续输入新信号——`apply_task_policy_delta` 会**直接覆盖式累加**，足够多新数据自然会把旧 prior 压下去。如果一类任务真的语义变了，它的 fingerprint 通常也会变，自然落到另一个 fingerprint_key 上。

**Q：可以让 Deeting 学到 "我不该问这个用户审批问题"这种偏好吗？**
A：**不能**。这违反 safety lock 的硬性 invariant。`approval_sensitive` 是 user-intent 表达，不是可学习偏好。所有"审批是否需要"的决定必须来自 query 本身的特征，不能来自历史先验。

**Q：未来想接入 EvoMap 真实的 GEP capsule，今天的代码做得到吗？**
A：做得到，但路径已经被 charter 钉死：在 `sovereign/ingress/sources/evomap.rs` 加一个 boundary 文件，翻译成 `Observation`。核心代码不会知道 EvoMap 的存在——它只看到一个 `SourceTag("evomap_gep_v1")`。删掉这个 boundary 文件，核心仍然 build green。

**Q：能不能让 Deeting 把"学到的偏好"export 出来给别人导入？**
A：技术上能（`task_policy_priors` 表 + fingerprint 是稳定的），但请把它当成新的 ingress 处理：导入方走 `ExternalIngress`，**不要**直接写 `task_policy_priors` 表，否则跨用户的污染没有审计点。

## 21. 参考

- Sovereign Charter（架构纪律）：[`deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/AGENTS.md)
- 决策融合实现：[`task_learning/policy.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- 评估管线：[`task_learning/evaluator.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/evaluator.rs)
- 任务指纹分类器：[`task_learning/fingerprint.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/fingerprint.rs)
- 后验信号：[`posterior_signal/`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/posterior_signal/)
- Bandit：[`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs)
- 配套的 RAG 文档：[`docs/rag-architecture.md`](./rag-architecture.md)
