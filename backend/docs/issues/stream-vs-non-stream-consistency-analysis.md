# 流式 vs 非流式计费一致性对比分析

## 🎯 核心发现

**关键结论**: 流式和非流式使用了**完全不同的计费路径**，导致它们有**不同的问题**，但也有**共同的底层问题**。

---

## 📊 处理流程对比

### 非流式请求流程

```
1. API 层: chat_completions()
   └─> orchestrator.execute(ctx)
       
2. Orchestrator 执行 12 个步骤:
   ├─ Step 1: request_adapter
   ├─ Step 2: validation
   ├─ Step 3: signature_verify
   ├─ Step 4: quota_check ⚠️ 扣减 daily_used++, monthly_used++
   ├─ Step 5: rate_limit
   ├─ Step 6: routing
   ├─ Step 7: template_render
   ├─ Step 8: upstream_call (获取完整响应 + token 信息)
   ├─ Step 9: response_transform
   ├─ Step 10: sanitize
   ├─ Step 11: billing ⚠️ 扣减 balance, daily_used++, monthly_used++
   └─ Step 12: audit_log

3. API 层: handle_workflow_result()
   └─> 返回 JSONResponse
```

### 流式请求流程

```
1. API 层: chat_completions()
   └─> orchestrator.execute(ctx)
       
2. Orchestrator 执行 12 个步骤:
   ├─ Step 1-7: 同非流式
   ├─ Step 8: upstream_call (创建流生成器，立即返回)
   ├─ Step 9-10: 跳过（流式无法提前转换）
   ├─ Step 11: billing ⚠️ 跳过！（因为还没有 token 信息）
   └─ Step 12: audit_log

3. API 层: handle_workflow_result()
   ├─> 检测到 stream=true
   ├─> 包装流: stream_with_billing()
   └─> 返回 StreamingResponse
   
4. 流式传输过程:
   ├─> 客户端开始接收数据
   ├─> StreamTokenAccumulator 累计 tokens
   └─> 流完成后触发 _stream_billing_callback() ⚠️

5. _stream_billing_callback() (在 API 层！):
   ├─> 计算费用
   ├─> BillingRepository.deduct() ⚠️ 直接调用，绕过 billing 步骤
   └─> UsageRepository.create() ⚠️ 直接调用，绕过 audit_log 步骤
```

---

## 🔴 问题对比表

| 问题 | 非流式 | 流式 | 共同问题 |
|------|--------|------|----------|
| **P0-1: API 层直接操作 Repository** | ❌ 无 | ✅ 有 | ❌ |
| **P0-2: budget_used 未持久化** | ✅ 有 | ✅ 有 | ✅ |
| **P0-3: Redis 幂等键与 DB 事务不同步** | ✅ 有 | ✅ 有 | ✅ |
| **P0-4: Redis Hash 同步时机问题** | ✅ 有 | ✅ 有 | ✅ |
| **P0-5: quota_check 与 billing 重复扣减** | ✅ 有 | ⚠️ 部分 | ⚠️ |
| **P0-6: 会话并发写入冲突** | ✅ 有 | ✅ 有 | ✅ |
| **P0-7: 路由亲和更新时机不明确** | ✅ 有 | ✅ 有 | ✅ |
| **P1-8: 异步任务在事务提交前触发** | ✅ 有 | ✅ 有 | ✅ |
| **流式特有: 事务已提交但流未完成** | ❌ 无 | ✅ 有 | ❌ |
| **流式特有: 流中断导致计费缺失** | ❌ 无 | ✅ 有 | ❌ |
| **流式特有: 重复计费（流重连）** | ❌ 无 | ✅ 有 | ❌ |

---

## 🔍 详细问题分析

### 问题 1: 流式请求的 API 层直接操作 Repository（流式特有）

**非流式**: ✅ 正常
```python
# 非流式走标准流程
Step 11 (billing):
  └─> BillingRepository.deduct()
      ├─> 在 orchestrator 事务内
      ├─> 有完整的错误处理
      └─> 有重试机制
```

**流式**: ❌ 有问题
```python
# 流式绕过 billing 步骤，在 API 层直接调用
_stream_billing_callback():
  └─> BillingRepository.deduct()
      ├─> 在 orchestrator 事务外！
      ├─> 流已经开始返回给客户端
      ├─> 如果扣费失败，用户已经消费了 tokens
      └─> 没有重试机制
```

**风险**:
- 用户已经收到完整响应，但扣费失败 → 资金损失
- 没有事务保护，无法回滚
- 没有重试机制，网络抖动导致扣费失败

---

### 问题 2: budget_used 未持久化（共同问题）

**非流式**: ❌ 有问题
```python
# billing 步骤
current_budget_used = float(ctx.get("external_auth", "budget_used") or 0.0)
new_budget_used = current_budget_used + total_cost
ctx.set("external_auth", "budget_used", new_budget_used)
# 只在内存中更新，未写入 DB
```

