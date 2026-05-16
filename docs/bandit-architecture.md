# Deeting Bandit 多臂老虎机使用解析

> 适用范围：Deeting 桌面端在路由、worker 选择、记忆召回三个决策点上的 multi-armed bandit 实现。
> 不覆盖：bandit 在自进化整体回路里的角色（见 [self-evolution-architecture.md](./self-evolution-architecture.md#11-bandit-机制平局拆解)）；Approval Gate 上的"工具调用允许 / 拒绝"决策——那不是 bandit 该解决的问题。

本文档面向想读懂"为什么一个桌面 AI 应用要引入推荐系统的算法"的人。我们会从历史动机讲起，拆开三种策略（Thompson / UCB / ε-greedy）的代码实现，逐一介绍三个使用场景，然后讨论为什么 Deeting 把 bandit 刻意限制为"平局拆解"而非"决策者"。

## 1. TL;DR

**Multi-armed bandit（多臂老虎机）** 是一个老掉牙的强化学习问题：你面前有 N 台老虎机（每台叫一个 *arm*），每台胜率不同但未知，你要在有限次拉杆里最大化总收益。它经典的应用是**推荐系统**——给用户展示哪条新闻 / 哪个商品 / 哪条广告。

Deeting 把它搬进桌面 agent 里，因为我们在三个场景**面对同样的形式问题**：

| 推荐系统的语义 | Deeting 的语义 |
|---|---|
| 给用户推什么新闻 | 这一类任务走 `direct` 还是 `worker` |
| 给用户推哪个商品 | 在 5 个 custom task agent profile 里挑哪一个 |
| 给用户推哪条搜索结果 | 在多条同样命中的记忆里强调哪一条 |
| 每条新闻"被点击 = 成功" | 每次决策"任务完成 = 成功" |
| 探索（exploration）vs 利用（exploitation） | 完全一样 |

但 **Deeting 不是推荐系统**。两个本质区别决定了我们如何**收敛地使用** bandit：

1. **bandit 不能独自做决定**。在 Deeting 里 bandit 是**平局拆解器**——只在其他证据（priors / safety locks / 用户显式指令）打成平手时才生效。系数永远是 `ROUTE_BANDIT_COEFF = 0.25`，单独作用打不破 `ROUTE_OVERRIDE_THRESHOLD = 0.35` 的翻盘阈值。
2. **失败的代价远大于成功的收益**。一次错路由 = 一个工具失败 = 用户多等几秒；一次错的工具执行 = 用户系统被破坏。bandit 算法本身**不知道**这个不对称——所以它的影响必须被外层硬上限锁死。

完整实现入口：

```
deeting/src-tauri/src/modules/providers/
├── bandit_selector.rs          // Thompson / UCB / ε-greedy 三种策略
├── bandit_selector_tests.rs    // 决定性测试
├── store/
│   ├── bandit.rs               // 持久化 + 反馈记录
│   └── mod.rs                  // 三个 BANDIT_SCENE_* 常量
└── types.rs                    // BanditArmState 数据结构
```

## 2. 多臂老虎机：1 分钟复习

**问题形式**：
- N 个 arm，每个 arm 拉一次以一定概率给一个 reward（成功 1 / 失败 0）。
- 每个 arm 的真实胜率 `p_i` 你不知道，需要通过拉杆估计。
- 总共能拉 T 次。

**目标**：最大化累积 reward。

**核心矛盾**：
- **Exploit（利用）**：一直拉目前看起来胜率最高的 arm → 但你可能错过了一个真正更好的 arm（只是恰好没拉过）。
- **Explore（探索）**：偶尔拉低胜率 arm → 试错本身要付出代价。

**和监督学习的本质区别**：监督学习有"对的答案"做训练数据；bandit 只能通过**主动尝试**来学习——每次决策同时是"动作"和"学习样本"。

**和强化学习的关系**：bandit 是 RL 的最简形式（无状态 / 单步 reward）。

经典策略：

1. **ε-greedy**：以概率 ε 随机探索，以概率 1-ε 选当前最优。简单粗暴但能用。
2. **UCB1**（Upper Confidence Bound）：选 `平均胜率 + c × sqrt(ln(N)/n_i)`——拉得越少的 arm 上界越高，自然被探索。
3. **Thompson Sampling**：对每个 arm 维护一个 Beta(α, β) 分布，每次抽一个样本，选样本最大的。从贝叶斯角度自动平衡探索与利用。

Deeting **三种都实现了**，可在 store 层切换（详见 §4）。

## 3. 为什么要在 Deeting 里用？

Deeting 是 local-first 桌面 agent，不是 Netflix。把推荐系统的算法搬进来听起来很奇怪。但你只要把"用户"换成"模型本身"，问题形式就重合了：

### 场景类比表

| 推荐系统 | Deeting | arm 是什么 | reward 是什么 |
|---|---|---|---|
| 给 user 推新闻 | 给同一类任务选路由 | `direct` / `worker` 两个 arm | 任务完成 = 成功 |
| 给 user 推商品 | 给同一类任务选 worker profile | 各个 custom task agent profile | 委托完成且用户接受 = 成功 |
| 给 user 推搜索结果 | 在记忆库召回时探索冷条目 | 各候选记忆条 | 被命中 / 被用户接受 = 成功 |

**Deeting 在这三个场景都遇到完全一样的工程问题**：

1. **真值未知**：哪条路由 / 哪个 profile / 哪条记忆"更好"，没人能事先告诉系统。
2. **观察延迟**：决策当下不知道结果，要等任务跑完、用户给反馈才知道好坏。
3. **稀疏反馈**：用户多数情况下沉默（既不夸也不骂），需要从稀疏信号里学。
4. **冷启动**：新装的 worker profile、新建的任务指纹，零历史数据。
5. **非平稳**：用户的实际偏好会随时间漂移——三个月前最优的 worker，今天可能不再是最优。

这五条**都是 bandit 文献里反复研究过的问题**——直接复用现成方法学比自己从零设计要稳。

### 为什么不直接用监督学习？

监督学习需要"对的答案"。但 Deeting 这三个场景**没有 ground truth**——没有人能告诉系统"这个查询其实应该走 worker"。我们只有用户事后是否接受 / 工具是否报错 / 总耗时多长 / 是否触发了重试 …… 这些都是**间接 reward 信号**，正是 bandit 的标准输入。

### 为什么不直接用启发式规则？

启发式规则（"长查询走 worker、短查询走 direct"）在每个用户身上的最优阈值不同，且会随用户行为模式漂移。Bandit 给了一条**让系统自己适应每个用户**的路径，比静态规则更长期友好。

### 为什么不用更复杂的 RL？

因为我们的场景**真的就是 bandit 形式**：决策互相独立、reward 立刻可观察、状态空间已经被 `TaskFingerprint` 离散化了（见 [self-evolution §4](./self-evolution-architecture.md#4-数据骨架taskfingerprint)）。引入 MDP / Q-learning / Policy Gradient 会让算法复杂度爆炸，但**收益边际为零**——形式问题就是 bandit，杀鸡不需要牛刀。

## 4. 三种策略的代码实现

[`bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs)。三个策略共享统一接口：

```rust
pub enum BanditStrategy {
    Thompson,
    Ucb,
    EpsilonGreedy,
}

pub fn score_arm<R: Rng + ?Sized>(
    state: Option<&BanditArmState>,
    strategy: BanditStrategy,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    match strategy {
        BanditStrategy::Thompson      => score_thompson(state, cfg, rng),
        BanditStrategy::Ucb           => score_ucb(state, cfg),
        BanditStrategy::EpsilonGreedy => score_epsilon_greedy(state, cfg, rng),
    }
}
```

### 4.1 BanditArmState（数据结构）

定义在 [`providers/types.rs`](../deeting/src-tauri/src/modules/providers/types.rs)：

```rust
pub struct BanditArmState {
    // ... scene / arm_id / strategy 等元数据
    pub alpha: f64,                  // Beta 分布参数：累计成功 + 先验
    pub beta: f64,                   // Beta 分布参数：累计失败 + 先验
    pub successes: i64,
    pub total_trials: i64,
    pub cooldown_until: Option<String>,  // 暂时不可选时间戳
    // ...
}
```

这是**贝叶斯 + 频率**混合数据：`alpha / beta` 给 Thompson 用，`successes / total_trials` 给 UCB 和 ε-greedy 用，二者每次反馈都同步更新。

### 4.2 Thompson Sampling

```rust
pub fn score_thompson<R: Rng>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    let (alpha, beta) = match state {
        None    => (cfg.thompson_prior_alpha, cfg.thompson_prior_beta),
        Some(s) => (s.alpha.max(EPS), s.beta.max(EPS)),
    };
    Beta::new(alpha, beta)
        .map(|dist| dist.sample(rng))
        .unwrap_or(0.5)
}
```

**直观解读**：
- 每个 arm 有自己的 Beta(α, β) 分布——成功多 α 大，失败多 β 大。
- 每次决策时**从分布抽一个样本**，选样本最大的 arm。
- 抽样过程**自动探索**：胜率不确定的 arm 分布宽，偶尔抽到很高的值就会被选中。
- 反馈累积后分布越来越尖，趋于纯利用。

**Deeting 默认用这个**。原因：
1. 不需要额外的 ε / c 超参（先验 α=β=1 就是均匀 Beta，无需调参）。
2. 探索与利用的平衡是**贝叶斯自然导出**的，不是手工拼凑。
3. 增量更新非常便宜：成功 `α += 1`，失败 `β += 1`。

### 4.3 UCB1（Upper Confidence Bound）

```rust
pub fn score_ucb(state: Option<&BanditArmState>, cfg: &BanditConfig) -> f64 {
    let state = state.unwrap_or_else(|| return 1.0);
    let total = state.total_trials.max(0) as u64;
    if total == 0 || total < cfg.ucb_min_trials {
        return 1.0;            // 强制让新 arm 至少被试 ucb_min_trials 次
    }
    let rate = state.successes as f64 / total as f64;
    rate + cfg.ucb_c * ((total as f64 + 1.0).ln() / total as f64).sqrt()
}
```

**公式**：`平均胜率 + c × sqrt(ln(N+1) / N)`

- 第一项：经验胜率（利用）
- 第二项：置信上界（探索）—— `c` 越大越偏探索

**Deeting 的特点**：
- `ucb_min_trials = 5`：新 arm 在被试满 5 次之前永远返回 1.0（最大值）——强制初始探索，避免"刚加进来就被抛弃"。
- `ucb_c = 1.5`：略大于经典值 √2 ≈ 1.41，倾向稍微多探索一点。
- 完全确定性（无随机），便于离线 replay 调试。

**适用场景**：当你希望每个 arm 都得到"公平的试用"时用 UCB——记忆召回的探索就用了类似思路（见 §5.3）。

### 4.4 ε-greedy

```rust
pub fn score_epsilon_greedy<R: Rng>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    if cfg.epsilon <= 0.0 {
        return score_success_rate(state);     // 纯利用
    }
    if rng.gen::<f64>() < cfg.epsilon {
        return rng.gen::<f64>();              // 以概率 ε 完全随机
    }
    score_success_rate(state)
}
```

**最简单**：以概率 ε 完全随机探索，以概率 1-ε 选当前最优。`epsilon` 默认 0.1。

**Deeting 保留这条路径主要为了**：
1. 与外部已有评估工具的对照基线。
2. 给单元测试一个确定性可控的策略（ε=0 时退化为纯 success_rate）。
3. 让用户/管理员可以**强制更激进的探索**（提高 epsilon）当怀疑 Thompson 收敛过快。

## 5. 三个使用场景

[`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs) 顶部三个 scene 常量：

