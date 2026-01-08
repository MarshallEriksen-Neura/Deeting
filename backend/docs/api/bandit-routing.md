# Bandit 路由文档

> Gateway 智能路由选择机制详解

---

## 概述

Gateway 使用 **多臂老虎机 (Multi-Armed Bandit)** 算法实现智能路由选择：
- 自动学习最优上游服务
- 平衡探索与利用
- 支持多种策略算法
- 自动降级与熔断

---

## 路由策略

### 支持的策略

| 策略 | 配置值 | 说明 |
|------|--------|------|
| 权重随机 | `weight` | 按权重和优先级随机选择（默认） |
| ε-贪婪 | `epsilon_greedy` / `bandit` | 平衡探索与利用 |
| UCB1 | `ucb1` | 置信上界算法 |
| Thompson Sampling | `thompson` | 贝叶斯概率采样 |

### 配置方式

在 `ProviderPresetItem.routing_config` 中配置：

```json
{
  "strategy": "epsilon_greedy",
  "epsilon": 0.1,
  "latency_target_ms": 3000,
  "gray_ratio": 1.0
}
```

---

## 策略详解

### 1. 权重随机 (weight)

最简单的路由策略，适用于：
- 负载均衡
- 固定比例分流
- 无需学习的场景

**算法**:
1. 按 `priority` 分组，取最高优先级组
2. 在组内按 `weight` 加权随机选择

```
候选列表:
  A: priority=10, weight=3
  B: priority=10, weight=7
  C: priority=5,  weight=5

选择概率:
  A: 30% (仅在 priority=10 组内)
  B: 70% (仅在 priority=10 组内)
  C: 0%  (priority 较低，不参与)
```

### 2. ε-贪婪 (epsilon_greedy)

平衡探索与利用的经典算法：
- 以 ε 概率随机探索
- 以 1-ε 概率选择当前最优

**参数**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `epsilon` | 0.1 | 探索概率 (0-1) |
| `latency_target_ms` | 3000 | 延迟目标（毫秒） |

**评分公式**:
```
score = success_rate - latency_penalty + weight_bonus

其中:
- success_rate = successes / total_trials
- latency_penalty = min(latency_p95 / target, 1.5) * 0.2
- weight_bonus = weight * 0.0001
```

**适用场景**:
- 上游服务质量波动
- 需要持续探索新配置
- 中等规模候选集

### 3. UCB1 (Upper Confidence Bound)

基于置信区间的探索算法：
- 优先尝试不确定性高的选项
- 随着试验增加逐渐收敛

**评分公式**:
```
score = p_hat + sqrt(2 * ln(N) / n)

其中:
- p_hat = 该臂成功率
- N = 所有臂总试验次数
- n = 该臂试验次数
```

**特点**:
- 未尝试的臂得分为 ∞（优先尝试）
- 试验次数少的臂有更高的探索奖励
- 适合需要充分探索的场景

### 4. Thompson Sampling

贝叶斯概率采样算法：
- 为每个臂维护 Beta 分布
- 每次采样选择最高值

**采样方式**:
```python
for each arm:
    sample = Beta(alpha + successes, beta + failures)
select arm with max(sample)
```

**参数**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `alpha` | 1.0 | Beta 分布先验 α |
| `beta` | 1.0 | Beta 分布先验 β |

**特点**:
- 自然平衡探索与利用
- 对不确定性建模更准确
- 适合转化率优化场景

---

## 臂状态管理

### 状态模型

每个路由候选（臂）维护以下状态：

```python
@dataclass
class BanditArmState:
    preset_item_id: str      # 臂标识
    total_trials: int        # 总试验次数
    successes: int           # 成功次数
    failures: int            # 失败次数
    alpha: float             # Beta 分布 α
    beta: float              # Beta 分布 β
    latency_sum_ms: float    # 延迟总和
    latency_p95_ms: float    # P95 延迟
    last_success_at: datetime  # 最后成功时间
    last_failure_at: datetime  # 最后失败时间
    cooldown_until: datetime   # 冷却截止时间
```

### 状态更新

每次请求完成后更新臂状态：

```python
# 成功
state.total_trials += 1
state.successes += 1
state.latency_sum_ms += latency_ms
state.last_success_at = now()

# 失败
state.total_trials += 1
state.failures += 1
state.last_failure_at = now()

# 连续失败触发冷却
if consecutive_failures >= threshold:
    state.cooldown_until = now() + cooldown_duration
```

---

## 降级与熔断

### 冷却机制

当某臂连续失败超过阈值时，进入冷却期：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| 失败阈值 | 5 | 连续失败次数 |
| 冷却时长 | 30s | 冷却期时长 |

**冷却期行为**:
- 冷却中的臂不参与路由选择
- 冷却结束后自动恢复
- 恢复后首次成功清除失败计数

