# Deeting 记忆系统架构（Memory System）

> 适用范围：桌面端长期记忆、自动事实抽取、写入闸门、生命周期衰减、对话级回放。
> 不覆盖：上下文编排（见 [rag-architecture.md](./rag-architecture.md)）、自进化（见 [self-evolution-architecture.md](./self-evolution-architecture.md)）、安全策略（见 [security-architecture.md](./security-architecture.md)）。

本文档是 Deeting 桌面端"记忆系统"的权威说明书，目标和兄弟文档一致：让维护者、回顾者、新人都能从这一篇读懂：

- 系统的设计动机（为什么不是"vector DB + 直接写入"）
- 系统的拓扑（谁写、谁读、谁过滤、谁衰减）
- 系统的边界（什么允许、什么禁止）
- 在哪里加东西、在哪里改东西

## 1. TL;DR

Deeting 桌面端的"记忆"不是单一向量库。它是一个**多源、有生命周期、写入受控**的本地存储：

- 写入要过 **Write Guard**（三档决策：Add / Update / Noop），不允许重复或近重复条目无声入库。
- 同一个事实在多个时间点出现时，**Supersession** 模块识别"新值压老值"的语义（如"我现在用 GPT-5"压"我去年用 GPT-4"），把老记忆标记为 superseded 而不是冲突共存。
- 检索时按**记忆类别**应用不同的**衰减曲线**——身份/偏好记忆 120 天半衰期、Wiki 结论 90 天、当前事实 14 天、Session 短事件 7 天、通用 30 天。
- 每条记忆有 **vitality**（活力值，0-1），命中检索时 `+0.08` 并上限 1.0；越被用到越坚挺。
- **Fact Extractor** 在对话结束时跑 LLM + 启发式抽取"长期可用的用户事实"（最多 5 条），自动入库，全部经过 Write Guard。
- 所有"写入 / 更新 / 删除"操作进 **Snapshot Store** 留审计副本，可回滚。

核心代码：

```
deeting/src-tauri/src/modules/
├── memory/
│   ├── mod.rs
│   ├── types.rs              // LocalMemoryItem / WriteGuardResult / 查询结构
│   ├── service.rs            // MemoryService — append / search / list / 等等
│   ├── store.rs              // SQLite + 向量检索底层
│   ├── snapshot_store.rs     // 写入审计 / 回滚源
│   ├── fact_extractor.rs     // 对话 → 长期事实
│   ├── backfill.rs           // 历史 backfill / 迁移
│   ├── migration.rs          // schema 演进
│   ├── commands.rs           // Tauri commands
│   └── error.rs
└── retrieval_kernel/
    ├── mod.rs
    ├── lifecycle.rs          // 6 种衰减 profile + vitality 计算
    ├── write_guard.rs        // 三档决策 + 三种 profile（manual/auto-fact/wiki）
    ├── supersession.rs       // claim 解析 + 时间维度判断
    └── ranking.rs            // BM25 + RRF 共享算法
```

## 2. 为什么这么做

朴素"向量库 + 自动写入"的几个问题：

1. **垃圾积累**。LLM 容易把"对话里说过的话"全当成"有价值的事实"，几天就把库塞满近重复条目，检索质量崩塌。
2. **冲突共存**。"我用 GPT-4"和"我用 GPT-5"同时存在，检索都返回，模型困惑不知道哪条是当前真相。
3. **永久压制**。旧偏好不衰减 → 用户一年前说"喜欢 React 16"，到今天检索仍然顶在最前面。
4. **没有审计**。AI 自动改了用户的"用户画像"记忆，用户不知道、回滚不了。
5. **写入算法和读取算法混着写**。一个公式既算"是不是重复"又算"召回时该多重要"，下次有人想改其中一个就会同时打坏另一个。

Deeting 的做法是把这些分层解耦：