**流式**: ❌ 有问题
```python
# _stream_billing_callback() 中没有更新 budget_used
# 导致流式请求的 budget 检查完全失效
```

**数据流**:
```
请求 1 (非流式): budget_used = 0 -> 消费 $0.05 -> budget_used = 0.05 (仅内存)
请求 2 (流式):   budget_used = 0 -> 消费 $0.10 -> budget_used = 0 (未更新！)
请求 3 (非流式): budget_used = 0 -> 消费 $0.03 -> budget_used = 0.03 (仅内存)

实际累计: $0.18，但每次检查都从 0 开始
```

---

### 问题 3: quota_check 与 billing 重复扣减（部分共同）

**非流式**: ❌ 有问题
```python
Step 4 (quota_check):
  Redis Lua: daily_used++ (5 -> 6)
  Redis Lua: monthly_used++ (100 -> 101)

Step 11 (billing):
  DB: daily_used++ (5 -> 6)  # 重复扣减！
  DB: monthly_used++ (100 -> 101)  # 重复扣减！
```

**流式**: ⚠️ 部分问题
```python
Step 4 (quota_check):
  Redis Lua: daily_used++ (5 -> 6)
  Redis Lua: monthly_used++ (100 -> 101)

Step 11 (billing):
  跳过！（因为是流式）

_stream_billing_callback():
  BillingRepository.deduct():
    DB: daily_used++ (5 -> 6)  # 仍然重复扣减！
    DB: monthly_used++ (100 -> 101)  # 仍然重复扣减！
```

**结论**: 流式和非流式都有重复扣减问题，只是触发路径不同。

---

### 问题 4: 流式特有问题 - 事务已提交但流未完成

**场景**:
```
T1: orchestrator.execute() 完成
T2: DB 事务提交（quota_check 的扣减已持久化）
T3: 返回 StreamingResponse
T4: 客户端开始接收流
T5: 流传输中...
T6: 网络中断，流失败
T7: _stream_billing_callback() 未触发
T8: 用户未收到完整响应，但 daily_used 已扣减
```

**影响**:
- 用户体验差（请求失败但配额已扣）
- 配额不准确（失败请求也消耗配额）
- 无法回滚（事务已提交）

---

### 问题 5: 流式特有问题 - 流中断导致计费缺失

**场景**:
```
T1: 流开始传输
T2: 客户端接收了 50% 的数据
T3: 客户端断开连接（用户关闭浏览器）
T4: stream_with_billing() 的 finally 块执行
T5: _stream_billing_callback() 触发
T6: accumulator.output_tokens = 0（因为没有收到 usage 信息）
T7: 使用 estimate_output_tokens() 估算
T8: 估算值 = chunks * 3 = 50 * 3 = 150 tokens
T9: 实际消费 = 500 tokens（上游已生成）
T10: 少计费 350 tokens → 资金损失
```

**影响**:
- 流中断时 token 估算不准确
- 上游已生成完整响应，但只计费部分 tokens
- 资金损失

---

### 问题 6: 流式特有问题 - 流重连导致重复计费

**场景**:
```
请求 1 (trace_id=abc123):
  T1: 流开始传输
  T2: 网络抖动，客户端重连
  T3: _stream_billing_callback() 触发
  T4: BillingRepository.deduct(trace_id=abc123, amount=0.05)
  T5: 创建交易记录

请求 2 (trace_id=abc123, 客户端重试):
  T6: 流开始传输
  T7: 流完成
  T8: _stream_billing_callback() 触发
  T9: BillingRepository.deduct(trace_id=abc123, amount=0.05)
  T10: 幂等键检查，返回已有记录
  T11: 但用户实际消费了 2 次！
```

**影响**:
- 客户端重试时，trace_id 相同
- 幂等键防止重复扣费，但用户实际消费了多次
- 资金损失

---

## 🛠️ 修复方案对比

### 方案 A: 统一计费路径（推荐）

**思路**: 让流式和非流式都走 billing 步骤

```python
# 修改 billing 步骤，支持流式
class BillingStep(BaseStep):
    async def execute(self, ctx):
        # 检查是否流式
        if ctx.get("upstream_call", "stream"):
            # 流式：创建 PENDING 交易，不扣费
            transaction = await self._create_pending_transaction(ctx)
            ctx.set("billing", "pending_transaction_id", transaction.id)
            return StepResult(status=StepStatus.SUCCESS)
        
        # 非流式：正常扣费
        return await self._deduct_and_record(ctx)

# 修改 _stream_billing_callback()
async def _stream_billing_callback(ctx, accumulator):
    # 更新 PENDING 交易为 COMMITTED
    pending_id = ctx.get("billing", "pending_transaction_id")
    if pending_id:
        repo = BillingRepository(ctx.db_session)
        await repo.commit_pending_transaction(
            transaction_id=pending_id,
            input_tokens=accumulator.input_tokens,
            output_tokens=accumulator.output_tokens,
        )
```

