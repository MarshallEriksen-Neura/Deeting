# Orchestrator 状态一致性问题分析

## 问题概览

当前架构中存在多层状态管理（Context 内存、Redis 缓存、DB 持久化），在并发和异步场景下容易出现一致性问题。

## 关键问题清单

### 🔴 P0 - 严重问题（会导致数据错误）

#### 1. Redis 配额与 DB 余额不同步

**现象**:
- `quota_check` 步骤在 Redis 中扣减 `daily_used++`
- `billing` 步骤在 DB 中扣减 `balance -= cost`
- Redis Hash 中的 `balance` 字段未同步更新
- 下次请求读 Redis 时，余额是旧值

**影响**: 用户可能超额使用，或被错误拒绝

**位置**:
- `backend/app/services/workflow/steps/quota_check.py:_check_tenant_quota()`
- `backend/app/services/workflow/steps/billing.py:_deduct_balance()`

**解决方案**:
```python
# 方案 A: billing 步骤扣费后同步更新 Redis
async def _deduct_balance(self, ctx, total_cost, pricing):
    transaction = await repo.deduct(...)
    
    # 同步更新 Redis 缓存
    redis_client = getattr(cache, "_redis", None)
    if redis_client:
        key = CacheKeys.quota_hash(ctx.tenant_id)
        await redis_client.hset(
            cache._make_key(key),
            "balance",
            float(transaction.balance_after)
        )
    
    return float(transaction.balance_after)

# 方案 B: billing 也走 Lua 脚本原子扣减
# 在 Redis 中维护 balance，定期同步到 DB

# 方案 C: quota_check 只检查不扣减，billing 统一扣减
# 需要调整 Lua 脚本逻辑
```

---

#### 2. API Key budget_used 未持久化

**现象**:
- `quota_check` 读取 `ctx.get("external_auth", "budget_used")`
- `billing` 更新 `ctx.set("external_auth", "budget_used", new_value)`
- 但这个值只在内存 Context 中，未写回 DB/Redis
- 下次请求时，`budget_used` 又从初始值开始

**影响**: API Key 的 budget_limit 检查完全失效

**位置**:
- `backend/app/services/workflow/steps/quota_check.py:execute()`
- `backend/app/services/workflow/steps/billing.py:execute()`

**解决方案**:
```python
# 方案 A: budget_used 从 api_key_quota 表读取和更新
# quota_check 步骤:
api_key_quota = await repo.get_api_key_quota(ctx.api_key_id)
ctx.set("external_auth", "budget_used", api_key_quota.used_quota)

# billing 步骤:
await repo.update_api_key_quota(
    api_key_id=ctx.api_key_id,
    used_quota=new_budget_used
)

# 方案 B: 使用 Redis Hash 存储 API Key 的累计用量
# 定期同步到 DB
```

---

#### 3. 异步任务在事务提交前触发

**现象**:
- `billing` 步骤中 `record_usage_task.delay()` 立即触发
- 但 `BillingRepository.deduct()` 的事务可能未提交
- 如果事务回滚，usage_record 已经写入

**影响**: 用量记录与实际扣费不一致

**位置**:
- `backend/app/services/workflow/steps/billing.py:_record_usage()`

**解决方案**:
```python
# 方案 A: 使用 SQLAlchemy 的 after_commit 事件
from sqlalchemy import event

@event.listens_for(ctx.db_session, "after_commit")
def after_commit(session):
    record_usage_task.delay(usage_data)

# 方案 B: 在 audit_log 步骤统一触发异步任务
# audit_log 是最后一个步骤，此时事务已提交

# 方案 C: usage_record 在同一事务内同步写入
# 不使用 Celery，直接在 billing 步骤写 DB
```

---

### 🟡 P1 - 重要问题（会导致性能或体验问题）

#### 4. 会话窗口的并发写入冲突

**现象**:
- 同一 `session_id` 的并发请求同时读取窗口
- 两个请求都 INSERT 新消息，可能导致顺序错乱
- 摘要任务可能在消息未提交时触发

**影响**: 会话历史错乱，摘要不准确

**位置**:
- `backend/app/services/workflow/steps/conversation_load.py`
- `backend/app/services/workflow/steps/conversation_append.py`

**解决方案**:
```python
# 方案 A: 使用 Redis 分布式锁
async def conversation_append(self, ctx):
    lock_key = f"lock:session:{ctx.session_id}"
    async with redis_lock(lock_key, timeout=10):
        # 读取窗口
        # 写入消息
        # 触发摘要

# 方案 B: 使用消息队列串行化同一 session 的请求
# Celery 的 task routing 按 session_id 分配到同一 worker

# 方案 C: 使用 DB 行锁
# SELECT ... FOR UPDATE WHERE session_id = ?
```

---

#### 5. 路由亲和状态的更新时机不明确