| 朴素做法的坑 | Deeting 的做法 |
|---|---|
| 写入零防御 | Write Guard 三档（Add / Update / Noop）+ 三 profile 阈值差异 |
| 冲突共存 | Supersession 标记老条目 `lifecycle.claim_state=superseded`，排名 ×0.35 |
| 旧偏好永久压制 | 6 种衰减 profile，每种独立半衰期 + 下限地板 |
| 自动写入无审计 | Snapshot Store 保留 old/new content 副本，可回滚 |
| 写入算法和读取算法混杂 | Write Guard 只决定"能否入库"；Lifecycle 只决定"召回时怎么打分"；二者不共享公式 |
| Vitality 全局衰减 | Vitality 只在被命中检索时 `+0.08`（最多 1.0），不主动衰减，让用得多的记忆"自然坚挺" |

## 3. 架构总览

```text
┌────────────────────────────────────────────────────────────────┐
│ 写入路径                                                       │
│                                                                │
│   外部入口:                                                    │
│     - 用户手动添加记忆（commands.rs）                          │
│     - Fact Extractor（对话结束自动抽取）                       │
│     - LLM Wiki promotion（wiki 模块产出的长期结论）             │
│   ↓                                                            │
│   MemoryService::append_guarded(profile, request)              │
│     ① 嵌入 query 向量                                          │
│     ② store.search_memories_for_write_guard(...)               │
│     ③ Supersession::find_supersession_target                   │
│        └→ 命中：mark old as superseded + Update 走分支          │
│     ④ Write Guard 决策（Add / Update / Noop）                  │
│     ⑤ store.insert / store.update（生成 snapshot 副本）        │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ 读取路径                                                       │
│                                                                │
│   MemoryService::search(query)                                 │
│     ① 嵌入 query → 向量                                        │
│     ② store.search_memories(over-fetch × 3)                    │
│     ③ 对每条命中:                                              │
│        rerank_score = raw_similarity                           │
│                     × memory_recency_multiplier(profile)        │
│                     × supersession_rank_multiplier              │
│        命中后 vitality += 0.08（上限 1.0）                      │
│     ④ Top-K 返回                                               │
└────────────────────────────────────────────────────────────────┘
```

## 4. 数据骨架

### 4.1 `LocalMemoryItem`