```rust
pub const BANDIT_SCENE_TASK_ROUTE: &str       = "task_learning:route";
pub const BANDIT_SCENE_WORKER_SELECTION: &str = "task_learning:worker_selection";
pub const BANDIT_SCENE_MEMORY_RECALL: &str    = "memory:recall";
```

**scene 字段是命名空间隔离**——三个用途的 arm 不会互相污染，可以独立切换策略与超参。

### 5.1 Scene 1：路由（task_learning:route）

调用点：[`task_learning/policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)。

**Arms**：`direct` / `worker` 两个。

**Reward**：任务完成且没有"重路由"判断（见 [self-evolution §7](./self-evolution-architecture.md#7-评估管线evaluator) `route_judgment` 标签）。

**为什么是 bandit**：同一个任务指纹下，路由选择反复发生，每次都有可观察 reward——典型 stationary multi-armed bandit 设置。

**关键约束**：

```rust
const ROUTE_BANDIT_COEFF: f64 = 0.25;
// 在 apply_route_prior 里：
direct_score += 0.25 * bandit_direct_score;
worker_score += 0.25 * bandit_worker_score;
// 翻盘门槛：
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;
```

bandit 在这里被刻意限制：即使 bandit 给一边满分另一边零分，差距也只有 0.25，**不足以翻过 0.35 阈值**。这意味着 bandit **只在 prior + base router 已经接近平局时才有真实影响**——它是**平局拆解器**，不是判官。

测试 `apply_route_prior_bandit_scores_surface_on_application` 守护这条不变式。

### 5.2 Scene 2：Worker 选择（task_learning:worker_selection）

调用点：[`desktop_runtime/runtime/worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs)。