### 备份路由

选择主路由时同时生成备份列表：

```python
primary, backups = selector.choose(candidates)
# backups: 按 priority + weight 降序排列的备份候选
```

**降级流程**:
```
主路由调用
    │
    ├─ 成功 → 返回响应
    │
    └─ 失败 → 检查备份列表
               │
               ├─ 有备份 → 尝试备份路由
               │
               └─ 无备份 → 返回错误
```

### 与熔断器协同

Bandit 路由与上游熔断器协同工作：

```
┌─────────────────────────────────────────────────────────────┐
│                     路由选择                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ 候选 A  │  │ 候选 B  │  │ 候选 C  │  │ 候选 D  │        │
│  │ 活跃    │  │ 冷却中  │  │ 活跃    │  │ 熔断中  │        │
│  └────┬────┘  └─────────┘  └────┬────┘  └─────────┘        │
│       │                         │                           │
│       └──────────┬──────────────┘                           │
│                  │                                          │
│                  ▼                                          │
│           Bandit 选择                                        │
│           (仅从活跃候选中)                                   │
└─────────────────────────────────────────────────────────────┘
                   │
                   ▼
            上游调用 + 熔断检查
```

---

## 灰度路由

### 配置方式

通过 `gray_ratio` 控制灰度比例：

```json
{
  "strategy": "bandit",
  "gray_ratio": 0.1  // 10% 流量
}
```

### 灰度规则

- `gray_ratio = 0`: 完全关闭该路由
- `gray_ratio = 1`: 完全开启
- `0 < gray_ratio < 1`: 按比例随机放行

```python
if gray_ratio <= 0:
    # 跳过此候选
elif gray_ratio >= 1 or random() < gray_ratio:
    # 保留此候选
```

---

## 观测报表

### 获取报表

**端点**: `GET /internal/v1/bandit/report`

**参数**:
| 参数 | 说明 |
|------|------|
| `capability` | 按能力过滤（chat/embedding） |
| `model` | 按模型过滤 |
| `channel` | 按通道过滤（internal/external） |

**响应**:
```json
{
  "summary": {
    "total_arms": 5,
    "total_trials": 10000,
    "overall_success_rate": 0.95
  },
  "items": [
    {
      "arm_id": "preset-item-uuid",
      "provider": "openai",
      "capability": "chat",
      "model": "gpt-4",
      "channel": "external",
      "total_trials": 5000,
      "successes": 4800,
      "failures": 200,
      "success_rate": 0.96,
      "latency_p95_ms": 1200,
      "last_selected_at": "2026-01-06T10:30:00Z",
      "cooldown_until": null,
      "status": "active"
    }
  ]
}
```

### 指标说明

| 指标 | 说明 |
|------|------|
| `total_trials` | 总选择次数 |
| `successes` | 成功次数（2xx 响应） |
| `failures` | 失败次数（非 2xx 或超时） |
| `success_rate` | 成功率 |
| `latency_p95_ms` | P95 延迟（毫秒） |
| `status` | 状态：active/cooldown |

---

## 配置示例

### 基础权重路由

```json
{
  "strategy": "weight"
}
```

配合 `ProviderPresetItem`:
```json
{
  "weight": 70,
  "priority": 10
}
```

### ε-贪婪探索

```json
{
  "strategy": "epsilon_greedy",
  "epsilon": 0.1,
  "latency_target_ms": 2000
}
```

### UCB1 探索

```json
{
  "strategy": "ucb1"
}
```

### Thompson 采样

```json
{
  "strategy": "thompson"
}
```

### 灰度发布

```json
{
  "strategy": "bandit",
  "gray_ratio": 0.1,
  "gray_tag": "new-provider"
}
```

---

## 最佳实践

### 1. 策略选择

| 场景 | 推荐策略 |
|------|----------|
| 稳定的多上游负载均衡 | `weight` |
| 上游质量波动，需要探索 | `epsilon_greedy` |
| 新上游上线，需要充分测试 | `ucb1` |
| 精细化转化率优化 | `thompson` |

### 2. 参数调优

```
ε-greedy:
- 初期: epsilon=0.2 (更多探索)
- 稳定后: epsilon=0.05 (更多利用)

UCB1:
- 无需手动调参，自动平衡

Thompson:
- alpha=1, beta=1 (无先验)
- 可根据历史数据设置先验
```

### 3. 监控告警

```yaml
# 某臂成功率骤降
- alert: BanditArmSuccessRateDrop
  expr: |
    bandit_arm_success_rate < 0.9
    and bandit_arm_total_trials > 100
  for: 5m

# 所有臂进入冷却
- alert: AllBanditArmsCooldown
  expr: bandit_active_arms == 0
  for: 1m
  severity: critical
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