定义在 [`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs)：

```rust
pub struct LocalMemoryItem {
    pub id: String,
    pub content: String,
    pub session_id: Option<String>,        // 关联会话（None = 跨会话长期）
    pub capability_id: Option<String>,
    pub meta_info: Option<Value>,          // 元数据 — lifecycle / extraction / pinned …
    pub embedding_model: Option<String>,   // 嵌入用的模型名（迁移时关键）
    pub category: Option<String>,          // identity / preference / fact / llm_wiki / ...
    pub source: Option<String>,            // manual / auto_extraction / llm_wiki / ...
    pub tags: Option<Vec<String>>,
    pub vitality: Option<f32>,             // 0..=1，命中时 +0.08
    pub last_accessed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

### 4.2 类别 × 来源：决定衰减 profile

记忆的 `category` 和 `source` 字段不是装饰——它们直接决定**这条记忆在检索时按哪条衰减曲线打折**。[`lifecycle.rs::classify_memory_decay_profile`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) 的分类规则：

| Profile | 触发条件 | 半衰期 | 下限地板 |
|---|---|---|---|
| `Protected` | `meta.pinned == true` 或 `manual_override` | 不衰减（恒为 1.0） | — |
| `DurableWikiConclusion` | `category` / `source` 含 `llm_wiki` | 90 天 | 0.55 |
| `StablePreference` | `category` 含 `identity` / `persona` / `profile` / `preference` | 120 天 | 0.60 |
| `CurrentFact` | `category == "fact"` 或 `source` 含 `auto_extract*` / `fact` | **14 天** | 0.20 |
| `SessionEpisodic` | 有 `session_id`（且不属于上面几类） | **7 天** | 0.10 |
| `General` | 兜底 | 30 天 | 0.25 |

**为什么 7 个 profile 而不是一个统一公式？**

因为不同记忆**该被遗忘的速度本质不同**：
- "用户喜欢简洁回答"（preference）几个月不变 → 120 天半衰期
- "用户今天在排查 X bug"（current fact）明天就过期 → 14 天
- "用户在 session-1 里说过 'hi'"（session episodic）一周就该忘 → 7 天

混在一起算就是把"用户偏好"和"用户随口一句话"按同一速度衰减，**两边都会错**。

### 4.3 Vitality（活力值）

Vitality 是一个 0-1 的浮点：

- 命中检索时通过 [`touched_vitality`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) 加 `0.08`（`DEFAULT_VITALITY_TOUCH_INCREMENT`），上限 1.0。
- 检索时 vitality 与 `recency_multiplier` 相乘：高 vitality 的旧记忆比低 vitality 的旧记忆更难被衰减压下去。
- **不主动衰减**。Deeting 不跑后台 GC 把 vitality 慢慢扣下去——靠的是衰减曲线的**地板（floor）**，让久不被命中的记忆**有限度地变弱**但不会消失。

> 设计取舍：Vitality 测的是"这条记忆有多有用"，不是"这条记忆有多新"。新旧由时间戳和 profile 半衰期解决；有用与否靠用户实际命中 = 自动证据。

## 5. Write Guard（写入闸门）

[`retrieval_kernel/write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs) 是写入路径的核心防御。

### 5.1 三档决策

```rust
pub(crate) enum WriteGuardCoreAction {
    Add,         // 新知识 — 直接入库
    Update,      // 演化 — 更新/合并已有
    Noop,        // 高重复 — 静默丢弃
    Ambiguous,   // 含糊 — 由调用方决定（通常退回 Add 但带 warn）
}
```

向上层暴露的简化版（去掉 Ambiguous）在 [`memory/types.rs::WriteAction`](../deeting/src-tauri/src/modules/memory/types.rs)。

### 5.2 三种 Profile（不同写入入口，不同严苛度）

```rust
pub(crate) enum WriteGuardProfile {
    ManualMemory,        // 用户手动添加（保守、几乎不丢）
    AutoExtractedFact,   // Fact Extractor 自动抽取（严格、容易 Noop）
    WikiPromotion,       // Wiki 结论提升为长期记忆（中等）
}
```

每个 profile 有独立阈值，定义在 `policy_for_profile`：

| Profile | base_update | base_noop | min_gap | max_ratio | protected_noop |
|---|---|---|---|---|---|
| ManualMemory | 0.92 | 0.985 | 0.04 | 0.975 | 0.995 |
| AutoExtractedFact | 0.86 | 0.96 | 0.03 | 0.98 | 0.99 |
| WikiPromotion | 0.89 | 0.978 | 0.03 | 0.98 | — |

**直觉**：
- 用户手动添加（ManualMemory）时容忍度高（base_update=0.92）——除非新内容和老内容相似度 ≥ 0.985，否则不会被当成"重复"丢掉。
- 自动抽取（AutoExtractedFact）时容忍度低（base_update=0.86, base_noop=0.96）——LLM 容易抽出近似事实，闸门要主动压。
- `protected_noop_threshold` 是"对方记忆被 pin / 高重要度时，要更高相似度才允许覆盖"——保护既有的重要记忆。

### 5.3 动态阈值

[`write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs) 顶部三个常量：

```rust
const DYNAMIC_THRESHOLD_MAX_BOOST: f32 = 0.04;
const DYNAMIC_THRESHOLD_TOP2_FLOOR: f32 = 0.70;
const DYNAMIC_THRESHOLD_RATIO_BASELINE: f32 = 0.85;
const IMPORTANCE_PROTECT_THRESHOLD: f32 = 0.75;
```

含义：
- 当 top-1 和 top-2 都很相似（`score_ratio` 大）时，说明搜索结果"模糊"——临时**提高**阈值，宁可 Add 一条新的，也不要把含糊的命中当成 Update。
- 当 top-1 是重要记忆（`importance >= 0.75`）时，提升 noop 阈值，防止"以为是更新"实际是"被一条无关相似命中替换"。

### 5.4 三档计分输出（`WriteGuardDecisionDetail`）

```rust
pub(crate) struct WriteGuardDecisionDetail {
    pub action: WriteGuardCoreAction,
    pub reason: String,                          // 人类可读决策原因
    pub top1_score: Option<f32>,                 // 最相似命中得分
    pub top2_score: Option<f32>,                 // 次相似（用于 score_gap）
    pub score_gap: Option<f32>,                  // top1 - top2
    pub score_ratio: Option<f32>,                // top2 / top1（越高越模糊）
    pub effective_update_threshold: f32,         // 这次实际使用的阈值
    pub effective_noop_threshold: f32,
    pub protected_existing: bool,                // 是否触发了重要记忆保护分支
    pub selected_existing_id: Option<String>,    // Update 目标 id（如有）
}
```

这些字段直接进 `WriteGuardResult` 返给上层，**UI 可以显示**"这条记忆没入库因为 score=0.97 触发 Noop"——可解释、可调试。

## 6. Supersession（取代）

[`retrieval_kernel/supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) 解决"同一个事实，新值压老值"的问题。

### 6.1 什么时候介入

只有 `AutoExtractedFact` 和 `WikiPromotion` 走 Supersession——`ManualMemory` 永远不被自动取代（用户自己写的，不要 AI 替他改）。

### 6.2 工作机制

```text
new_claim = parse_claim(new_content)     // "subject + predicate + value + temporal_scope"
for candidate in nearby_candidates:
    if candidate is already superseded:                  → 跳过
    if candidate.exact_score < min_score (0.74 / 0.80):  → 跳过
    old_claim = parse_claim(candidate.content)
    if claim_key 不同:                                   → 跳过（不是同一主张）
    if value 等价:                                       → 跳过（不是冲突，是重复）
    if temporal_dominance(new, old) 不成立:              → 跳过
    return SupersessionDecision { target_memory_id, claim_key, reason }
```

`claim_key` 来自 `subject + predicate`——同一主张关于同一对象。
`TemporalScope` 三档：`Current` / `Historical` / `Unknown`，决定"新主张是否压过老主张"。

### 6.3 取代后果

老记忆**不删除**，而是被标记 `meta.lifecycle.claim_state = "superseded"`：

- 检索时 [`supersession_rank_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) 把它的分数 ×0.35（`SUPERSEDED_RANK_MULTIPLIER`），不会顶到前面，但仍可被回看（历史溯源）。
- 新记忆 metadata 里写 `superseded_memory_id` + `claim_key`，反向链接。

> 为什么不直接删？因为"撤销取代"需要老条目还在。`apply_task_policy_delta` 的同款哲学：可观测、可回滚 > 干净简洁。

## 7. Fact Extractor（事实抽取）

[`memory/fact_extractor.rs`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) 在对话结束（或显式触发）时跑：

```text
input: 对话历史（被截断到长度上限）

step 1: 用预定义 prompt 请 LLM 抽取"用户长期事实"
        提示词约束:
        - 只抽用户偏好 / 身份 / 长期需求
        - 不抽对一般话题的意见
        - 不抽暂态信息（当前任务细节、临时状态）
        - 最多 5 条

step 2: 解析输出
        - 是 JSON 数组? → 拿事实列表
        - 否?            → heuristic_fallback 启发式抽取
        - 启发式仍失败?  → 跳过这次抽取（不污染库）

step 3: 对每条事实:
        CreateLocalMemoryRequest {
            content: 事实文本,
            source: "auto_extraction",
            category: 推断（fact / preference / identity / ...）,
            meta_info: {
                auto_extraction: { ... },
                extraction_mode: "model" | "heuristic_fallback"
            }
        }
        走 MemoryService::append_guarded(AutoExtractedFact, request)
        统计 add / update / noop / failed
```

**纪律**：
- Fact Extractor 是**唯一**走 `AutoExtractedFact` profile 的入口。其他自动写入（如 Wiki promotion）必须用自己的 profile，不能复用。
- 抽取失败时**不入库**——宁可没有事实，也不要错误事实。
- 每条事实都走 Write Guard 和 Supersession——LLM 不能绕过闸门写入。
- 每条 meta_info 都标 `extraction_mode`，回头审计时可以分清是模型抽的还是 fallback 抽的。

## 8. Snapshot Store（审计 / 回滚源）

[`memory/snapshot_store.rs`](../deeting/src-tauri/src/modules/memory/snapshot_store.rs) 维护每次写入/更新/删除的**前后副本**：

```rust
pub struct MemorySnapshot {
    pub id: String,
    pub memory_id: String,
    pub action: String,            // create / update / delete / supersede
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub old_metadata: Option<String>,
    pub new_metadata: Option<String>,
    pub created_at: String,
}
```

用途：
- **审计**：用户点开一条记忆，可以看"这条记忆是什么时候、被什么 source（manual / auto_extraction / llm_wiki）写入的"。
- **回滚**：UI 可以触发"撤销最近一次自动抽取"——按 snapshot 的 old/new 恢复。
- **debug**：调闸门阈值时，可以离线回放历史快照看不同阈值下决策会怎么变（write_guard 是 idempotent 函数）。

## 9. Lifecycle 详细公式

[`lifecycle.rs::exponential_half_life_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs)：

```rust
fn exponential_half_life_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
    floor: f32,
    half_life_days: f32,
) -> f32 {
    let vitality = vitality.unwrap_or(1.0).clamp(0.0, 1.0);
    let days_since = parse_days_since(reference_timestamp, now);
    let decay = (-LN_2 * days_since / half_life_days.max(0.5)).exp();
    (floor + (1.0 - floor) * vitality * decay).clamp(floor, 1.0)
}
```

直观解读：

- `decay = 0.5^(days_since / half_life_days)`——每过一个半衰期，decay 减半。
- `(1 - floor) * vitality * decay`——年龄 + 活力共同决定衰减程度。
- `+ floor`——任何记忆衰减到最小也保留 `floor` 这个底分（保留可被检索到的最小存在感）。
- `.clamp(floor, 1.0)`——双向夹紧，不会因为浮点误差跌破下限或冲破 1.0。

**地板 (floor) 的含义**：哪怕一年没碰过的"用户偏好"，召回时仍然有 0.60 分；同样老的"session 闲聊"只有 0.10——前者会保留在检索中，后者基本失语。

**LLM Wiki 的特殊性**：除了上面的指数衰减，[`wiki_freshness_multiplier`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) 还提供一条 **power-law（幂律）freshness 曲线**——比指数衰减更"温柔"，因为知识结论比个人记忆更经得起时间。

## 10. Memory Service 公开 API

入口在 [`memory/service.rs::MemoryService`](../deeting/src-tauri/src/modules/memory/service.rs)。主要方法：

| 方法 | 用途 |
|---|---|
| `append(request)` | **直接写入，不过 Write Guard**（极少用，仅迁移 / 测试） |
| `append_guarded(profile, request)` | 推荐入口；走 Write Guard 三档决策 |
| `append_guarded_scoped(profile, request, scope)` | 同上，但限制搜索作用域（如限 session 内） |
| `search(query)` | 嵌入 query → 向量检索 → vitality 重排 |
| `search_with_query_vector(query, vec)` | 同上，但外部已嵌入 |
| `list(query)` | 分页列表（按 session / capability 过滤） |
| `delete(id)` | 删除单条（写 snapshot） |
| `update(id, request)` | 显式更新（写 snapshot） |
| `clear(payload)` | 按 scope 批量清除（写 snapshot） |
| `list_snapshots(memory_id)` | 拉一条记忆的历史快照 |

**调用方纪律**：

- **永远用 `append_guarded`**，不要直接调 `append`——除非你能解释为什么这次写入应该绕过闸门。
- `append_guarded` 返回 `WriteGuardResult`：调用方应该根据 `action` 决定怎么向 UI 反馈（Add 显示新条目、Update 显示合并、Noop 显示"已有类似记忆"）。
- 嵌入向量来自 [`EmbeddingService`](../deeting/src-tauri/src/modules/providers/embedding.rs)——一次会话内复用，不要每次写入都重新嵌入相同 query。

## 11. 前端集成

记忆模块的 Tauri commands 在 [`memory/commands.rs`](../deeting/src-tauri/src/modules/memory/commands.rs)，主要暴露：

- `local_memory_create`
- `local_memory_search`
- `local_memory_list`
- `local_memory_update`
- `local_memory_delete`
- `local_memory_clear`
- `local_memory_snapshots`

前端记忆页面在 [`app/[locale]/memory/`](../deeting/app/[locale]/memory/)，记忆卡片渲染 vitality 条、衰减状态、来源徽章，全部直接读取 `LocalMemoryItem` 字段。

**前端纪律**：
- 不要在前端再次"按相似度合并"——后端 Write Guard 已经做过；前端再合并 = 双重过滤。
- `vitality` 是展示用的辅助信息，不是排序键——后端 `search` 返回的顺序已经包含 vitality 重排，前端按返回顺序展示就行。

## 12. 文件地图

按"我想改什么"反向定位：

| 我想… | 看这里 |
|---|---|
| 改记忆字段（加 column） | [`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs) + [`memory/store.rs`](../deeting/src-tauri/src/modules/memory/store.rs) + [`memory/migration.rs`](../deeting/src-tauri/src/modules/memory/migration.rs) |
| 改衰减半衰期 / 地板 | [`retrieval_kernel/lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) 顶部 `MEMORY_PROFILE_*` 常量 |
| 加新衰减 profile | 同上文件 + `MemoryDecayProfile` enum + `classify_memory_decay_profile` + `memory_recency_multiplier` |
| 改 vitality 增量 | [`lifecycle.rs::DEFAULT_VITALITY_TOUCH_INCREMENT`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs) |
| 改 Write Guard 阈值 | [`write_guard.rs::policy_for_profile`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs) |
| 加 Write Guard profile | 同上文件 + `WriteGuardProfile` enum + 调用入口 |
| 改 Supersession 判定 | [`supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs) |
| 改 Fact Extractor 抽取规则 | [`memory/fact_extractor.rs::FACT_EXTRACTION_PROMPT_TEMPLATE`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) |
| 改 fact 的启发式 fallback | [`fact_extractor.rs::heuristic_extract_facts_from_conversation`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs) |
| 加新写入入口 | 新建一个调用 `append_guarded(profile, request)` 的入口；不要直接调 `append` |
| 改前端展示 | [`app/[locale]/memory/components/memory-card.tsx`](../deeting/app/[locale]/memory/components/memory-card.tsx) |

## 13. 怎么扩展

### 13.1 加一种新的衰减 profile（例：`ResearchNote`）

> 场景：你想把"研究笔记类记忆"按更慢的速率衰减，因为研究笔记往往长期有效但又不属于 wiki。

1. 在 [`lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs)：
   ```rust
   const MEMORY_PROFILE_RESEARCH_NOTE_HALF_LIFE_DAYS: f32 = 60.0;
   const MEMORY_PROFILE_RESEARCH_NOTE_FLOOR: f32 = 0.40;
   ```
2. 加 `MemoryDecayProfile::ResearchNote` 变体。
3. 在 `classify_memory_decay_profile` 加分支：检查 `category` 含 `research_note` 或 `meta.research_marker == true`。
4. 在 `memory_recency_multiplier` 加分支调用 `exponential_half_life_multiplier`。
5. 写测试：构造 same-old-timestamp 的 research note 和 session episodic，断言 research note 的 multiplier > episodic。

### 13.2 加新写入入口（例：从 IM 同步导入）

1. 新建一个调用方（如 `im/sync.rs`）。
2. 决定它走哪个 `WriteGuardProfile`：
   - 是用户在 IM 里发出的话 → `AutoExtractedFact`
   - 是机器人推荐的 Wiki 结论 → `WikiPromotion`
   - 是手动批量导入 → `ManualMemory`
3. 构造 `CreateLocalMemoryRequest`，调 `MemoryService::append_guarded(profile, request)`。
4. **不要**为这个新入口在 `WriteGuardProfile` 加变体——除非真的需要独立阈值。复用现有 profile 是默认选择。
5. 写一个集成测试：模拟一次 IM 导入，断言重复内容会被 Noop。

### 13.3 改 Fact Extractor 抽取 prompt

只改 [`fact_extractor.rs::FACT_EXTRACTION_PROMPT_TEMPLATE`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs)。注意：

- 必须强调"用户特定事实"，不要让 LLM 抽对话内容的总结。
- 必须强调"最多 N 条"——不限制时 LLM 会过度抽取。
- 输出必须是 JSON 数组（否则解析失败回退启发式）。
- 改完一定要回放历史会话样本，看抽取数量和质量是否漂移。

## 14. 反模式（PR review 时拒绝）

- 直接调 `MemoryService::append`（绕过 Write Guard）
- 自己写一个"似乎更准"的相似度判定来取代 Write Guard
- 在 `lifecycle.rs` 之外的地方实现衰减公式
- 把 vitality 用作排序权重以外的东西（如显示排序键 / 重要度分数）
- Fact Extractor 抽不出 JSON 就硬塞 raw text 到库里
- 删除记忆时不写 Snapshot
- 把 Supersession 的 `SUPERSEDED_RANK_MULTIPLIER` 改成 0.0（等于隐藏老记忆 → 历史溯源丢失）
- 给 `ManualMemory` 走 Supersession（自动 AI 不许覆盖用户手写）
- 给 vitality 加"主动衰减"后台任务（违反"地板已经表达了衰减"的设计）
- 把 `auto_extraction` 来源的记忆混到 `manual_memory` profile 里写（绕过严格阈值）

## 15. 已知决策与权衡

| 决策 | 为什么 |
|---|---|
| 写入和读取算法完全分离 | 一个改了不会打坏另一个；分别可测试、可独立改阈值 |
| 6 种衰减 profile 而不是一个统一公式 | 不同类记忆"该被忘掉的速度"不同；单一公式必定让某一类错配 |
| 21 天-ish 半衰期不存在 | 任务学习用 21 天（[self-evolution](./self-evolution-architecture.md)），记忆按 7-120 天分层 |
| Vitality 只加不减 | 主动衰减需要后台任务、需要存活窗口配置；地板已经表达了"久未使用 = 弱化"，不重复造轮子 |
| Supersession 标记不删除 | 历史溯源 + 可回滚 > 干净简洁 |
| Write Guard 用三 profile 而非动态参数 | 每个入口的语义是稳定的（手动 / 自动抽取 / wiki promotion）；动态参数会让阈值变得无法 PR review |
| Fact Extractor 失败直接跳过 | 错误事实污染库的代价 > 没事实的代价 |
| Snapshot 全量存 old + new | 单条记忆的 snapshot 数量上限远低于消息量；这点存储换可回滚是好交易 |

## 16. 验证清单

改动记忆系统的 PR 必须自检：

- [ ] `cargo check --manifest-path deeting/src-tauri/Cargo.toml`
- [ ] `cargo test --lib memory --no-fail-fast`
- [ ] `cargo test --lib retrieval_kernel --no-fail-fast`
- [ ] 关键不变式测试仍然绿：
  - `write_guard_decision_uses_shared_thresholds`
  - `memory_recency_prefers_stable_profiles_over_session_ephemera`
  - `memory_recency_protects_pinned_items_from_time_decay`
  - `wiki_freshness_is_gentler_than_memory_decay_for_old_entries`
  - `touched_vitality_increments_and_caps`
- [ ] 桌面端手测：
  - 手动添加同样内容两次 → 第二次应该 Noop 并在 UI 说明原因
  - Fact Extractor 跑两次连续对话 → 第二次重复事实应该 Update 或 Noop，不该 Add
  - 一条 superseded 记忆仍然在历史中可见，但不再顶到检索前列
  - Pin 一条记忆，等几天后回看，搜索时仍能命中（不被衰减压低）

> Windows 主机已知 caveat：`cargo test` 可能因 DLL 启动失败（STATUS_ENTRYPOINT_NOT_FOUND）失败——区分编译/运行失败，运行失败到 CI/Linux 复跑。

## 17. FAQ

**Q：为什么不用现成的 vector DB（Qdrant / Weaviate / pgvector）？**
A：Deeting 是 local-first，桌面端不允许引入外部进程依赖。SQLite + 自实现向量搜索是唯一可控的选择。性能上单用户 < 100 万条记忆完全够用；牺牲的是大规模扩展性，但那不是桌面端的诉求。

**Q：6 种衰减 profile 太多了，能不能合并？**
A：可以试。每合并一对都会让其中一类记忆错配——比如把 `CurrentFact` 和 `SessionEpisodic` 合并 → "今天的当前事实"和"今天的闲聊"按同样速度衰减，但前者明天还有用、后者明天就该忘。要砍 profile 数量请先看 §15 的权衡表。

**Q：Vitality 不主动衰减，那会不会"很多年前用过一次的记忆"永远抗衰减？**
A：不会。`recency_multiplier = floor + (1 - floor) * vitality * decay`——即使 vitality = 1.0，只要时间过了，`decay` 趋近 0，整个乘子也趋近 floor。Vitality 只在地板以上的范围内放大；它**不能让一条记忆超出 floor 上限的存在感**。

**Q：Write Guard 把我手动加的笔记 Noop 掉了怎么办？**
A：检查 UI 给出的 `decision_reason` 和 `score_ratio`——通常是因为新内容和某条老记忆相似度 ≥ 0.985。两条路：(1) 改内容（加上区别化的关键字、上下文），(2) 显式调 `update` 把老条目覆盖。

**Q：能不能让 Fact Extractor 在 streaming 期间增量抽取（而不是只在对话结束）？**
A：技术上能，但代价不值：(1) streaming 期间的对话往往未完成，事实抽取容易抽到中间态；(2) 多次抽取 = 多次 LLM 调用 = 翻倍 token 成本。当前设计选择"对话边界触发"是性价比最高的。

**Q：Supersession 解析 claim 用的是 LLM 还是规则？**
A：规则。`parse_claim` 是基于关键词和结构的解析器，不调 LLM。LLM 用在 Fact Extractor 阶段；Supersession 阶段必须确定性、可回放——所以规则。

**Q：能不能加跨用户共享的记忆（如组织级 Wiki）？**
A：可以——但请把它当**新的写入入口**，进 `WikiPromotion` profile（或新建一个 `OrgSharedKnowledge` profile）；同时 [self-evolution](./self-evolution-architecture.md) 文档里的 `ExternalIngress` 概念也适用——跨域数据走 boundary 文件翻译为 `LocalMemoryItem`，不要把外部 schema 泄漏进核心 types。

## 18. 参考

- 数据结构：[`memory/types.rs`](../deeting/src-tauri/src/modules/memory/types.rs)
- 写入闸门：[`retrieval_kernel/write_guard.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/write_guard.rs)
- 取代逻辑：[`retrieval_kernel/supersession.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/supersession.rs)
- 衰减曲线：[`retrieval_kernel/lifecycle.rs`](../deeting/src-tauri/src/modules/retrieval_kernel/lifecycle.rs)
- 公开服务：[`memory/service.rs`](../deeting/src-tauri/src/modules/memory/service.rs)
- 事实抽取：[`memory/fact_extractor.rs`](../deeting/src-tauri/src/modules/memory/fact_extractor.rs)
- Snapshot：[`memory/snapshot_store.rs`](../deeting/src-tauri/src/modules/memory/snapshot_store.rs)
- 兄弟文档：[`rag-architecture.md`](./rag-architecture.md)、[`self-evolution-architecture.md`](./self-evolution-architecture.md)、[`agent-dag-architecture.md`](./agent-dag-architecture.md)、[`security-architecture.md`](./security-architecture.md)
