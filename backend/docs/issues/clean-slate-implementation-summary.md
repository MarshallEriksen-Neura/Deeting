# 从零开始的最优方案 - 实施总结

## 📋 方案概述

数据库为空，可以直接实施最佳实践，无需考虑向后兼容和数据迁移。

**核心改进**:
1. ✅ **消除重复扣减**: quota_check 只检查不扣减，billing 统一扣减
2. ✅ **统一计费路径**: 流式和非流式都走 billing 步骤（两阶段提交）
3. ✅ **原子操作**: 使用 Redis Lua 脚本保证配额检查和扣减的原子性
4. ✅ **最终一致性**: 事务提交后异步同步 Redis，保证最终一致
5. ✅ **精确计费**: 流式使用 tiktoken 精确计算，非流式使用上游 usage
6. ✅ **幂等保护**: trace_id 作为幂等键，防止重复计费

---

## 🗂️ 文档结构

完整方案分为 3 个文档：

1. **clean-slate-optimal-solution.md** (主文档)
   - 设计目标与核心原则
   - 架构设计与数据流向
   - 数据库 Schema 设计
   - Redis 数据结构设计
   - Redis Lua 脚本
   - QuotaCheckStep 实现

2. **clean-slate-optimal-solution-part2.md** (代码实现)
   - BillingStep 实现（统一流式和非流式）
   - BillingRepository 实现（两阶段提交 + Lua 脚本扣减）
   - 流式计费回调实现

3. **clean-slate-implementation-summary.md** (本文档)
   - 实施总结
   - 关键变更点
   - 实施步骤
   - 测试验收标准

---

## 🔑 关键变更点

### 1. quota_check 步骤：只检查不扣减

**变更前**:
```python
# quota_check 步骤扣减 daily_used 和 monthly_used
daily_res = await redis_client.evalsha(
    script_sha, keys=[key], args=[1, "daily", today]
)  # 扣减 1
monthly_res = await redis_client.evalsha(
    script_sha, keys=[key], args=[1, "monthly", month]
)  # 扣减 1
```

**变更后**:
```python
# quota_check 步骤只检查，不扣减
result = await redis_client.evalsha(
    script_sha,
    keys=[key],
    args=[estimated_cost, today, month]  # 只检查
)
# 返回剩余配额信息，不修改 Redis
```

**优点**:
- 消除重复扣减问题
- 逻辑清晰：检查和扣减分离
- 减少 Redis 操作，提升性能

---

### 2. billing 步骤：统一流式和非流式

**变更前**:
```python
# 流式：跳过 billing 步骤
if ctx.get("upstream_call", "stream"):
    return StepResult(status=StepStatus.SUCCESS)

# 非流式：正常扣费
await repo.deduct(...)
```

**变更后**:
```python
# 流式：创建 PENDING 交易
if is_stream:
    transaction = await repo.create_pending_transaction(...)
    ctx.set("billing", "pending_transaction_id", transaction.id)
    return StepResult(status=StepStatus.SUCCESS)

# 非流式：正常扣费
await repo.deduct(...)
```

**优点**:
- 流式和非流式使用相同的计费逻辑
- 流式也有事务保护（两阶段提交）
- API 层不再直接操作 Repository

---

### 3. BillingRepository：使用 Redis Lua 脚本原子扣减

**变更前**:
```python
# 先扣减 DB，再同步 Redis
quota = await repo.check_and_deduct(...)
await self.session.commit()
await repo._sync_redis_hash(quota)  # 事务外同步
```

**变更后**:
```python
# 先扣减 Redis（原子操作），再更新 DB
result = await redis_client.evalsha(
    script_sha,
    keys=[key],
    args=[amount, daily_requests, monthly_requests, today, month, allow_negative]
)
# Redis 扣减成功后，更新 DB（最终一致性）
quota.balance = Decimal(str(result[2]))
quota.daily_used = int(result[3])
quota.monthly_used = int(result[4])
await self.session.flush()
```

**优点**:
- Redis 作为配额的单一真源
- 原子操作，全部成功或全部失败
- 最终一致性，DB 作为持久化和审计

---

### 4. 流式计费回调：提交 PENDING 交易

**变更前**:
```python
# API 层直接调用 Repository
async def _stream_billing_callback(ctx, accumulator):
    repo = BillingRepository(ctx.db_session)
    await repo.deduct(...)  # 在事务外执行
```

