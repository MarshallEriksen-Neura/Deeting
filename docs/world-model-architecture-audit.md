# 世界模型架构深度分析 (红蓝对抗验证版)

> 生成日期: 2026-05-29
> 范围: WorldModelFrame / WorldModelUpdate / 快照渲染 / Hook 集成 / 进化耦合
> 涉及文件: 61 个 (Rust 核心 ~40, 前端 ~5, 文档 ~3, 测试 ~13)
> 验证方法: Red Team (8 项挑战) + Blue Team (10 项验证)

---

## 目录

1. [架构概述](#1-架构概述)
2. [核心类型](#2-核心类型)
3. [数据流](#3-数据流)
4. [红蓝对抗结果](#4-红蓝对抗结果)
5. [风险评级](#5-风险评级)
6. [改进建议](#6-改进建议)

---

## 1. 架构概述

世界模型是 Deeting 运行时的核心状态容器，跟踪 AI 在一次对话任务中的"世界认知"—— 已知事实、假设、未知、验证目标、执行策略等。

```
┌─────────────────────────────────────────────────────────────────────┐
│                     世界模型架构                                     │
│                                                                      │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │ desktop-runtime-core │     │ chat_tool_runtime    │              │
│  │ (类型层)              │     │ (更新层)              │              │
│  │                      │     │                      │              │
│  │ WorldModelFrame      │◄────│ WorldModelUpdate     │              │
│  │ WorldModelFrameStatus│     │ parse/extract/apply  │              │
│  │ FrameProvenance      │     │ PromptMode           │              │
│  │ Observation/Action/  │     │ frame_tools/         │              │
│  │ Directive            │     │                      │              │
│  └──────────┬───────────┘     └──────────┬───────────┘              │
│             │                            │                           │
│             ▼                            ▼                           │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │ snapshot_render      │     │ runtime_event_       │              │
│  │ (快照渲染)            │     │ projection           │              │
│  │                      │     │ (事件投影)            │              │
│  │ 两层压缩:            │     │ WorldModelFrameKind  │              │
│  │  - 结构压缩 (无损)   │     │ ProjectionInput      │              │
│  │  - 窗口压缩 (有损)   │     │                      │              │
│  └──────────────────────┘     └──────────────────────┘              │
│                                                                      │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │ hook/mod.rs          │     │ evolution/           │              │
│  │ (Hook 系统)           │     │ (自进化)              │              │
│  │                      │     │                      │              │
│  │ FrameFreshnessHook   │     │ TaskFingerprint      │              │
│  │ WorldModelUpdateHook │     │ Prior / PolicyDelta  │              │
│  │ HookDecision (9种)   │     │ Signal submission    │              │
│  └──────────────────────┘     └──────────────────────┘              │
│                                                                      │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │ plan/mod.rs          │     │ runtime/mod.rs       │              │
│  │ (Plan 系统)           │     │ (编排主循环)          │              │
│  │                      │     │                      │              │
│  │ PlanArtifact         │     │ bootstrap → validate │              │
│  │ Phase                │     │ → phase loop (≤8)    │              │
│  │ from_frame() bridge  │     │ → finalize           │              │
│  └──────────────────────┘     └──────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心类型

### 2.1 WorldModelFrame (22 字段)

```rust
// desktop-runtime-core/src/frame/mod.rs:141-173
pub struct WorldModelFrame {
    // 身份
    pub frame_version_id: FrameVersionId,
    pub session_id: SessionId,
    pub task_id: TaskId,
    pub parent_frame_id: Option<FrameVersionId>,
    pub fingerprint_key: Option<String>,

    // 世界认知
    pub goal: String,
    pub known_facts: Vec<Fact>,           // {id, statement, source}
    pub memory_priors: Vec<Prior>,        // {id, statement, confidence}
    pub assumptions: Vec<Assumption>,     // {id, statement, source}
    pub unknowns: Vec<Unknown>,           // {id, question}
    pub verification_targets: Vec<VerificationTarget>, // {id, description}
    pub adaptation_rules: Vec<Rule>,      // {id, rule_text}

    // 执行状态
    pub execution_strategy: ExecutionStrategy,
    pub status: WorldModelFrameStatus,    // 6 枚举值
    pub provenance: FrameProvenance,

    // 事件序列 (三类)
    pub world_observed: Vec<Observation>,    // 工具执行结果
    pub agent_committed: Vec<CommittedAction>, // AI 提交的动作
    pub user_directed: Vec<UserDirective>,   // 用户指令

    // 序列追踪
    pub next_sequence: SequenceNumber,
    pub last_seen_by_model: SequenceNumber,
    pub model_turn_count: ModelTurnCount,
    pub last_world_model_update_turn: Option<ModelTurnCount>,

    // 跨阶段
    pub proposed_next_phase: Option<serde_json::Value>,
}
```

### 2.2 WorldModelFrameStatus (6 枚举值)

```rust
pub enum WorldModelFrameStatus {
    Missing,              // 尚未初始化
    Fresh,                // 最新可用
    Stale,                // 需要刷新
    Contradicted,         // 被外部证据矛盾
    InsufficientForCommit,// 信息不足无法提交
    VerifiedEnough,       // 验证充分
}
```

### 2.3 WorldModelUpdate (9 字段)

```rust
// world_model_update.rs:12-31
pub(crate) struct WorldModelUpdate {
    pub intent: Option<String>,
    pub execution_strategy: Option<ExecutionStrategy>,
    pub facts: Vec<String>,               // 扁平字符串 (非结构化)
    pub assumptions: Vec<String>,
    pub resolved_unknowns: Vec<String>,
    pub new_unknowns: Vec<String>,
    pub verification_targets: Vec<String>,
    pub rules: Vec<String>,
    pub proposed_next_phase: Option<ProposedPhase>,
}
```

### 2.4 类型关系图

```
WorldModelUpdate (9 扁平字段)
    │
    │ apply_world_model_update_to_frame()
    │ (字段逐个合并, ID = format!("wm-fact-{len}"))
    ▼
WorldModelFrame (22 结构化字段)
    │
    ├──► SnapshotRender (两层压缩) → LLM Prompt
    ├──► RuntimeEventProjection → 前端 UI
    ├──► HookSystem (FreshnessHook, UpdateHook) → 决策
    └──► EvolutionService (Fingerprint, Prior) → 自进化
```

---

## 3. 数据流

### 3.1 完整生命周期

```
用户输入
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ runtime/mod.rs: bootstrap()                                    │
│  bootstrap.bootstrap_frame(&input) → FrameBootstrapOutput     │
│  ├─ 从 SQLite 恢复或创建新 Frame                              │
│  ├─ consult() 从进化存储读取 Prior                            │
│  └─ 生成 fingerprint_key                                      │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase Loop (最多 8 轮)                                         │
│                                                                │
│  1. Hook 评估 @ ProposeNextPhase                              │
│     ├─ FrameFreshnessHook: needs_refresh() / needs_revision() │
│     └─ WorldModelUpdateHook: R1/R2/R3 触发条件                │
│                                                                │
│  2. 如果 Hook 要求刷新:                                        │
│     ├─ resolve_world_model_update() → LLM 请求                │
│     ├─ extract_world_model_update_from_response()              │
│     │   ├─ 路径 A: 结构化 tool_calls 参数                     │
│     │   └─ 路径 B: 内联 <!--wm_update-->...<!--/wm_update--> │
│     └─ apply_world_model_update_to_frame()                     │
│                                                                │
│  3. Phase 执行:                                               │
│     ├─ DirectChat / ToolCall / DelegatedWorker / ...          │
│     ├─ append_observation() → world_observed                  │
│     ├─ append_committed_action() → agent_committed            │
│     └─ WorldModelFrameStatus 更新                             │
│                                                                │
│  4. 快照渲染 → 注入 LLM Prompt                                │
│     ├─ Delta 模式: 仅渲染 last_seen_by_model 之后的条目       │
│     └─ Full 模式: 渲染全部 (4000 字符硬限制)                  │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 后处理                                                         │
│  ├─ Evolution: submit_evolution_signal() → 更新 Prior          │
│  ├─ TaskLearning: evaluate() → PolicyDelta                    │
│  └─ ExecutionGraph: 持久化 DAG                                │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 Hook 触发条件 (WorldModelUpdateHook)

| 条件 | 模式 | 说明 |
|------|------|------|
| R1: 新的 user_directed | RequiredDelta | 用户有新指令 |
| R2: 累积变化达到阈值 | RequiredDelta | 策略感知: DirectIteration 需 5 obs/2 commits, DelegatedWorkflow 需 2 obs/1 commit |
| R3: 10 轮未更新 | AllowedDelta | 安全网 |
| needs_refresh() | RequiredFull | 状态为 Stale |
| needs_revision() | RequiredFull | 状态为 Contradicted |

---

## 4. 红蓝对抗结果

### 4.1 Red Team 挑战 (8 项)

| # | 挑战 | 判定 | 风险 | 关键证据 |
|---|------|------|------|----------|
| 1 | 类型一致性 (Update 扁平 vs Frame 结构化) | ✅ 确认 | 🟡 MEDIUM | ID 用 `vec.len()` 生成，移除后可能碰撞 |
| 2 | 投影层复杂度 | ⚠️ 部分确认 | 🟢 LOW | `Revision` 变体从未构造 (死代码) |
| 3 | 双重 "世界模型" 命名 | ✅ 确认 | 🟡 MEDIUM | 前端 `use-auth-world-model` 是认证，与 Rust WorldModelFrame 零重叠 |
| 4 | 更新机制脆弱性 | ✅ 确认 | 🟡 MEDIUM | `<!--wm_update-->` JSON 解析失败静默丢弃；`is_assumption_sentence` 硬编码中英文 |
| 5 | 状态生命周期 | ✅ 确认 | 🟢 LOW | `mark_seen()` 每次 O(n) 扫描全部条目 |
| 6 | **进化反馈循环** | ✅ 确认 | 🔴 **HIGH** | 负信号永久毒化 fingerprint prior，无恢复机制 |
| 7 | 测试覆盖缺口 | ✅ 确认 | 🟡 MEDIUM | 无 `apply_world_model_update_to_frame` 的直接测试 |
| 8 | PromptMode 设计 | ✅ 确认 | 🟢 LOW | `RequiredFull` 只追加不替换，浪费 token |

### 4.2 Blue Team 验证 (10 项)

| # | 发现 | 状态 | 质量 |
|---|------|------|------|
| 1 | 类型系统: 22 字段, 正确的枚举设计 | ✅ 验证 | 🟢 EXCELLENT |
| 2 | 数据流: 线性 bootstrap→validate→execute→observe | ✅ 验证 | 🟢 EXCELLENT |
| 3 | 快照渲染: 两层压缩, delta/full 模式 | ✅ 验证 | 🟢 EXCELLENT |
| 4 | Hook 系统: 排名决策, 兴趣过滤, 策略感知阈值 | ✅ 验证 | 🟢 EXCELLENT |
| 5 | Plan 分离: PlanArtifact 跟踪阶段, Frame 跟踪状态 | ✅ 验证 | 🟢 GOOD |
| 6 | 错误处理: Option/Result 返回, 生产代码无 panic | ✅ 验证 | 🟢 GOOD |
| 7 | 并发安全: Clone+自动 Send/Sync, 无内部可变性 | ✅ 验证 | 🟢 EXCELLENT |
| 8 | 代码指标: 39 个测试, 最大函数 ~108 行 | ✅ 验证 | 🟢 GOOD |
| 9 | 重复模式: tool_meta 提取逻辑重复 | 补充 | 🟡 ACCEPTABLE |
| 10 | 文档交叉: 干净的作用域分离 | ✅ 验证 | 🟢 GOOD |

### 4.3 Blue Team 关注点

| # | 关注点 | 风险 | 说明 |
|---|--------|------|------|
| C1 | `apply_world_model_update_to_frame` 无直接测试 | 🔴 **HIGH** | 关键合并路径未测试 — 畸形 LLM 输出在此处与 Frame 状态交互 |
| C2 | ID 生成用 `Vec::len()` | 🟡 MEDIUM | 移除条目后新增可能 ID 碰撞 |
| C3 | 畸形 LLM 输出静默丢弃 | 🟢 LOW | 设计意图是鲁棒性，但建议加 `log::debug!` |

### 4.4 对抗总结

```
Red Team:  7 确认 + 1 部分确认 → 发现 1 个 HIGH (进化反馈循环)
Blue Team: 8 验证 (EXCELLENT/GOOD) + 3 关注 → 整体 APPROVE

交叉验证:
  - Red #1 (类型一致性) + Blue C2 (ID 生成) → 同一问题的不同角度
  - Red #7 (测试覆盖) + Blue C1 (合并函数无测试) → 高度一致
  - Red #6 (进化循环) → Blue 未覆盖 (超出验证范围)
```

---

## 5. 风险评级

### 🔴 HIGH — 进化反馈循环

**位置**: `execution_plane/composition/hooks/self_evolution.rs`

**机制**:
```
Phase 执行失败
    │
    ▼
submit_evolution_signal(Rejected)
    │
    ▼
Fingerprint prior 衰减 (half-life decay)
    │
    ▼
frame_bootstrap consult() → 读取弱化的 prior
    │
    ▼
跳过验证 (prior 信心不足)
    │
    ▼
更大概率执行失败 → 循环
```

**问题**: 没有 prior 的最低衰减下限。一旦 fingerprint 累积足够多负信号，prior 可以衰减到接近零，导致后续任务永远跳过验证。

**红队评估**: "a streak of failures cannot permanently poison a fingerprint"

### 🟡 MEDIUM — 合并函数未测试

**位置**: `world_model_update.rs:212-320` (`apply_world_model_update_to_frame`)

这是 LLM 输出与 Frame 状态交互的**唯一入口**。108 行的合并逻辑 (逐字段合并 + 去重 + ID 生成) 没有直接测试。

**缺失测试**:
- 重复 fact 的去重行为
- `resolved_unknowns` 移除后 `new_unknowns` 的 ID 碰撞
- 空 update 的行为
- `proposed_next_phase` 的合并

### 🟡 MEDIUM — 双重 "世界模型" 命名

| 位置 | 概念 | 实际职责 |
|------|------|----------|
| `hooks/use-auth-world-model.ts` | 认证流程 | 构建登录 URL, 检测桌面/Web 运行时 |
| `WorldModelFrame` (Rust) | 运行时状态 | 22 字段的任务世界认知 |

共享 "world model" 命名但零概念重叠。每个新开发者都会困惑。

### 🟡 MEDIUM — ID 生成碰撞风险

**位置**: `world_model_update.rs:230, 261, 280, 294, 308` + `frame/mod.rs:250`

```rust
// 当前: 用 vec.len() 作为索引
format!("wm-fact-{}", frame.known_facts.len())
```

如果 `known_facts` 被移除后重新添加，新 ID 可能与历史 ID 碰撞。当前安全是因为事实是 append-only，但这是一个隐式契约。

### 🟡 MEDIUM — `<!--wm_update-->` 解析静默失败

**位置**: `world_model_update.rs:103-124`

```rust
serde_json::from_str::<Value>(payload).ok()?  // 静默丢弃
```

LLM 输出畸形 JSON 时，整个世界模型更新被静默丢弃。无日志，无错误传播。

### 🟢 LOW — 其他

| 问题 | 位置 | 说明 |
|------|------|------|
| `Revision` 变体从未构造 | `projection.rs:83` | 死代码 |
| `RequiredFull` 只追加不替换 | `mod.rs:353-357` | 浪费 token |
| `Off` 模式仍注入系统消息 | `mod.rs:348-349` | 每轮浪费 ~50 token |
| `mark_seen()` O(n) | `frame/mod.rs:216-219` | 理论性能问题 |
| `is_assumption_sentence` 硬编码 | `world_model_update.rs:422-428` | 中英文关键词匹配 |
| `split_sentences` 对缩写敏感 | `world_model_update.rs:393-399` | "Dr. Smith" 会被拆分 |

---

## 6. 改进建议

### 🔴 P0 — 进化反馈循环修复

```rust
// 在 Prior 衰减逻辑中加入最低下限
const PRIOR_FLOOR: f64 = 0.1; // 不低于 10% 信心
let decayed = current * decay_factor;
let clamped = decayed.max(PRIOR_FLOOR);
```

同时加入**冷却期**: fingerprint 连续 3 次 Rejected 后，暂停信号提交 24 小时。

### 🟡 P1 — 补充合并函数测试

```rust
#[test]
fn apply_update_deduplicates_existing_facts() { ... }

#[test]
fn apply_update_resolved_unknowns_removes_and_appends() { ... }

#[test]
fn apply_update_empty_update_is_noop() { ... }

#[test]
fn apply_update_id_collision_after_retain() { ... }
```

### 🟡 P1 — 重命名前端 "世界模型"

```typescript
// hooks/use-auth-world-model.ts → hooks/use-auth-flow.ts
// lib/auth/world-model.ts → lib/auth/login-strategy.ts
```

### 🟡 P1 — ID 生成用单调递增计数器

```rust
// 替换 format!("wm-fact-{}", vec.len())
// 方案 A: UUID
format!("wm-fact-{}", uuid::Uuid::new_v4())
// 方案 B: 原子计数器
format!("wm-fact-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
```

### 🟡 P1 — 畸形 JSON 加日志

```rust
// world_model_update.rs:111
match serde_json::from_str::<Value>(payload) {
    Ok(val) => Some(val),
    Err(e) => {
        log::debug!("wm_update parse failed: {e}");
        None
    }
}
```

### 🟢 P2 — PromptMode 优化

- `RequiredFull`: 先清除 Frame 中 wm-sourced 条目，再应用更新
- `Off`: 移除系统消息注入 ("不要输出 wm_update" 指令)

### 🟢 P2 — 清理死代码

- 移除或使用 `WorldModelFrameKind::Revision` 变体
- 审查 `is_assumption_sentence` 是否仍需要 (LLM 已有显式 `assumptions` 字段)

---

## 附录: 架构亮点

1. **类型设计优秀**: WorldModelFrame 的 22 个字段覆盖了任务世界认知的完整维度 (事实/假设/未知/验证/规则/事件/序列)。WorldModelFrameStatus 的 6 枚举值语义清晰，`needs_refresh()` / `needs_revision()` 分区正确。

2. **Hook 系统成熟**: 排名决策 (HookDecisionRank 0-8)、兴趣过滤 (interests() 预筛选)、策略感知阈值 (R2 根据 ExecutionStrategy 调整触发条件) — 这是生产级的 Hook 设计。

3. **快照渲染优雅**: 两层压缩 (结构压缩无损 + 窗口压缩有损) 使得 LLM Prompt 中的世界模型表示既完整又紧凑。Delta 模式仅渲染新条目，节省 token。

4. **并发安全**: 零内部可变性，零锁，纯 Rust 所有权语义。Frame 在整个 tick 生命周期内由单个 `&mut self` 独占。

5. **数据流线性**: bootstrap → validate → phase loop → finalize，无循环依赖，无跨模块状态跳跃。每个变更都是顺序的、局部的。

6. **Plan/Frame 分离**: PlanArtifact 跟踪执行计划 (阶段/承诺)，WorldModelFrame 跟踪世界状态 (事实/假设)。两者通过 `frame_version_id` 桥接，职责清晰。
