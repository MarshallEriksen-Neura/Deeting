# Orchestrator 全面状态一致性分析报告

## 执行摘要

本报告对整个 orchestrator 编排流程中的所有状态管理点进行了彻底分析，识别出 **15 个关键的数据一致性风险点**，涵盖 API 层、步骤层、Repository 层和缓存层。

### 严重程度分级
- 🔴 **P0 - 致命问题**: 会导致数据错误、资金损失或安全漏洞（7 个）
- 🟡 **P1 - 重要问题**: 会导致性能下降或用户体验问题（5 个）
- 🟢 **P2 - 次要问题**: 优化建议，不影响核心功能（3 个）

---

## 第一部分：API 层的缓存与状态问题

### 🔴 P0-1: API 层流式计费回调中的直接 DB 操作

**位置**: `backend/app/api/v1/external/gateway.py:_stream_billing_callback()`

**问题描述**:
```python
async def _stream_billing_callback(ctx, accumulator):
    # 直接在 API 层操作 BillingRepository
    repo = BillingRepository(ctx.db_session)
    await repo.deduct(...)  # 可能在事务外执行
    
    # 直接在 API 层操作 UsageRepository
    usage_repo = UsageRepository()
    await usage_repo.create(...)  # 没有事务保护
```

**风险**:
1. 流式响应已经开始返回给客户端，此时事务可能已提交或回滚
2. 如果 `deduct()` 失败，用户已经消费了 tokens 但未扣费
3. 如果 `usage_repo.create()` 失败，计费成功但用量记录缺失
4. 没有幂等性保护，流中断重连可能导致重复扣费

**影响**: 
- 资金损失（用户消费未扣费）
- 数据不一致（计费与用量记录不匹配）
- 审计失败（无法追溯实际消费）

**解决方案**:
```python
# 方案 A: 将流式计费移到 billing 步骤，使用延迟提交
# 在 upstream_call 步骤中收集 token 信息
# 在 billing 步骤中统一处理流式和非流式

# 方案 B: 使用消息队列异步处理流式计费
async def _stream_billing_callback(ctx, accumulator):
    # 发送到消息队列，由 worker 处理
    from app.tasks.billing import process_stream_billing_task
    process_stream_billing_task.delay({
        "trace_id": ctx.trace_id,
        "tenant_id": ctx.tenant_id,
        "input_tokens": accumulator.input_tokens,
        "output_tokens": accumulator.output_tokens,
        "pricing": ctx.get("routing", "pricing_config"),
    })

# 方案 C: 使用幂等键 + 两阶段提交
# 1. 流开始时创建 PENDING 交易
# 2. 流完成时更新为 COMMITTED
# 3. 使用 trace_id 作为幂等键防重
```

---


### 🔴 P0-2: external_auth 依赖中的 budget_used 状态管理

**位置**: `backend/app/deps/external_auth.py:get_external_principal()`

**问题描述**:
```python
return ExternalPrincipal(
    budget_limit=getattr(principal, "budget_limit", None),
    budget_used=getattr(principal, "budget_used", 0),  # 从哪里来？
    ...
)
```

**追踪分析**:
1. `budget_used` 从 `principal` 对象获取，但 `ApiKeyService.validate_key()` 返回的对象中没有这个字段
2. `quota_check` 步骤读取 `ctx.get("external_auth", "budget_used")`，初始值为 0
3. `billing` 步骤更新 `ctx.set("external_auth", "budget_used", new_value)`
4. 但这个值只在内存 Context 中，下次请求又从 0 开始

**数据流**:
```
请求 1: budget_used = 0 -> 消费 $0.05 -> budget_used = 0.05 (仅内存)
请求 2: budget_used = 0 -> 消费 $0.03 -> budget_used = 0.03 (仅内存)
实际累计: 应该是 $0.08，但每次都从 0 开始检查
```

**影响**:
- API Key 的 budget_limit 检查完全失效
- 用户可以无限制消费，超出预算限制

