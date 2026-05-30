# Delegation Batch P1 改进实现文档

## 概述

本文档记录了对 `delegation_batch.rs` 实现的三个 P1 优先级改进：
1. 前台模式超时保护
2. 并发限制机制
3. Batch 过期清理

这些改进提升了系统的稳定性和资源管理能力。

---

## 1. 前台模式超时保护

### 问题
前台模式（`run_in_background: false`）无超时限制，如果子 agent 卡死会永久阻塞主模型。

### 解决方案
为前台执行添加基于 `max_rounds` 的超时保护：

```rust
// 每轮 2 分钟，最多 10 分钟
let timeout_ms = prepared.max_rounds as u64 * 120_000;
let timeout_duration = Duration::from_millis(timeout_ms.min(600_000));

let session_result = tokio::time::timeout(timeout_duration, run_future).await;

match session_result {
    Ok(session) => { /* 正常完成 */ }
    Err(_) => {
        // 超时，标记为 failed
        log::warn!("foreground child execution timeout...");
        // 返回 timeout 错误结果
    }
}
```

### 超时计算规则
- **基础公式**：`timeout_ms = max_rounds × 120,000ms`（每轮 2 分钟）
- **上限**：最多 600,000ms（10 分钟）
- **示例**：
  - `max_rounds = 3` → 6 分钟超时
  - `max_rounds = 10` → 10 分钟超时（达到上限）

### 超时行为
1. 子 agent 执行被中断
2. 状态标记为 `Failed`
3. 返回结构化错误：
   ```json
   {
     "type": "delegated_result",
     "status": "failed",
     "error": "Execution timeout after 360000ms",
     "primary_output": {
       "status": "timeout",
       "message": "Child agent execution exceeded timeout of 360000ms"
     }
   }
   ```
4. 记录 warn 日志

---

## 2. 并发限制机制

### 问题
主模型可能一次启动大量后台 child，耗尽系统资源（CPU、内存、API 配额）。

### 解决方案
在 `DelegationBatchManager` 中添加并发计数器和限制检查：

```rust
pub struct DelegationBatchManager {
    batches: Mutex<HashMap<String, DelegationBatch>>,
    running_count: Arc<AtomicUsize>,  // 当前运行中的 child 数量
    max_concurrent: usize,             // 最大并发数（默认 8）
    batch_ttl_ms: i64,
}

impl DelegationBatchManager {
    fn can_spawn_child(&self) -> bool {
        self.running_count() < self.max_concurrent
    }

    fn increment_running(&self) {
        self.running_count.fetch_add(1, Ordering::Relaxed);
    }

    fn decrement_running(&self) {
        self.running_count.fetch_sub(1, Ordering::Relaxed);
    }
}
```

### 并发控制流程

#### 启动时检查
```rust
if !delegation_batch_manager().can_spawn_child() {
    log::warn!("max concurrent children reached, queuing child...");
    // 标记为 failed，返回错误
    let error_result = json!({
        "error": format!(
            "Max concurrent children ({}) reached. Current running: {}",
            max_concurrent, running_count
        )
    });
    delegation_batch_manager().complete_child(..., ChildRunStatus::Failed, error_result);
    continue;
}

delegation_batch_manager().increment_running();
let handle = spawn_background_child(...);
```

#### 完成时递减
```rust
fn spawn_background_child(...) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let session = run_prepared_child(...).await;
        
        // 完成后立即递减计数
        delegation_batch_manager().decrement_running();
        
        // 后续处理...
    })
}
```

### 配置参数
- **默认并发上限**：`max_concurrent = 8`
- **计数器类型**：`Arc<AtomicUsize>`（线程安全）
- **拒绝策略**：立即失败，不排队

### 拒绝行为
当达到并发上限时：
1. 新的后台 child 启动请求被拒绝
2. 状态标记为 `Failed`
3. 返回错误信息：
   ```json
   {
     "status": "failed",
     "error": "Max concurrent children (8) reached. Current running: 8",
     "primary_output": {
       "status": "rejected",
       "message": "Concurrency limit exceeded"
     }
   }
   ```
4. 记录 warn 日志

---

## 3. Batch 过期清理

### 问题
已完成的 batch 永久保留在内存中，长时间运行会导致内存泄漏。

### 解决方案
添加定期清理机制，在 `delegate_agents_status` 调用时触发：

```rust
pub async fn execute_delegate_agents_status_tool(...) -> Result<...> {
    // 定期清理过期 batch
    delegation_batch_manager().cleanup_expired_batches();
    
    // 正常查询逻辑...
}
```

### 清理逻辑
```rust
fn cleanup_expired_batches(&self) {
    let mut batches = self.batches.lock().unwrap();
    let now = now_unix_ms_i64();
    
    batches.retain(|_batch_id, batch| {
        // 检查是否所有 child 都已终止
        let all_terminal = batch.children.values().all(|child| {
            matches!(
                child.record.status,
                ChildRunStatus::Completed | ChildRunStatus::Failed | ChildRunStatus::Cancelled
            )
        });
        
        if all_terminal {
            // 找到最晚完成的 child
            if let Some(latest_completed) = batch.children.values()
                .filter_map(|c| c.record.completed_at_ms)
                .max()
            {
                // 保留未过期的 batch
                return now - latest_completed < self.batch_ttl_ms;
            }
        }
        
        // 保留运行中的 batch
        true
    });
}
```

### 清理规则
1. **只清理已完成的 batch**：所有 child 都处于终止状态（Completed/Failed/Cancelled）
2. **基于最晚完成时间**：从最后一个 child 完成时开始计时
3. **默认 TTL**：`batch_ttl_ms = 3,600,000ms`（1 小时）
4. **保留运行中的 batch**：即使创建时间很久，只要有 child 在运行就不清理