**变更后**:
```python
# API 层提交 PENDING 交易
async def _stream_billing_callback(ctx, accumulator):
    pending_trace_id = ctx.get("billing", "pending_trace_id")
    repo = BillingRepository(ctx.db_session)
    
    # 使用 tiktoken 精确计算 output tokens
    output_tokens = accumulator.calculate_output_tokens(ctx.requested_model)
    
    # 提交 PENDING 交易
    await repo.commit_pending_transaction(
        trace_id=pending_trace_id,
        input_tokens=accumulator.input_tokens,
        output_tokens=output_tokens,
        ...
    )
```

**优点**:
- 流式也走 billing 步骤（两阶段提交）
- 使用 tiktoken 精确计算，误差 < 1%
- 有事务保护和重试机制

---

## 📝 实施步骤

### 第 1 步：创建数据库表（1 天）

```bash
# 1. 创建 Alembic 迁移
cd backend
alembic revision --autogenerate -m "Add optimal billing schema"

# 2. 检查生成的迁移文件
# backend/migrations/versions/xxx_add_optimal_billing_schema.py

# 3. 执行迁移
alembic upgrade head

# 4. 验证表结构
psql -d apiproxy -c "\d tenant_quota"
psql -d apiproxy -c "\d billing_transaction"
psql -d apiproxy -c "\d api_key_quota"
```

**验收标准**:
- [ ] tenant_quota 表创建成功，包含 version 字段
- [ ] billing_transaction 表创建成功，trace_id 有唯一约束
- [ ] api_key_quota 表创建成功，(api_key_id, quota_type) 有唯一约束

---

### 第 2 步：部署 Redis Lua 脚本（1 天）

```bash
# 1. 创建 Lua 脚本文件
mkdir -p backend/app/core/redis_scripts
touch backend/app/core/redis_scripts/quota_check.lua
touch backend/app/core/redis_scripts/quota_deduct.lua

# 2. 复制脚本内容（见主文档）

# 3. 修改 cache.py 加载脚本
# backend/app/core/cache.py

# 4. 测试脚本加载
python -c "
from app.core.cache import cache
import asyncio
asyncio.run(cache.preload_scripts())
print('Scripts loaded:', cache._script_shas)
"
```

**验收标准**:
- [ ] quota_check.lua 脚本加载成功
- [ ] quota_deduct.lua 脚本加载成功
- [ ] 脚本 SHA 存储在 cache._script_shas 中

---

### 第 3 步：重构 QuotaCheckStep（2 天）

```bash
# 1. 备份原文件
cp backend/app/services/workflow/steps/quota_check.py \
   backend/app/services/workflow/steps/quota_check.py.bak

# 2. 替换为新实现（见主文档）

# 3. 运行单元测试
pytest backend/tests/test_quota_check.py -v

# 4. 运行集成测试
pytest backend/tests/integration/test_quota_flow.py -v
```

**验收标准**:
- [ ] quota_check 步骤只检查不扣减
- [ ] 使用 Redis Lua 脚本检查配额
- [ ] 缓存未命中时从 DB 预热
- [ ] Redis 不可用时回退到 DB
- [ ] 所有测试通过

---

### 第 4 步：重构 BillingStep（2 天）

```bash
# 1. 备份原文件
cp backend/app/services/workflow/steps/billing.py \
   backend/app/services/workflow/steps/billing.py.bak

# 2. 替换为新实现（见 part2 文档）

# 3. 运行单元测试
pytest backend/tests/test_billing.py -v

# 4. 运行集成测试
pytest backend/tests/integration/test_billing_flow.py -v
```

**验收标准**:
- [ ] 流式和非流式使用相同的计费逻辑
- [ ] 流式创建 PENDING 交易
- [ ] 非流式直接提交交易
- [ ] 所有测试通过

---

### 第 5 步：重构 BillingRepository（3 天）

```bash
# 1. 备份原文件
cp backend/app/repositories/billing_repository.py \
   backend/app/repositories/billing_repository.py.bak

# 2. 替换为新实现（见 part2 文档）

# 3. 运行单元测试
pytest backend/tests/test_billing_repository.py -v

# 4. 运行集成测试
pytest backend/tests/integration/test_billing_repository.py -v
```

