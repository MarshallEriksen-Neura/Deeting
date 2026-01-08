# Provider 实时故障标记机制

## 📋 功能概述

实时故障标记机制用于在 Provider 失败时立即标记，避免短时间内重复选择故障的 Provider，从而显著减少无效重试时间，提升用户体验。

## 🎯 设计目标

1. **快速响应**：在 Provider 失败时立即标记，无需等待定时巡检
2. **自动恢复**：成功时自动清除故障标记，无需人工干预
3. **可配置**：通过环境变量灵活控制故障阈值和冷却期
4. **低开销**：使用 Redis 计数器，性能影响极小

## 🔧 工作原理

### 1. 故障检测

在候选 Provider 重试过程中：

```python
state = RoutingStateService(redis=redis)
cooldown = await state.get_failure_cooldown_status(provider_id)
if cooldown.should_skip:
    logger.warning(
        "Skipping provider %s: in failure cooldown (failures=%d/%d, cooldown=%ds)",
        provider_id,
        cooldown.count,
        cooldown.threshold,
        cooldown.cooldown_seconds,
    )
    continue
```

### 2. 故障标记

当 Provider 返回可重试的服务器错误时（500, 502, 503, 504, 429）：

```python
if result.retryable and result.status_code in (500, 502, 503, 504, 429):
    await state.increment_provider_failure(provider_id)
```

### 3. 故障恢复

当 Provider 成功响应时：

```python
if result.success:
    await state.clear_provider_failure(provider_id)
```

## ⚙️ 配置项

### 环境变量

```bash
# 故障冷却期（秒）：在此期间内失败次数超过阈值的 Provider 将被跳过
PROVIDER_FAILURE_COOLDOWN_SECONDS=60

# 故障阈值：在冷却期内失败次数超过此值将被跳过
PROVIDER_FAILURE_THRESHOLD=3
```

### 默认值

- `PROVIDER_FAILURE_COOLDOWN_SECONDS`: 60 秒
- `PROVIDER_FAILURE_THRESHOLD`: 3 次

### 调优建议

| 场景 | 冷却期 | 阈值 | 说明 |
|------|--------|------|------|
| **激进模式** | 30s | 2 | 快速跳过故障 Provider，适合高可用场景 |
| **平衡模式** | 60s | 3 | 默认配置，平衡响应速度和容错性 |
| **保守模式** | 120s | 5 | 更宽容的故障容忍，适合 Provider 不稳定场景 |

## 📊 性能影响

### Redis 操作

每次请求最多增加：
- 1 次 `GET`（检查故障计数）
- 1 次 `INCR` + 1 次 `EXPIRE`（失败时）或 1 次 `DELETE`（成功时）

**总开销**：< 5ms（Redis 本地部署）

### 预期收益

| 场景 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| **首次命中故障 Provider** | 2000-3000ms | 500-800ms | ↓70% |
| **连续重试故障 Provider** | 4000-6000ms | 1000-1500ms | ↓75% |
| **故障 Provider 恢复** | 等待下次巡检 | 立即可用 | ↓100% |

## 🔍 监控与日志

### 日志示例

**跳过故障 Provider**：
```
⏭️  Skipping provider anyrouter-66849c86: in failure cooldown (failures=3/3, cooldown=60s)
```

**标记故障**：
```
⚠️  Provider anyrouter-66849c86 failed with status 503, failure count: 3/3 (cooldown=60s)
```

**清除故障标记**：
```
✅ Provider anyrouter-66849c86 succeeded, failure flag cleared
```

**所有候选都失败**：
```
💥 All upstream providers failed for logical model 'claude-sonnet-4-20250514' (total_candidates=3, skipped=2, tried=1)
```

### Redis 键格式

```
provider:failure:{provider_id}
```

示例：
```
provider:failure:anyrouter-66849c86 = "3"  # TTL: 60s
```

## 🧪 测试

运行测试：

```bash
pytest backend/tests/test_candidate_retry_failure_marking.py -v
```

测试覆盖：
- ✅ 获取故障计数
- ✅ 增加故障计数
- ✅ 清除故障标记
- ✅ 跳过故障冷却期的 Provider
- ✅ 可重试错误时标记故障
- ✅ 成功时清除故障标记
- ✅ 所有 Provider 都在故障冷却期

## 🚀 使用示例

### 场景 1：Provider 突然故障

```
时间线：
00:00 - Provider A 返回 503（第 1 次失败）
00:05 - Provider A 返回 503（第 2 次失败）
00:10 - Provider A 返回 503（第 3 次失败，达到阈值）
00:15 - 新请求到达，跳过 Provider A，直接尝试 Provider B ✅
01:10 - 冷却期结束（60秒后），Provider A 重新可用
```

### 场景 2：Provider 瞬时负载高峰

```
时间线：
00:00 - Provider A 返回 429（负载上限，第 1 次失败）
00:02 - Provider A 返回 429（第 2 次失败）
00:04 - Provider A 返回 429（第 3 次失败，达到阈值）
00:06 - 新请求到达，跳过 Provider A，使用 Provider B ✅
00:30 - Provider A 负载恢复
01:06 - 冷却期结束，Provider A 重新可用
```

### 场景 3：Provider 恢复后立即可用

```
时间线：
00:00 - Provider A 有 2 次失败记录
00:10 - Provider A 成功响应 ✅
00:10 - 故障标记被清除，Provider A 立即恢复正常优先级
```

## 🔄 与其他机制的关系

### 与用户探针的配合

- **用户探针**：定期检查 Provider 健康状态（长期趋势）
- **实时故障标记**：立即响应瞬时故障（短期波动）

两者互补：
- 探针发现持久性故障 → 调整 Provider 权重
- 实时标记处理瞬时故障 → 快速跳过故障 Provider

### 与调度器的配合

调度器评分时会考虑：
1. 基础权重（配置）
2. 历史指标（延迟、错误率）
3. 动态权重（探针结果）
4. **实时故障标记**（本机制）← 新增

## 📝 注意事项

1. **Redis 依赖**：需要 Redis 正常运行，否则故障标记功能失效（但不影响主流程）
2. **时钟同步**：多实例部署时需要确保服务器时钟同步
3. **冷却期设置**：过短可能导致频繁切换，过长可能延迟恢复
4. **阈值设置**：过低可能误判，过高可能响应慢

## 🎯 最佳实践

1. **生产环境**：使用默认配置（60s / 3次）
2. **高可用场景**：缩短冷却期到 30s，降低阈值到 2次
3. **不稳定网络**：延长冷却期到 120s，提高阈值到 5次
4. **监控告警**：监控 Redis 键 `provider:failure:*` 的数量和频率

## 📚 相关文档

- [候选重试逻辑](./candidate_retry.py)
- [传输层处理](./transport_handlers.py)
- [路由调度器](../../routing/scheduler.py)
- [用户探针服务](../../services/user_probe_service.py)