**现象**:
- `routing` 步骤读取亲和，但不更新
- `upstream_call` 步骤成功后才更新
- 如果失败重试切换了上游，亲和状态会指向哪个？

**影响**: 亲和策略可能失效或指向错误的上游

**位置**:
- `backend/app/services/workflow/steps/routing.py`
- `backend/app/services/workflow/steps/upstream_call.py`

**解决方案**:
```python
# 方案 A: 明确策略 - 只在最终成功时更新
# upstream_call 步骤:
if response.status_code == 200:
    await redis.setex(
        f"session:{session_id}:affinity",
        3600,
        ctx.selected_provider_model_id
    )

# 方案 B: 在 response_transform 步骤统一更新
# 此时已确认响应有效

# 方案 C: 添加 TTL 和版本号
# 避免亲和状态永久锁定或指向已下线的上游
```

---

### 🟢 P2 - 次要问题（优化建议）

#### 6. Context 命名空间的键冲突风险

**现象**:
- 各步骤使用 `ctx.set(step_name, key, value)` 写入
- 但没有强制约束，可能出现键名冲突
- 例如多个步骤都写 `"error"` 键

**影响**: 步骤间数据覆盖，调试困难

**解决方案**:
```python
# 方案 A: 使用类型化的 Context 字段
@dataclass
class RoutingContext:
    preset_id: int | None
    upstream_url: str | None
    ...

ctx.routing = RoutingContext(...)

# 方案 B: 添加命名空间校验
def set(self, step_name: str, key: str, value: Any):
    if step_name not in ALLOWED_STEPS:
        raise ValueError(f"Unknown step: {step_name}")
    if key not in ALLOWED_KEYS[step_name]:
        logger.warning(f"Unexpected key: {step_name}.{key}")
    ...
```

---

#### 7. 缓存预热的竞态条件

**现象**:
- `quota_check` 步骤中，如果 Redis 缓存不存在，调用 `_warm_quota_cache()`
- 并发请求可能同时触发预热，导致多次 DB 查询

**影响**: DB 压力增大，性能下降

**解决方案**:
```python
# 方案 A: 使用 SETNX 防止重复预热
async def _warm_quota_cache(self, redis_client, key, repo, tenant_id):
    lock_key = f"{key}:warming"
    if not await redis_client.setnx(lock_key, "1"):
        # 其他请求正在预热，等待
        await asyncio.sleep(0.1)
        return
    
    try:
        await redis_client.expire(lock_key, 5)
        # 执行预热逻辑
        ...
    finally:
        await redis_client.delete(lock_key)

# 方案 B: 使用 Celery 任务异步预热
# 请求直接走 DB，后台任务填充缓存
```

---

## 推荐修复优先级

1. **立即修复 (本周)**:
   - P0-1: Redis 配额与 DB 余额同步
   - P0-2: API Key budget_used 持久化

2. **短期修复 (2周内)**:
   - P0-3: 异步任务事务安全
   - P1-4: 会话窗口并发控制

3. **中期优化 (1个月内)**:
   - P1-5: 路由亲和策略明确化
   - P2-6: Context 命名空间规范化

4. **长期优化 (Backlog)**:
   - P2-7: 缓存预热优化
   - 添加分布式追踪 (OpenTelemetry)
   - 添加状态机可视化工具

---

## 测试建议

### 并发测试
```bash
# 使用 locust 模拟并发请求
locust -f tests/load/test_concurrent_quota.py --users 100 --spawn-rate 10
```

### 一致性测试
```python
# 测试配额扣减的最终一致性
async def test_quota_consistency():
    # 1. 发起 100 个并发请求
    # 2. 检查 Redis 和 DB 的 daily_used 是否一致
    # 3. 检查 balance 是否正确扣减
    ...
```

### 事务回滚测试
```python
# 测试事务回滚时异步任务的行为
async def test_transaction_rollback():
    # 1. 模拟 billing 步骤抛出异常
    # 2. 检查 usage_record 是否被写入
    # 3. 检查 credit_transaction 是否回滚
    ...
```

---

## 监控指标

建议添加以下监控指标：

1. **配额一致性**:
   - `quota.redis_db_diff`: Redis 与 DB 的配额差异
   - `quota.sync_lag_ms`: 配额同步延迟

2. **事务安全**:
   - `billing.transaction_rollback_count`: 事务回滚次数
   - `billing.orphan_usage_record_count`: 孤儿用量记录数

3. **并发冲突**:
   - `conversation.write_conflict_count`: 会话写入冲突次数
   - `cache.warm_race_count`: 缓存预热竞态次数

4. **亲和命中率**:
   - `routing.affinity_hit_rate`: 亲和命中率
   - `routing.affinity_stale_count`: 过期亲和状态数

---

## 相关文档

- [Orchestrator 架构设计](./orchestrator-architecture.md)
- [缓存策略文档](./cache-strategy.md)
- [事务管理规范](./transaction-management.md)