**解决方案**:
```python
# 方案 A: 从 api_key_quota 表读取累计用量
# 在 ApiKeyService.validate_key() 中:
async def validate_key(self, api_key: str):
    key_obj = await self.repository.get_by_key_hash(key_hash)
    
    # 查询累计用量
    budget_quota = await self.repository.get_quota(
        key_obj.id, 
        QuotaType.BUDGET
    )
    budget_used = budget_quota.used_quota if budget_quota else 0
    
    return ExternalPrincipal(
        budget_limit=budget_quota.total_quota if budget_quota else None,
        budget_used=budget_used,
        ...
    )

# 在 billing 步骤中更新 DB:
await self.apikey_repo.update_quota_usage(
    api_key_id=ctx.api_key_id,
    quota_type=QuotaType.BUDGET,
    delta=int(total_cost * 100),  # 转换为分
)

# 方案 B: 使用 Redis 累计
# 在 quota_check 步骤中从 Redis 读取
redis_key = f"apikey:budget:{ctx.api_key_id}"
budget_used = await cache.get(redis_key) or 0

# 在 billing 步骤中更新 Redis
await cache.incr(redis_key, total_cost)
await cache.expire(redis_key, 86400 * 30)  # 30 天过期
```

---

### 🔴 P0-3: BillingRepository.deduct() 的 Redis 幂等键与 DB 事务不同步

**位置**: `backend/app/repositories/billing_repository.py:deduct()`

**问题描述**:
```python
async def deduct(self, tenant_id, amount, trace_id, ...):
    # 1. Redis 幂等键检查（在事务外）
    redis_key = CacheKeys.billing_deduct_idempotency(str(tenant_id), trace_id)
    idempotent_locked = await cache.set(redis_key, "1", ttl=86400, nx=True)
    if not idempotent_locked:
        # 快速拦截重复请求
        existing = await self.get_by_trace_id(trace_id)
        return existing
    
    # 2. DB 事务开始
    try:
        async with self.session.begin_nested():
            # 3. 创建交易记录
            transaction = BillingTransaction(...)
            self.session.add(transaction)
            await self.session.flush()
            
            # 4. 扣减配额
            await self._quota_repo.check_and_deduct(...)
            
            # 5. 更新状态为 COMMITTED
            transaction.status = TransactionStatus.COMMITTED
            await self.session.flush()
    except Exception:
        # 6. 失败时释放幂等键
        await cache.delete(redis_key)
        raise
    
    # 7. 事务提交后同步缓存
    await self._quota_repo._sync_redis_hash(updated_quota)
```

**时序问题**:
```
时刻 T1: Redis 幂等键设置成功
时刻 T2: DB 事务开始
时刻 T3: 创建 PENDING 交易
时刻 T4: 扣减配额
时刻 T5: 更新为 COMMITTED
时刻 T6: 事务提交
时刻 T7: 同步 Redis Hash

问题场景 1: T3-T6 之间进程崩溃
- Redis 幂等键已设置（24 小时有效）
- DB 事务回滚，交易记录不存在
- 重试时被幂等键拦截，但 get_by_trace_id() 返回 None
- 导致请求失败，但用户实际未扣费

问题场景 2: T6-T7 之间 Redis 不可用
- DB 事务已提交，扣费成功
- Redis Hash 同步失败
- 下次请求从 Redis 读取的余额是旧值
- 可能导致超额使用或错误拒绝
```

**影响**:
- 幂等性失效（进程崩溃后无法重试）
- Redis 与 DB 余额不一致
- 用户体验差（扣费成功但显示失败）