**Arms**：用户配置的所有 custom task agent profile。

**Reward**：worker 完成委托且没有 `worker_selection_judgment in (failed, unstable, blocked)`。

**为什么是 bandit**：用户可能配了 3-10 个 profile，每个 profile 对不同任务族擅长度不同，没人能手写一个静态规则说"这种任务用 profile X"。

**Cooldown**：

```rust
pub fn is_in_cooldown(state: &BanditArmState, now_rfc3339: &str) -> bool {
    match &state.cooldown_until {
        Some(until) => until.as_str() > now_rfc3339,
        None => false,
    }
}
```

如果一个 profile 最近连续失败，写入 `cooldown_until` → 暂时被 `select_arm` 跳过。直到冷却期满才重新参与抽样。这是为了避免"刚崩的 worker 被反复重试"。

**与路由场景的区别**：worker_selection **可以**直接由 bandit 决定选谁——因为这里不存在"用户显式指定"的安全锁优先级；选错 worker 的代价是任务慢一点 / 跑得没那么好，而不是不可恢复的系统破坏。这是工程语境决定的——bandit 在哪里"可以单独说话"是个**业务问题**，不是算法问题。

### 5.3 Scene 3：记忆召回探索（memory:recall）

调用点：[`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs) 搜索路径里。

**Arms**：候选记忆条目（每条记忆 `id` 就是 arm_id）。

**Reward**：被命中后用户没有"立刻撤回 / 否定"。

**为什么是 bandit**：
- 用户的记忆库里有大量条目，很多被检索后从未被实际使用。
- 纯相似度排序会让"冷门但实际相关"的记忆永远沉底。
- bandit 给冷条目一个**结构化的探索机会**——偶尔顶到前列让用户能看到。

**与排序的关系**：bandit 在这里不是替代相似度排序，而是**叠加一个轻度扰动**——大多数时候排序还是相似度主导，但偶尔（Thompson 抽样到尾部）会让冷条目浮上来。

**为什么不能 bandit 独占记忆排序**：因为相似度本身已经是非常强的信号；用 bandit 完全替代会让"语义相关性"让位给"过去被用过"，这是劣化。所以这里和路由场景一样，bandit 是**辅助信号**，主信号是 vitality + lifecycle multiplier（见 [memory-architecture §3](./memory-architecture.md#3-架构总览)）。

## 6. Cooldown 与失败保护

`BanditArmState.cooldown_until` 是 bandit 模块里的**断路器**：

```text
record_bandit_feedback(scene, arm_id, success=false, …)
    └─ 如果连续 N 次失败:
       cooldown_until = now + cooldown_duration
       (持久化到 SQLite)

下一次 select_arm:
    is_in_cooldown(state, now_rfc3339):
        Some(until) where until > now → 跳过这个 arm
```

为什么需要？因为算法本身的"学习速率"在很多次失败后才能把胜率压下去——但**我们等不起**。一个连续失败的 worker / profile 可能是配置坏了 / 服务挂了——立刻屏蔽几分钟比慢慢学要好。

**与算法本身的关系**：cooldown 不是 bandit 的标准组成部分；它是 Deeting 的工程补丁。学术 bandit 假设 arm 是**平稳分布**的；实际系统里 arm 会**故障**——cooldown 把"故障态"从"低胜率态"区分出来，避免学习曲线被异常拉偏。

## 7. 与 Python 参考实现对齐

[`bandit_selector.rs` 顶部注释](../deeting/src-tauri/src/modules/providers/bandit_selector.rs)：

```rust
//! Multi-armed bandit selection algorithms for the provider routing layer.
//!
//! Mirrors the reference implementation in
//! `deeting_core/app/services/decision/decision_service.py` so the desktop
//! runtime and the core service converge on identical mathematical behaviour.
```

桌面 Rust 实现**严格镜像** `deeting_core` 的 Python 实现。这意味着：

- 数学公式、超参默认值、随机种子行为必须**位级对齐**
- 一个测试样本在 Python 跑出来的结果，Rust 必须能复现
- 修改任一边都需要同步更新另一边

为什么这样？因为 bandit 状态在 `deeting_core` 也会用到（云端编排路径），两边对同一个 `BanditArmState` 行做决策——如果数学不一致，同一个 arm 在两端会被推荐成不同结果，用户体验崩。

## 8. 完整反馈回路

```text
┌──────────────────────────────────────────────────────────┐
│ ① 决策时刻                                                │
│   select_arm(candidates, arm_id_of, arm_map, strategy)   │
│   - 从 store 拉这个 scene 的所有 arm states               │
│   - 跳过 in_cooldown 的                                   │
│   - score_arm(...) 给每个打分                             │
│   - 返回得分最高的 arm                                    │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
   实际执行（路由 / 委托 / 召回）
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ ② 反馈时刻（任务结束 / 用户响应 / 错误）                  │
│   record_bandit_feedback(scene, arm_id, success, meta)   │
│   - successes += success ? 1 : 0                          │
│   - total_trials += 1                                     │
│   - alpha += success ? 1 : 0                              │
│   - beta  += success ? 0 : 1                              │
│   - 必要时设置 cooldown_until                             │
│   - 写入 SQLite（写审计 row）                              │
└──────────────────────────────────────────────────────────┘
```

整个回路**在用户视角是完全透明的**——他不会看到"bandit 推荐你做 X"，他只会看到模型逐渐对他的任务越来越合身。

## 9. 设计约束（PR review 时拒绝）

| 反模式 | 为什么不行 |
|---|---|
| 提高 `ROUTE_BANDIT_COEFF` 让 bandit 能独自翻盘 | 违反 [self-evolution charter](./self-evolution-architecture.md#65-不可越线pr-review-拒绝清单)，让 bandit 变成判官 |
| 在 worker_selection 之外的"安全敏感"场景给 bandit 决定权 | 不可恢复操作不能由概率算法决定 |
| 给 bandit 加历史奖励的复杂折扣 | 增加超参 + 让 reward 不对齐 → 双重学习；用 cooldown 而不是 reward shaping |
| 把 prior 写进 bandit state | prior 已经是 `task_policy_priors` 表的事；混入 bandit 会双重计入 |
| 让 bandit 在 cold start 阶段做关键决策 | 新 arm 没数据时 UCB 返回 1.0（强制探索），但 Thompson 会从均匀先验抽——结果近似随机；关键决策应等成熟（≥10 次以上） |
| 用 bandit 替代 RAG 召回排序 | bandit 只是叠加信号；相似度仍是主导，否则记忆质量会崩 |
| 跨 scene 共用 arm_id（如 `direct` 在多个场景用） | scene 是命名空间——务必加前缀区分 |
| 改了 Rust 实现但不同步 Python 实现 | 两端数学必须对齐 |

## 10. 文件地图

| 我想… | 看这里 |
|---|---|
| 改 Thompson / UCB / ε 默认超参 | [`bandit_selector.rs::BanditConfig::default`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs) |
| 改 ε-greedy / UCB 策略实现 | [`bandit_selector.rs::score_*`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs) |
| 改默认策略选择 | [`providers/store/mod.rs::BANDIT_DEFAULT_STRATEGY`](../deeting/src-tauri/src/modules/providers/store/mod.rs) |
| 加新 scene | 同上文件 + 业务侧调用 `select_arm` |
| 改 cooldown 触发逻辑 | [`providers/store/bandit.rs::record_bandit_feedback`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) |
| 改路由 fusion 公式 | [`task_learning/policy.rs::apply_route_prior`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs) |
| 改 worker 选择策略 | [`worker_dispatch.rs::select_custom_task_agent_candidate_with_bandit`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs) |
| 改 BanditArmState 持久化 | [`providers/types.rs::BanditArmState`](../deeting/src-tauri/src/modules/providers/types.rs) + [`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs) |
| 离线 replay / 验证 | [`bandit_selector_tests.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector_tests.rs) |

## 11. 怎么扩展

### 11.1 加新 scene（例：`prompt_variant_selection`）

> 场景：你有多个 prompt 变体，想让系统自己学哪个变体在某类任务上表现最好。

1. 在 [`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs) 加常量：
   ```rust
   pub const BANDIT_SCENE_PROMPT_VARIANT: &str = "prompt:variant";
   ```