**验收标准**:
- [ ] create_pending_transaction() 创建 PENDING 交易
- [ ] commit_pending_transaction() 提交 PENDING 交易
- [ ] deduct() 使用 Redis Lua 脚本原子扣减
- [ ] 事务提交后异步同步 Redis Hash
- [ ] 所有测试通过

---

### 第 6 步：重构流式计费回调（1 天）

```bash
# 1. 备份原文件
cp backend/app/api/v1/external/gateway.py \
   backend/app/api/v1/external/gateway.py.bak

# 2. 修改 _stream_billing_callback()（见 part2 文档）

# 3. 运行单元测试
pytest backend/tests/test_gateway.py::test_stream_billing -v

# 4. 运行集成测试
pytest backend/tests/integration/test_stream_billing.py -v
```

**验收标准**:
- [ ] 流式计费回调提交 PENDING 交易
- [ ] 使用 tiktoken 精确计算 output tokens
- [ ] 有事务保护和重试机制
- [ ] 所有测试通过

---

### 第 7 步：端到端测试（2 天）

```bash
# 1. 启动开发环境
docker compose -f docker-compose.develop.yml up -d

# 2. 运行端到端测试
pytest backend/tests/e2e/test_billing_e2e.py -v

# 3. 运行压力测试
locust -f backend/tests/load/test_billing_load.py \
  --users 100 --spawn-rate 10 --run-time 5m

# 4. 检查监控指标
curl http://localhost:8000/metrics | grep billing
curl http://localhost:8000/metrics | grep quota
```

**验收标准**:
- [ ] 非流式请求计费准确
- [ ] 流式请求计费准确（误差 < 1%）
- [ ] 并发请求无重复扣减
- [ ] Redis 与 DB 最终一致
- [ ] 性能满足要求（P99 < 100ms）

---

## ✅ 测试验收标准

### 1. 功能测试

#### 非流式请求
```python
async def test_non_stream_billing():
    # 1. 发起非流式请求
    response = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": False
    })
    
    # 2. 检查响应
    assert response.status_code == 200
    data = response.json()
    assert "usage" in data
    
    # 3. 检查计费记录
    transaction = await billing_repo.get_by_trace_id(trace_id)
    assert transaction.status == TransactionStatus.COMMITTED
    assert transaction.input_tokens == data["usage"]["prompt_tokens"]
    assert transaction.output_tokens == data["usage"]["completion_tokens"]
    
    # 4. 检查配额
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.daily_used == 1
    assert quota.monthly_used == 1
    assert quota.balance == initial_balance - transaction.amount
    
    # 5. 检查 Redis
    redis_balance = await redis.hget(f"gw:quota:tenant:{tenant_id}", "balance")
    assert float(redis_balance) == float(quota.balance)
```

#### 流式请求
```python
async def test_stream_billing():
    # 1. 发起流式请求
    response = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": True
    })
    
    # 2. 消费流
    chunks = []
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
    
    # 3. 检查计费记录
    transaction = await billing_repo.get_by_trace_id(trace_id)
    assert transaction.status == TransactionStatus.COMMITTED
    assert transaction.output_tokens > 0
    
    # 4. 检查 token 计算准确性
    # 使用 tiktoken 验证
    import tiktoken
    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    collected_text = "".join([chunk.decode() for chunk in chunks])
    expected_tokens = len(encoding.encode(collected_text))
    
    # 允许 1% 误差
    assert abs(transaction.output_tokens - expected_tokens) / expected_tokens < 0.01
```

#### 幂等性测试
```python
async def test_idempotency():
    # 1. 发起第一次请求
    response1 = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello"}],
    }, headers={"X-Trace-ID": "test-trace-123"})
    
    # 2. 发起第二次请求（相同 trace_id）
    response2 = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello"}],
    }, headers={"X-Trace-ID": "test-trace-123"})
    
    # 3. 检查只有一条计费记录
    transactions = await billing_repo.list_transactions(tenant_id)
    assert len([t for t in transactions if t.trace_id == "test-trace-123"]) == 1
    
    # 4. 检查配额只扣减一次
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.daily_used == 1
    assert quota.monthly_used == 1
```

---

### 2. 并发测试