**解决方案**:
```python
# 方案 A: 使用 DB 事务内的幂等键检查
async def deduct(self, tenant_id, amount, trace_id, ...):
    # 1. 先检查 DB 幂等键
    existing = await self.get_by_trace_id(trace_id)
    if existing:
        if existing.status == TransactionStatus.COMMITTED:
            return existing
        elif existing.status == TransactionStatus.PENDING:
            # 尝试完成之前的 PENDING 交易
            return await self._commit_transaction(existing)
    
    # 2. 事务内处理
    async with self.session.begin_nested():
        # 创建 PENDING 交易（DB 唯一约束保证幂等）
        transaction = BillingTransaction(...)
        try:
            self.session.add(transaction)
            await self.session.flush()
        except IntegrityError:
            # 唯一约束冲突，重新查询
            existing = await self.get_by_trace_id(trace_id)
            return existing
        
        # 扣减配额
        await self._quota_repo.check_and_deduct(...)
        
        # 更新为 COMMITTED
        transaction.status = TransactionStatus.COMMITTED
        await self.session.flush()
    
    # 3. 事务提交后异步同步 Redis（失败不影响主流程）
    try:
        await self._sync_redis_async(updated_quota)
    except Exception as e:
        logger.warning(f"Redis sync failed: {e}")
    
    return transaction

# 方案 B: 使用两阶段提交 + 后台同步
# 1. 创建 PENDING 交易并提交
# 2. 扣减配额并更新为 COMMITTED
# 3. 后台任务定期同步 Redis
```

---


### 🔴 P0-4: QuotaRepository 的 Redis Hash 同步时机问题

**位置**: `backend/app/repositories/quota_repository.py:check_and_deduct()`

**问题描述**:
```python
async def check_and_deduct(self, tenant_id, balance_amount, ...):
    # 1. 乐观锁更新 DB
    stmt = update(TenantQuota).where(
        TenantQuota.id == quota.id,
        TenantQuota.version == old_version,
    ).values(
        balance=TenantQuota.balance - Decimal(str(balance_amount)),
        daily_used=TenantQuota.daily_used + daily_requests,
        version=TenantQuota.version + 1,
    ).returning(TenantQuota)
    
    result = await self.session.execute(stmt)
    updated = result.scalars().first()
    
    if commit:
        await self.session.commit()  # T1: DB 提交
    else:
        await self.session.flush()
    
    if commit and sync_cache:
        await self._sync_redis_hash(updated)  # T2: Redis 同步
```

**时序风险**:
```
场景 1: T1-T2 之间并发请求
- 请求 A: DB 提交，balance = 90
- 请求 B: 从 Redis 读取 balance = 100（旧值）
- 请求 B: 检查通过，扣费 15
- 请求 A: Redis 同步，balance = 90
- 请求 B: DB 提交，balance = 85
- 请求 B: Redis 同步，balance = 85
- 结果: Redis 最终一致，但中间有窗口期

场景 2: T2 Redis 同步失败
- DB 已提交，balance = 90
- Redis 同步失败（网络抖动）
- Redis 中 balance = 100（旧值）
- 下次请求从 Redis 读取，可能超额使用

场景 3: commit=False 时不同步 Redis
- billing 步骤调用 check_and_deduct(commit=False)
- 外层事务提交后，Redis 未同步
- 导致 Redis 与 DB 长期不一致
```

**影响**:
- 并发请求可能读取到过期的余额
- Redis 同步失败导致长期不一致
- 超额使用或错误拒绝

**解决方案**:
```python
# 方案 A: 使用 Redis Lua 脚本原子扣减
# quota_check 步骤使用 Lua 脚本扣减 Redis
# billing 步骤异步同步到 DB（最终一致性）

# 方案 B: 使用事务后钩子同步 Redis
from sqlalchemy import event

@event.listens_for(self.session, "after_commit")
def after_commit(session):
    # 在事务提交后立即同步 Redis
    asyncio.create_task(self._sync_redis_hash(updated))

# 方案 C: 使用 Redis 作为单一真源
# 所有扣减操作都在 Redis 中完成
# DB 只用于持久化和审计
# 定期从 Redis 同步到 DB

# 方案 D: 在 billing 步骤中统一同步
# check_and_deduct() 只负责 DB 操作
# billing 步骤在事务提交后统一同步 Redis
async def execute(self, ctx):
    # 扣费
    transaction = await repo.deduct(...)
    
    # 同步 Redis（在 billing 步骤中）
    redis_client = getattr(cache, "_redis", None)
    if redis_client:
        key = CacheKeys.quota_hash(ctx.tenant_id)
        await redis_client.hset(
            cache._make_key(key),
            "balance",
            str(transaction.balance_after)
        )
```

---