2. 调用 `select_arm` 时传 `scene = BANDIT_SCENE_PROMPT_VARIANT`，arm_id 用 prompt variant id。
3. 在评估管线（如 [self-evolution §7](./self-evolution-architecture.md#7-评估管线evaluator)）的反馈点调用 `record_bandit_feedback(scene, arm_id, success)`。
4. **决定**：这个 scene 是"平局拆解"还是"独自决策"？如果是平局拆解，加一个 `_COEFF` 常量并在融合处乘上去；如果是独自决策，看是否需要安全锁。
5. 加测试断言新 scene 不污染老 scene 的 arm（命名空间隔离）。

### 11.2 加新策略（例：`SoftmaxBoltzmann`）

1. 在 [`BanditStrategy`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs) 加变体。
2. 加 `parse` 解析支持。
3. 实现 `score_softmax(state, cfg, rng)`。
4. 在 `score_arm` match 加分支。
5. 同步更新 Python 实现（`deeting_core/app/services/decision/decision_service.py`）。
6. 加确定性测试：固定 RNG seed，断言相同输入 → 相同输出。

### 11.3 给 bandit 加上下文（contextual bandit）

> 想法：让 arm 选择不仅看历史，还看当前任务的上下文（如 fingerprint 维度）。

不要在 bandit 模块里做。正确做法：
- **fingerprint 已经把上下文离散化了**——同 fingerprint 共享一组 arm states。
- 想让上下文更细 → 让 fingerprint 维度更多 / 更细（见 [self-evolution §4](./self-evolution-architecture.md#4-数据骨架taskfingerprint)），而不是让 bandit 算法本身处理 context。
- 这条边界很重要：bandit 算法本身保持简单（无 state），所有"上下文敏感"通过 fingerprint key 解决。算法和"语义建模"分开。

## 12. 已知决策与权衡

| 决策 | 为什么 |
|---|---|
| 三种策略全实现而不是只一种 | Thompson 是默认，但 UCB（在 cold-start 强制探索）和 ε-greedy（基线对照）都有独立价值 |
| `ROUTE_BANDIT_COEFF = 0.25` 锁死 | bandit 平局拆解器，不允许独自翻盘——硬不变式 |
| `ucb_min_trials = 5` | cold-start 时强制探索新 arm 至少 5 次 |
| Beta 先验默认 (1.0, 1.0) | 等价于均匀先验；任何更激进的先验都让冷启动偏向某一边 |
| Cooldown 是工程补丁，不是算法组成 | 算法假设 arm 平稳；现实 arm 会故障，cooldown 把"故障态"和"低胜率态"分开 |
| scene 命名空间隔离 | 不同决策点的 arm 不能互相污染 |
| Rust 镜像 Python 实现 | 两端对同一 `BanditArmState` 做决策；数学必须一致 |
| bandit 不持有 prior | prior 在 `task_policy_priors` 表里；混进 bandit state 会双重计入 |
| 默认 Thompson | 不需要额外超参；探索-利用平衡贝叶斯自然导出 |

## 13. 验证清单

改动 bandit 模块的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib bandit_selector --no-fail-fast`
- [ ] `cargo test --lib task_learning --no-fail-fast`
- [ ] `cargo test --lib worker_dispatch --no-fail-fast`
- [ ] 关键不变式测试仍然绿：
  - `apply_route_prior_bandit_scores_surface_on_application`（bandit 不能独自翻盘）
- [ ] 修改算法实现时同步 Python 端：`deeting_core/app/services/decision/decision_service.py`
- [ ] 加 scene 时：验证旧 scene 的 arm 不被污染
- [ ] 改默认超参时：跑一遍历史回放，看 reward 累积曲线是否符合预期
- [ ] 桌面端手测：
  - 反复触发同一类任务 → 路由倾向应缓慢收敛
  - 故意让一个 worker profile 连续失败 → cooldown 应生效
  - 冷启动新 fingerprint → 前几次决策应有明显探索性

## 14. FAQ

**Q：bandit 在 Deeting 里学到的东西，能不能跨用户共享？**
A：技术上 `BanditArmState` 表可以导出导入，但请把跨用户共享当**新 ingress**（见 [self-evolution §6.3](./self-evolution-architecture.md#63-ingress输入边界)）。直接合并表会让一个用户的偏好污染另一个，且没有审计点。

**Q：能不能让用户看到 bandit 在做什么？**
A：可以——`record_bandit_feedback` 写入的 row 都带 meta，UI 可以渲染"为什么这次推荐了 X"的解释。但**不要**让 UI 暗示用户去"调整 bandit"——它的目的是自学，不是被微观调控。

**Q：Thompson 抽样有随机性，会不会让用户感觉系统"不稳定"？**
A：在 hot arm（数据多）时 Beta 分布很尖，抽样接近平均胜率——感受不到随机。只在 cold arm（数据少）时分布宽 → 有明显探索 → 用户**会**感觉到随机，但这正是我们要的。

**Q：UCB 完全确定性（无随机），那它怎么会偶尔选低胜率 arm？**
A：靠"探索奖励项" `c × sqrt(ln(N)/n_i)`——一个新 arm `n_i = 1` 时第二项很大；一个老 arm `n_i = 1000` 时第二项很小。所以 UCB 通过"试用次数差异"驱动探索，而不是随机。

**Q：cooldown 会不会让一个早期故障的 arm 永远死掉？**
A：不会——cooldown 是时间窗，过期后自动重新参与。如果一个 arm 多次进入 cooldown，那是它真的有问题，应该上层处理（如禁用 worker profile / 重启 MCP 工具），不是 bandit 该解决的。

**Q：bandit 学习的胜率会不会因为时间漂移而过时？**
A：会。当前 Deeting 没有做显式的 reward decay——这是个**已知短板**。缓解办法：(1) cooldown 处理急性失败；(2) prior 表（task_learning）有 21 天半衰期，提供另一条信号。彻底解决需要给 bandit 加"sliding window successes"——是 next-step 工作。

**Q：能不能用 bandit 来选择 LLM 提供商？**
A：可以——这就是 `providers` 模块里 bandit 最初的用途。`bandit_selector.rs` 顶部注释就提到 "provider routing layer"。每个 provider 是一个 arm，reward 是请求成功 + 用户接受。但因为 provider 选择往往涉及成本 / 隐私偏好等非 reward 维度，实际生产里用 bandit 决定 provider 的范围会被外层策略限制。

**Q：相比"LLM 直接决定"，bandit 的优势在哪？**
A：(1) **可解释**：每个 arm 的 alpha/beta 都能在 PR 里看；(2) **不会幻觉**：bandit 输出是数学函数，没有捏造内容；(3) **学习曲线收敛**：reward 信号确定 → 收敛速度可证明；(4) **离线 replay**：固定 seed 后行为可复现。LLM 在这些维度都是反面教材——没法做关键路径决策。

## 15. 参考

- 算法实现：[`providers/bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs)
- 存储与反馈：[`providers/store/bandit.rs`](../deeting/src-tauri/src/modules/providers/store/bandit.rs)
- Scene 常量：[`providers/store/mod.rs`](../deeting/src-tauri/src/modules/providers/store/mod.rs)
- Arm 数据结构：[`providers/types.rs::BanditArmState`](../deeting/src-tauri/src/modules/providers/types.rs)
- 路由场景：[`task_learning/policy.rs::compute_route_bandit_scores`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/task_learning/policy.rs)
- Worker 场景：[`worker_dispatch.rs`](../deeting/src-tauri/src/modules/desktop_runtime/runtime/worker_dispatch.rs)
- 记忆召回：[`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs)
- Python 参考实现：`deeting_core/app/services/decision/decision_service.py`
- 测试：[`bandit_selector_tests.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector_tests.rs)
- 兄弟文档：[`rag-architecture.md`](./rag-architecture.md)、[`self-evolution-architecture.md`](./self-evolution-architecture.md)、[`agent-dag-architecture.md`](./agent-dag-architecture.md)、[`memory-architecture.md`](./memory-architecture.md)、[`security-architecture.md`](./security-architecture.md)

## 16. 经典参考资料（想深入学习的人）

- Sutton & Barto, *Reinforcement Learning: An Introduction*（第 2 章 Multi-Armed Bandits）—— 教科书级公式推导
- Thompson, W.R. (1933) *On the Likelihood that One Unknown Probability Exceeds Another* —— Thompson Sampling 原始论文
- Auer et al. (2002) *Finite-time Analysis of the Multiarmed Bandit Problem* —— UCB1 收敛证明
- Russo et al. *A Tutorial on Thompson Sampling* —— 现代视角综述

理解这些后再回看 [`bandit_selector.rs`](../deeting/src-tauri/src/modules/providers/bandit_selector.rs)，你会发现它的 100 多行 Rust 代码每一行都有明确的理论出处。这是为什么我们敢把它放在桌面 agent 的关键路径上——它不是 "AI 玄学"，它是有 60 年文献支撑的工程方法。