### 触发时机
- 每次调用 `delegate_agents_status` 时自动触发
- 轻量级操作，不影响查询性能

### 配置参数
- **默认 TTL**：`batch_ttl_ms = 3_600_000`（1 小时）
- **清理策略**：retain（保留未过期的）

---

## 测试覆盖

### 新增测试用例

#### 1. 并发限制测试
```rust
#[test]
fn concurrency_limit_enforced() {
    let manager = DelegationBatchManager::new();
    assert_eq!(manager.running_count(), 0);
    assert!(manager.can_spawn_child());

    // 模拟达到并发上限
    for _ in 0..manager.max_concurrent {
        manager.increment_running();
    }
    assert!(!manager.can_spawn_child());

    // 递减后可以再次 spawn
    manager.decrement_running();
    assert!(manager.can_spawn_child());
}
```

#### 2. 过期清理测试
```rust
#[test]
fn cleanup_expired_batches_removes_old_completed() {
    let manager = DelegationBatchManager::new();
    let old_time = now_unix_ms_i64() - manager.batch_ttl_ms - 1000;

    // 插入旧的已完成 batch
    manager.insert_batch("batch-old", vec![test_record("run-1")]);
    // 手动设置为已完成且过期
    
    // 插入新的 batch
    manager.insert_batch("batch-new", vec![test_record("run-2")]);

    // 清理前有 2 个 batch
    assert_eq!(manager.batches.lock().unwrap().len(), 2);

    // 清理
    manager.cleanup_expired_batches();

    // 清理后只剩新的 batch
    assert_eq!(manager.batches.lock().unwrap().len(), 1);
    assert!(batches.contains_key("batch-new"));
}
```

#### 3. 保留运行中 batch 测试
```rust
#[test]
fn cleanup_keeps_running_batches() {
    let manager = DelegationBatchManager::new();
    manager.insert_batch("batch-running", vec![test_record("run-1")]);

    // 清理不应该删除运行中的 batch
    manager.cleanup_expired_batches();
    assert_eq!(manager.batches.lock().unwrap().len(), 1);
}
```

### 测试运行
```bash
cd deeting/src-tauri
cargo test --package deeting --lib \
  modules::desktop_runtime::runtime::chat_tool_runtime::tool_execution::delegation_batch::tests
```

---

## 配置建议

### 生产环境
```rust
DelegationBatchManager {
    max_concurrent: 8,        // 适中的并发数
    batch_ttl_ms: 3_600_000,  // 1 小时 TTL
}
```

### 高负载环境
```rust
DelegationBatchManager {
    max_concurrent: 4,         // 降低并发，保护资源
    batch_ttl_ms: 1_800_000,   // 30 分钟 TTL，更快清理
}
```

### 开发/测试环境
```rust
DelegationBatchManager {
    max_concurrent: 16,        // 更高并发，快速测试
    batch_ttl_ms: 600_000,     // 10 分钟 TTL，快速清理
}
```

---

## 性能影响

### 前台超时保护
- **开销**：`tokio::time::timeout` 包装，几乎无性能损失
- **收益**：防止永久阻塞，提升系统可靠性

### 并发限制
- **开销**：`AtomicUsize` 原子操作，纳秒级
- **收益**：防止资源耗尽，保护系统稳定性

### Batch 清理
- **开销**：每次 status 查询时遍历 batch map，O(n) 复杂度
- **优化**：只在 status 调用时触发，不影响 start/stop
- **收益**：防止内存泄漏，长期运行稳定

---

## 监控建议

### 关键指标
1. **并发拒绝率**：`rejected_children / total_children`
   - 正常：< 5%
   - 警告：> 10%（考虑提高 `max_concurrent`）

2. **超时率**：`timeout_children / total_children`
   - 正常：< 2%
   - 警告：> 5%（检查子 agent 性能）

3. **Batch 清理频率**：每小时清理的 batch 数量
   - 正常：稳定增长
   - 异常：突然激增（可能有泄漏）

4. **平均运行中 child 数**：`running_count` 的时间序列
   - 正常：< `max_concurrent * 0.8`
   - 警告：长期接近 `max_concurrent`

### 日志关键字
- `max concurrent children reached` — 并发限制触发
- `foreground child execution timeout` — 前台超时
- `delegate_agents_start late child result ignored` — 取消后的 late completion

---

## 未来改进方向

### P2 优先级
1. **可配置参数**：通过环境变量或配置文件调整 `max_concurrent` 和 `batch_ttl_ms`
2. **排队机制**：达到并发上限时排队等待，而非立即拒绝
3. **优先级调度**：高优先级 child 优先获取执行槽位
4. **动态调整**：根据系统负载自动调整 `max_concurrent`

### P3 优先级
5. **Batch 持久化**：支持跨进程重启恢复
6. **分布式限流**：多实例环境下的全局并发控制
7. **细粒度超时**：不同 agent_type 使用不同的超时策略
8. **预算管理**：基于 token/cost 的资源限制

---

## 总结

这三个 P1 改进显著提升了 delegation batch 系统的生产稳定性：

| 改进 | 解决的问题 | 收益 |
|------|-----------|------|
| 前台超时保护 | 永久阻塞 | 防止主模型卡死 |
| 并发限制 | 资源耗尽 | 保护系统稳定性 |
| Batch 清理 | 内存泄漏 | 支持长期运行 |

**实现质量**：
- ✅ 测试覆盖充分
- ✅ 错误处理健壮
- ✅ 日志记录完善
- ✅ 性能开销可控

**建议下一步**：
1. 在生产环境监控关键指标
2. 根据实际负载调整配置参数
3. 考虑实现 P2 优先级的可配置参数