**优点**:
- 统一计费逻辑，减少代码重复
- 流式也有事务保护（两阶段提交）
- 流式也有重试机制

**缺点**:
- 需要修改 BillingRepository，增加两阶段提交支持
- 流式的 PENDING 交易可能长时间未提交（需要定时清理）

---

### 方案 B: 流式使用消息队列（推荐）

**思路**: 流式计费通过消息队列异步处理

```python
# 修改 _stream_billing_callback()
async def _stream_billing_callback(ctx, accumulator):
    # 发送到消息队列
    from app.tasks.billing import process_stream_billing_task
    
    process_stream_billing_task.delay({
        "trace_id": ctx.trace_id,
        "tenant_id": ctx.tenant_id,
        "api_key_id": ctx.api_key_id,
        "input_tokens": accumulator.input_tokens,
        "output_tokens": accumulator.output_tokens,
        "pricing": ctx.get("routing", "pricing_config"),
        "provider": ctx.upstream_result.provider,
        "model": ctx.requested_model,
    })

# Celery 任务
@celery_app.task(bind=True, max_retries=3)
def process_stream_billing_task(self, data):
    # 在独立事务中处理计费
    with get_sync_session() as session:
        repo = BillingRepository(session)
        repo.deduct(
            tenant_id=data["tenant_id"],
            amount=calculate_cost(data),
            trace_id=data["trace_id"],
            ...
        )
        session.commit()
```

**优点**:
- 解耦流式响应和计费
- 有重试机制（Celery 自动重试）
- 不阻塞流式响应

**缺点**:
- 计费延迟（异步处理）
- 需要处理任务失败的情况

---

### 方案 C: 流式预扣费 + 流完成后结算（最安全）

**思路**: 流开始前预扣费，流完成后多退少补

```python
# quota_check 步骤
async def execute(self, ctx):
    if ctx.get("upstream_call", "stream"):
        # 流式：预扣最大配额
        max_tokens = ctx.get("validation", "request").max_tokens or 4096
        estimated_cost = calculate_cost(max_tokens)
        
        # 预扣费
        await self._pre_deduct(ctx, estimated_cost)
        ctx.set("quota_check", "pre_deducted", estimated_cost)

# _stream_billing_callback()
async def _stream_billing_callback(ctx, accumulator):
    pre_deducted = ctx.get("quota_check", "pre_deducted") or 0
    actual_cost = calculate_cost(accumulator.total_tokens)
    
    if actual_cost < pre_deducted:
        # 退还多扣的费用
        await repo.refund(
            tenant_id=ctx.tenant_id,
            amount=pre_deducted - actual_cost,
            trace_id=f"{ctx.trace_id}-refund",
        )
    elif actual_cost > pre_deducted:
        # 补扣不足的费用
        await repo.deduct(
            tenant_id=ctx.tenant_id,
            amount=actual_cost - pre_deducted,
            trace_id=f"{ctx.trace_id}-补扣",
        )
```

**优点**:
- 最安全，用户不会超额使用
- 流中断时已经扣费，不会资金损失

**缺点**:
- 复杂度高（预扣 + 结算）
- 用户体验差（预扣可能很大）

---

## 📋 修复优先级

### 立即修复（本周）

1. **P0-1 (流式特有)**: API 层直接操作 Repository
   - **方案**: 使用方案 B（消息队列）
   - **工作量**: 2 天
   - **风险**: 低

2. **P0-2 (共同)**: budget_used 未持久化
   - **方案**: 从 api_key_quota 表读取和更新
   - **工作量**: 1 天
   - **风险**: 低

3. **P0-5 (共同)**: quota_check 与 billing 重复扣减
   - **方案**: quota_check 只检查不扣减
   - **工作量**: 1 天
   - **风险**: 低

### 短期修复（2 周内）

4. **流式特有**: 流中断导致计费缺失
   - **方案**: 使用 tiktoken 精确计算或要求上游返回 usage
   - **工作量**: 2 天

5. **流式特有**: 流重连导致重复计费
   - **方案**: 使用 trace_id + 时间戳作为幂等键
   - **工作量**: 1 天

6. **P0-3, P0-4 (共同)**: Redis 与 DB 同步问题
   - **方案**: 使用事务后钩子或 Lua 脚本
   - **工作量**: 3 天

---

## ✅ 验收标准

### 非流式请求
- [ ] 相同 trace_id 的请求重复执行，结果完全一致
- [ ] 100 个并发请求后，余额计算准确无误
- [ ] daily_used 和 monthly_used 不重复扣减
- [ ] budget_used 正确累计并持久化

### 流式请求
- [ ] 流中断时，计费准确（误差 < 5%）
- [ ] 流重连时，不重复计费
- [ ] 流完成后，余额正确扣减
- [ ] 流失败时，配额正确回滚（如果使用预扣费方案）

---

**最后更新**: 2026-01-10
**负责人**: Backend Team