### 🔴 P0-5: quota_check 步骤的 Lua 脚本扣减与 billing 步骤的 DB 扣减不同步

**位置**: 
- `backend/app/services/workflow/steps/quota_check.py:_check_tenant_quota()`
- `backend/app/services/workflow/steps/billing.py:_deduct_balance()`

**问题描述**:
```python
# quota_check 步骤（步骤 3）
async def _check_tenant_quota(self, ctx, tenant_id):
    # 使用 Lua 脚本扣减 daily_used++, monthly_used++
    daily_res = await redis_client.evalsha(
        script_sha, 
        keys=[cache._make_key(key)], 
        args=[1, "daily", today]
    )
    monthly_res = await redis_client.evalsha(
        script_sha, 
        keys=[cache._make_key(key)], 
        args=[1, "monthly", month]
    )
    # 但 balance 只检查，不扣减

# billing 步骤（步骤 11）
async def _deduct_balance(self, ctx, total_cost, pricing):
    # 在 DB 中扣减 balance
    transaction = await repo.deduct(
        tenant_id=ctx.tenant_id,
        amount=Decimal(str(total_cost)),
        ...
    )
    # 但 daily_used, monthly_used 又扣减一次！
    await repo.check_and_deduct(
        tenant_id=ctx.tenant_id,
        daily_requests=1,
        monthly_requests=1,
        ...
    )
```

**数据流分析**:
```
步骤 3 (quota_check):
  Redis: daily_used = 5 -> 6
  Redis: monthly_used = 100 -> 101
  Redis: balance = 100 (只读)

步骤 11 (billing):
  DB: balance = 100 -> 99.95
  DB: daily_used = 5 -> 6  (重复扣减！)
  DB: monthly_used = 100 -> 101  (重复扣减！)
  Redis: balance = 100 -> 99.95 (同步)

最终状态:
  Redis: daily_used = 6, monthly_used = 101
  DB: daily_used = 6, monthly_used = 101
  看起来一致，但实际上 daily/monthly 被扣减了两次！
```

**影响**:
- 日/月配额被重复扣减，用户配额消耗速度翻倍
- 用户可能提前达到配额限制
- 审计数据不准确

**解决方案**:
```python
# 方案 A: quota_check 只检查不扣减
# 在 quota_check 步骤中:
async def _check_tenant_quota(self, ctx, tenant_id):
    # 只检查，不扣减
    daily_remaining = await self._get_daily_remaining(tenant_id)
    monthly_remaining = await self._get_monthly_remaining(tenant_id)
    
    if daily_remaining < 1:
        raise QuotaExceededError("daily", ...)
    if monthly_remaining < 1:
        raise QuotaExceededError("monthly", ...)
    
    # 不执行扣减操作

# 在 billing 步骤中统一扣减:
async def execute(self, ctx):
    # 扣减余额 + 日/月配额
    transaction = await repo.deduct(
        tenant_id=ctx.tenant_id,
        amount=total_cost,
        daily_requests=1,
        monthly_requests=1,
        ...
    )

# 方案 B: quota_check 扣减，billing 不扣减
# 在 quota_check 步骤中:
async def _check_tenant_quota(self, ctx, tenant_id):
    # 扣减日/月配额
    await repo.check_and_deduct(
        tenant_id=tenant_id,
        daily_requests=1,
        monthly_requests=1,
        balance_amount=0,  # 不扣余额
    )

# 在 billing 步骤中:
async def _deduct_balance(self, ctx, total_cost, pricing):
    # 只扣减余额，不扣日/月配额
    transaction = await repo.deduct(
        tenant_id=ctx.tenant_id,
        amount=total_cost,
        daily_requests=0,  # 不扣日配额
        monthly_requests=0,  # 不扣月配额
        ...
    )

# 方案 C: 使用标记位避免重复扣减
# 在 Context 中标记是否已扣减
ctx.set("quota_check", "daily_deducted", True)
ctx.set("quota_check", "monthly_deducted", True)

# billing 步骤检查标记
if not ctx.get("quota_check", "daily_deducted"):
    daily_requests = 1
else:
    daily_requests = 0
```

---