```python
async def test_concurrent_billing():
    # 1. 发起 100 个并发请求
    tasks = []
    for i in range(100):
        task = client.post("/v1/chat/completions", json={
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": f"Hello {i}"}],
        })
        tasks.append(task)
    
    responses = await asyncio.gather(*tasks)
    
    # 2. 检查所有请求成功
    assert all(r.status_code == 200 for r in responses)
    
    # 3. 检查计费记录数量
    transactions = await billing_repo.list_transactions(tenant_id)
    assert len(transactions) == 100
    
    # 4. 检查配额
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.daily_used == 100
    assert quota.monthly_used == 100
    
    # 5. 检查余额
    total_cost = sum(t.amount for t in transactions)
    assert quota.balance == initial_balance - total_cost
    
    # 6. 检查 Redis 与 DB 一致
    await asyncio.sleep(1)  # 等待最终一致性
    redis_balance = await redis.hget(f"gw:quota:tenant:{tenant_id}", "balance")
    assert abs(float(redis_balance) - float(quota.balance)) < 0.01
```

---

### 3. 故障恢复测试

```python
async def test_redis_failure_recovery():
    # 1. 停止 Redis
    await redis.close()
    
    # 2. 发起请求（应该回退到 DB）
    response = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello"}],
    })
    
    # 3. 检查请求成功
    assert response.status_code == 200
    
    # 4. 检查计费记录
    transaction = await billing_repo.get_by_trace_id(trace_id)
    assert transaction.status == TransactionStatus.COMMITTED
    
    # 5. 重启 Redis
    await redis.connect()
    
    # 6. 发起新请求（应该恢复使用 Redis）
    response = await client.post("/v1/chat/completions", json={
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Hello again"}],
    })
    
    # 7. 检查请求成功
    assert response.status_code == 200
```

---

## 📊 监控指标

### 关键指标

```python
# 1. 配额一致性
metrics.gauge("quota.redis_db_diff", 
    tags={"tenant_id": tenant_id})

# 2. 计费成功率
metrics.counter("billing.deduct_success")
metrics.counter("billing.deduct_failure", 
    tags={"reason": "insufficient_balance|redis_error|db_error"})

# 3. 幂等性
metrics.counter("billing.idempotent_hit")
metrics.counter("billing.idempotent_conflict")

# 4. 流式计费
metrics.counter("billing.stream_pending_created")
metrics.counter("billing.stream_committed")
metrics.counter("billing.stream_failed")
metrics.histogram("billing.stream_token_accuracy_pct")

# 5. 性能
metrics.histogram("quota_check.duration_ms")
metrics.histogram("billing.duration_ms")
metrics.histogram("redis.lua_script_duration_ms", 
    tags={"script": "quota_check|quota_deduct"})
```

### 告警规则

```yaml
# 1. 配额不一致
- alert: QuotaRedisDbDiff
  expr: quota_redis_db_diff > 0.01
  for: 5m
  severity: P1
  message: "Redis 与 DB 配额差异超过 0.01"

# 2. 计费失败率高
- alert: BillingFailureRateHigh
  expr: rate(billing_deduct_failure[5m]) > 0.01
  for: 5m
  severity: P1
  message: "计费失败率超过 1%"

# 3. 流式计费准确性低
- alert: StreamTokenAccuracyLow
  expr: billing_stream_token_accuracy_pct < 0.99
  for: 10m
  severity: P2
  message: "流式 token 计算准确性低于 99%"

# 4. 性能下降
- alert: BillingLatencyHigh
  expr: histogram_quantile(0.99, billing_duration_ms) > 100
  for: 5m
  severity: P2
  message: "计费 P99 延迟超过 100ms"
```

---

## 🎉 总结

完整方案已经设计完成，包括：

1. ✅ **架构设计**: 单一真源、原子操作、最终一致性
2. ✅ **数据库 Schema**: tenant_quota、billing_transaction、api_key_quota
3. ✅ **Redis 数据结构**: 配额 Hash、幂等键、限流计数器、会话锁
4. ✅ **Redis Lua 脚本**: quota_check.lua、quota_deduct.lua
5. ✅ **核心代码实现**: QuotaCheckStep、BillingStep、BillingRepository
6. ✅ **测试验收标准**: 功能测试、并发测试、故障恢复测试
7. ✅ **监控告警**: 关键指标、告警规则

**预计工作量**: 12 天（2 周）

**风险评估**: 低（数据库为空，无需迁移）

**建议**: 按照实施步骤逐步推进，每个步骤完成后进行充分测试，确保质量。
