# 从零开始的最优计费与配额方案

## 🎯 设计目标

数据库为空，可以直接实施最佳实践，无需考虑向后兼容和数据迁移。

**核心原则**:
1. **单一真源**: Redis 作为配额的实时真源，DB 作为持久化和审计
2. **原子操作**: 使用 Lua 脚本保证配额检查和扣减的原子性
3. **最终一致性**: 事务提交后异步同步 Redis，保证最终一致
4. **统一路径**: 流式和非流式使用相同的计费逻辑
5. **精确计费**: 流式使用 tiktoken 精确计算，非流式使用上游 usage
6. **幂等保护**: trace_id + 请求指纹作为幂等键，防止重复计费

---

## 📐 架构设计

### 数据流向

```
┌─────────────────────────────────────────────────────────────────┐
│                         请求入口                                  │
│                    (API Gateway)                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 1: validation                            │
│                    (入参校验)                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Step 2: quota_check                              │
│                 (配额检查 - 只检查不扣减)                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │ Redis Lua: quota_check.lua                       │           │
│  │ - 检查 balance (余额 + 信用额度)                  │           │
│  │ - 检查 daily_remaining (日配额)                  │           │
│  │ - 检查 monthly_remaining (月配额)                │           │
│  │ - 检查 rpm_limit (每分钟请求数)                  │           │
│  │ - 检查 tpm_limit (每分钟 token 数)               │           │
│  │ - 不扣减任何配额                                  │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
│  如果任何配额不足 → 返回 403/402                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Step 3-7: 路由、模板、上游调用                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 8: billing                               │
│                    (计费 - 统一扣减)                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │ 1. 计算费用 (input + output tokens)              │           │
│  │ 2. 创建 PENDING 交易记录 (DB)                    │           │
│  │ 3. Redis Lua: quota_deduct.lua                   │           │
│  │    - 扣减 balance                                 │           │
│  │    - 扣减 daily_used                              │           │
│  │    - 扣减 monthly_used                            │           │
│  │    - 原子操作，全部成功或全部失败                  │           │
│  │ 4. 更新交易状态为 COMMITTED (DB)                  │           │
│  │ 5. 提交 DB 事务                                   │           │
│  │ 6. 事务后钩子: 同步 Redis Hash (最终一致性)       │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
│  流式特殊处理:                                                    │
│  - 创建 PENDING 交易 (预估 tokens)                               │
│  - 流完成后调用 commit_pending_transaction()                     │
│  - 使用 tiktoken 精确计算 output tokens                          │
│  - 更新交易为 COMMITTED 并扣减实际费用                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 9: audit_log                             │
│                    (审计日志)                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ 数据库 Schema 设计

### 1. tenant_quota 表 (租户配额)

```sql
CREATE TABLE tenant_quota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE,
    
    -- 余额相关
    balance DECIMAL(20, 6) NOT NULL DEFAULT 0,  -- 当前余额 (美元)
    credit_limit DECIMAL(20, 6) NOT NULL DEFAULT 0,  -- 信用额度
    
    -- 日配额
    daily_quota INTEGER NOT NULL DEFAULT 1000,  -- 日请求配额
    daily_used INTEGER NOT NULL DEFAULT 0,  -- 日已使用
    daily_reset_at DATE NOT NULL,  -- 日配额重置日期
    
    -- 月配额
    monthly_quota INTEGER NOT NULL DEFAULT 30000,  -- 月请求配额
    monthly_used INTEGER NOT NULL DEFAULT 0,  -- 月已使用
    monthly_reset_at DATE NOT NULL,  -- 月配额重置日期
    
    -- 限流配置
    rpm_limit INTEGER,  -- 每分钟请求数限制
    tpm_limit INTEGER,  -- 每分钟 token 数限制
    
    -- 元数据
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,  -- 乐观锁版本号
    
    INDEX idx_tenant_quota_tenant_id (tenant_id),
    INDEX idx_tenant_quota_daily_reset (daily_reset_at),
    INDEX idx_tenant_quota_monthly_reset (monthly_reset_at)
);
```

### 2. billing_transaction 表 (计费流水)

```sql
CREATE TABLE billing_transaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    api_key_id UUID,
    
    -- 幂等键 (trace_id + 请求指纹)
    trace_id VARCHAR(255) NOT NULL UNIQUE,
    
    -- 交易类型
    type VARCHAR(50) NOT NULL,  -- DEDUCT, RECHARGE, REFUND
    status VARCHAR(50) NOT NULL,  -- PENDING, COMMITTED, FAILED, REVERSED
    
    -- 金额
    amount DECIMAL(20, 6) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    
    -- Token 用量
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    input_price DECIMAL(20, 6),  -- 输入价格 (per 1k tokens)
    output_price DECIMAL(20, 6),  -- 输出价格 (per 1k tokens)
    
    -- 余额快照
    balance_before DECIMAL(20, 6),
    balance_after DECIMAL(20, 6),
    
    -- 上游信息
    provider VARCHAR(100),
    model VARCHAR(255),
    preset_item_id UUID,
    
    -- 冲正关联
    reversed_by UUID,  -- 冲正交易 ID
    
    -- 元数据
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    INDEX idx_billing_tenant_id (tenant_id),
    INDEX idx_billing_trace_id (trace_id),
    INDEX idx_billing_api_key_id (api_key_id),
    INDEX idx_billing_status (status),
    INDEX idx_billing_created_at (created_at),
    INDEX idx_billing_tenant_created (tenant_id, created_at)
);
```

### 3. api_key_quota 表 (API Key 配额)

```sql
CREATE TABLE api_key_quota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL,
    
    -- 配额类型
    quota_type VARCHAR(50) NOT NULL,  -- BUDGET, REQUESTS, TOKENS
    
    -- 配额限制
    total_quota BIGINT NOT NULL,  -- 总配额
    used_quota BIGINT NOT NULL DEFAULT 0,  -- 已使用
    
    -- 重置策略
    reset_period VARCHAR(50),  -- DAILY, MONTHLY, NEVER
    reset_at TIMESTAMP,  -- 下次重置时间
    
    -- 元数据
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (api_key_id, quota_type),
    INDEX idx_api_key_quota_key_id (api_key_id),
    INDEX idx_api_key_quota_reset_at (reset_at)
);
```

---

## 🔴 Redis 数据结构设计

### 1. 租户配额 Hash (单一真源)

```
Key: gw:quota:tenant:{tenant_id}
Type: Hash
TTL: 86400 (1 day)

Fields:
  balance: "100.500000"  # 当前余额
  credit_limit: "50.000000"  # 信用额度
  
  daily_quota: "1000"  # 日配额
  daily_used: "150"  # 日已使用
  daily_date: "2026-01-10"  # 日配额日期
  
  monthly_quota: "30000"  # 月配额
  monthly_used: "4500"  # 月已使用
  monthly_month: "2026-01"  # 月配额月份
  
  rpm_limit: "60"  # RPM 限制
  tpm_limit: "100000"  # TPM 限制
  
  version: "123"  # 版本号 (用于检测冲突)
```

### 2. 计费幂等键

```
Key: gw:billing:idempotent:{tenant_id}:{trace_id}
Type: String
Value: "1"
TTL: 86400 (1 day)

用途: 防止重复扣费 (快速拦截)
```

### 3. 限流计数器

```
Key: gw:ratelimit:rpm:{tenant_id}:{minute}
Type: String
Value: "45"  # 当前分钟的请求数
TTL: 120 (2 minutes)

Key: gw:ratelimit:tpm:{tenant_id}:{minute}
Type: String
Value: "12500"  # 当前分钟的 token 数
TTL: 120 (2 minutes)
```

### 4. 会话锁 (防止并发写入冲突)

```
Key: gw:lock:session:{session_id}
Type: String
Value: "{request_id}"
TTL: 30 (30 seconds)

用途: 保护会话写入，防止消息顺序错乱
```

---

## 🔧 Redis Lua 脚本

### 1. quota_check.lua (配额检查 - 只检查不扣减)

```lua
-- KEYS[1]: gw:quota:tenant:{tenant_id}
-- ARGV[1]: estimated_cost (预估费用)
-- ARGV[2]: today (YYYY-MM-DD)
-- ARGV[3]: month (YYYY-MM)

local key = KEYS[1]

-- 检查 Hash 是否存在
if redis.call('EXISTS', key) == 0 then
    return {0, 'QUOTA_NOT_FOUND', 'Cache miss'}
end

-- 读取配额信息
local balance = tonumber(redis.call('HGET', key, 'balance') or 0)
local credit_limit = tonumber(redis.call('HGET', key, 'credit_limit') or 0)
local daily_quota = tonumber(redis.call('HGET', key, 'daily_quota') or 0)
local daily_used = tonumber(redis.call('HGET', key, 'daily_used') or 0)
local daily_date = redis.call('HGET', key, 'daily_date') or ''
local monthly_quota = tonumber(redis.call('HGET', key, 'monthly_quota') or 0)
local monthly_used = tonumber(redis.call('HGET', key, 'monthly_used') or 0)
local monthly_month = redis.call('HGET', key, 'monthly_month') or ''

local estimated_cost = tonumber(ARGV[1])
local today = ARGV[2]
local month = ARGV[3]

-- 1. 检查余额 (余额 + 信用额度)
local effective_balance = balance + credit_limit
if effective_balance < estimated_cost then
    return {0, 'INSUFFICIENT_BALANCE', balance, credit_limit, estimated_cost}
end

-- 2. 检查日配额 (自动重置)
if daily_date ~= today then
    -- 日期变化，重置日配额
    daily_used = 0
end

local daily_remaining = daily_quota - daily_used
if daily_remaining < 1 then
    return {0, 'DAILY_QUOTA_EXCEEDED', daily_quota, daily_used}
end

-- 3. 检查月配额 (自动重置)
if monthly_month ~= month then
    -- 月份变化，重置月配额
    monthly_used = 0
end

local monthly_remaining = monthly_quota - monthly_used
if monthly_remaining < 1 then
    return {0, 'MONTHLY_QUOTA_EXCEEDED', monthly_quota, monthly_used}
end

-- 检查通过
return {
    1,  -- success
    'OK',
    balance,
    credit_limit,
    daily_remaining,
    monthly_remaining
}
```

### 2. quota_deduct.lua (配额扣减 - 原子操作)

```lua
-- KEYS[1]: gw:quota:tenant:{tenant_id}
-- ARGV[1]: amount (扣减金额)
-- ARGV[2]: daily_requests (日请求数增量，通常为 1)
-- ARGV[3]: monthly_requests (月请求数增量，通常为 1)
-- ARGV[4]: today (YYYY-MM-DD)
-- ARGV[5]: month (YYYY-MM)
-- ARGV[6]: allow_negative (0 或 1)

local key = KEYS[1]

-- 检查 Hash 是否存在
if redis.call('EXISTS', key) == 0 then
    return {0, 'QUOTA_NOT_FOUND'}
end

-- 读取配额信息
local balance = tonumber(redis.call('HGET', key, 'balance') or 0)
local credit_limit = tonumber(redis.call('HGET', key, 'credit_limit') or 0)
local daily_quota = tonumber(redis.call('HGET', key, 'daily_quota') or 0)
local daily_used = tonumber(redis.call('HGET', key, 'daily_used') or 0)
local daily_date = redis.call('HGET', key, 'daily_date') or ''
local monthly_quota = tonumber(redis.call('HGET', key, 'monthly_quota') or 0)
local monthly_used = tonumber(redis.call('HGET', key, 'monthly_used') or 0)
local monthly_month = redis.call('HGET', key, 'monthly_month') or ''

local amount = tonumber(ARGV[1])
local daily_requests = tonumber(ARGV[2])
local monthly_requests = tonumber(ARGV[3])
local today = ARGV[4]
local month = ARGV[5]
local allow_negative = tonumber(ARGV[6])

-- 1. 检查并扣减余额
local new_balance = balance - amount
local effective_balance = balance + credit_limit

if allow_negative == 0 and effective_balance < amount then
    return {0, 'INSUFFICIENT_BALANCE', balance, credit_limit, amount}
end

-- 2. 检查并扣减日配额 (自动重置)
if daily_date ~= today then
    -- 日期变化，重置日配额
    daily_used = 0
    daily_date = today
end

local new_daily_used = daily_used + daily_requests
if new_daily_used > daily_quota then
    return {0, 'DAILY_QUOTA_EXCEEDED', daily_quota, daily_used}
end

-- 3. 检查并扣减月配额 (自动重置)
if monthly_month ~= month then
    -- 月份变化，重置月配额
    monthly_used = 0
    monthly_month = month
end

local new_monthly_used = monthly_used + monthly_requests
if new_monthly_used > monthly_quota then
    return {0, 'MONTHLY_QUOTA_EXCEEDED', monthly_quota, monthly_used}
end

-- 4. 原子更新所有字段
redis.call('HSET', key, 'balance', new_balance)
redis.call('HSET', key, 'daily_used', new_daily_used)
redis.call('HSET', key, 'daily_date', daily_date)
redis.call('HSET', key, 'monthly_used', new_monthly_used)
redis.call('HSET', key, 'monthly_month', monthly_month)

-- 增加版本号
local version = tonumber(redis.call('HGET', key, 'version') or 0)
redis.call('HSET', key, 'version', version + 1)

-- 扣减成功
return {
    1,  -- success
    'OK',
    new_balance,
    new_daily_used,
    new_monthly_used,
    version + 1
}
```

---

## 💻 核心代码实现

### 1. QuotaCheckStep (只检查不扣减)

```python
# backend/app/services/workflow/steps/quota_check.py

@step_registry.register
class QuotaCheckStep(BaseStep):
    """
    配额检查步骤 (只检查不扣减)
    
    设计原则:
    - 只检查配额是否充足
    - 不扣减任何配额
    - 使用 Redis Lua 脚本保证原子性
    - 缓存未命中时从 DB 预热
    """
    
    name = "quota_check"
    depends_on = ["validation"]
    
    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行配额检查"""
        tenant_id = ctx.tenant_id
        
        if not tenant_id:
            if ctx.is_external:
                ctx.mark_error(
                    ErrorSource.GATEWAY,
                    "QUOTA_NO_TENANT",
                    "Tenant required for external requests",
                )
                return StepResult(status=StepStatus.FAILED)
            return StepResult(status=StepStatus.SUCCESS)
        
        # 估算费用 (用于余额预检查)
        estimated_cost = await self._estimate_cost(ctx)
        
        try:
            quota_info = await self._check_quota_redis(
                ctx, str(tenant_id), estimated_cost
            )
            
            # 写入上下文
            ctx.set("quota_check", "remaining_balance", quota_info["balance"])
            ctx.set("quota_check", "daily_remaining", quota_info["daily_remaining"])
            ctx.set("quota_check", "monthly_remaining", quota_info["monthly_remaining"])
            
            logger.debug(
                f"Quota check passed trace_id={ctx.trace_id} "
                f"balance={quota_info['balance']:.2f} "
                f"daily={quota_info['daily_remaining']} "
                f"monthly={quota_info['monthly_remaining']}"
            )
            
            return StepResult(status=StepStatus.SUCCESS, data=quota_info)
            
        except QuotaExceededError as e:
            logger.warning(f"Quota exceeded: {e}")
            ctx.mark_error(
                ErrorSource.GATEWAY,
                f"QUOTA_{e.quota_type.upper()}_EXCEEDED",
                str(e),
            )
            return StepResult(status=StepStatus.FAILED, message=str(e))
    
    async def _estimate_cost(self, ctx: "WorkflowContext") -> float:
        """估算请求费用 (用于余额预检查)"""
        # 获取定价配置
        pricing = ctx.get("routing", "pricing_config") or {}
        if not pricing:
            return 0.0
        
        # 估算 tokens
        request = ctx.get("validation", "request")
        max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
        estimated_tokens = max_tokens * 2  # 输入 + 输出
        
        # 计算费用
        avg_price = (
            float(pricing.get("input_per_1k", 0)) + 
            float(pricing.get("output_per_1k", 0))
        ) / 2
        
        estimated_cost = (estimated_tokens / 1000) * avg_price
        return estimated_cost
    
    async def _check_quota_redis(
        self,
        ctx: "WorkflowContext",
        tenant_id: str,
        estimated_cost: float,
    ) -> dict:
        """
        使用 Redis Lua 脚本检查配额
        
        流程:
        1. 检查 Redis Hash 是否存在
        2. 不存在则从 DB 预热
        3. 调用 quota_check.lua 脚本
        4. 返回配额信息
        """
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            # Redis 不可用，回退到 DB
            return await self._check_quota_db(ctx, tenant_id)
        
        # 加载 Lua 脚本
        script_sha = cache.get_script_sha("quota_check")
        if not script_sha:
            await cache.preload_scripts()
            script_sha = cache.get_script_sha("quota_check")
        
        if not script_sha:
            # 脚本加载失败，回退到 DB
            return await self._check_quota_db(ctx, tenant_id)
        
        # 检查缓存是否存在
        key = CacheKeys.quota_hash(tenant_id)
        exists = await redis_client.exists(cache._make_key(key))
        
        if not exists:
            # 缓存未命中，从 DB 预热
            await self._warm_quota_cache(ctx, redis_client, key, tenant_id)
        
        # 调用 Lua 脚本检查配额
        today = self._today_str()
        month = self._month_str()
        
        result = await redis_client.evalsha(
            script_sha,
            keys=[cache._make_key(key)],
            args=[estimated_cost, today, month]
        )
        
        # 解析结果
        # result: [success, message, balance, credit_limit, daily_remaining, monthly_remaining]
        if result[0] == 0:
            # 配额不足
            error_type = result[1]
            if error_type == "INSUFFICIENT_BALANCE":
                raise QuotaExceededError(
                    "balance",
                    float(result[2]) + float(result[3]),  # balance + credit_limit
                    float(result[4])  # required
                )
            elif error_type == "DAILY_QUOTA_EXCEEDED":
                raise QuotaExceededError("daily", float(result[2]), float(result[3]))
            elif error_type == "MONTHLY_QUOTA_EXCEEDED":
                raise QuotaExceededError("monthly", float(result[2]), float(result[3]))
            else:
                raise QuotaExceededError("unknown", 0, 0)
        
        # 检查通过
        return {
            "balance": float(result[2]),
            "credit_limit": float(result[3]),
            "daily_remaining": int(result[4]),
            "monthly_remaining": int(result[5]),
        }
    
    async def _warm_quota_cache(
        self,
        ctx: "WorkflowContext",
        redis_client,
        cache_key: str,
        tenant_id: str,
    ) -> None:
        """从 DB 预热配额缓存"""
        repo = QuotaRepository(ctx.db_session)
        quota = await repo.get_or_create(tenant_id)
        
        payload = {
            "balance": str(quota.balance),
            "credit_limit": str(quota.credit_limit),
            "daily_quota": str(quota.daily_quota),
            "daily_used": str(quota.daily_used),
            "daily_date": quota.daily_reset_at.isoformat() if quota.daily_reset_at else self._today_str(),
            "monthly_quota": str(quota.monthly_quota),
            "monthly_used": str(quota.monthly_used),
            "monthly_month": quota.monthly_reset_at.strftime("%Y-%m") if quota.monthly_reset_at else self._month_str(),
            "rpm_limit": str(quota.rpm_limit) if quota.rpm_limit else "0",
            "tpm_limit": str(quota.tpm_limit) if quota.tpm_limit else "0",
            "version": str(quota.version),
        }
        
        await redis_client.hset(cache._make_key(cache_key), mapping=payload)
        await redis_client.expire(cache._make_key(cache_key), 86400)  # 1 day TTL
        
        logger.info(f"Warmed quota cache for tenant={tenant_id}")
    
    async def _check_quota_db(
        self,
        ctx: "WorkflowContext",
        tenant_id: str,
    ) -> dict:
        """DB 回退路径 (Redis 不可用时)"""
        repo = QuotaRepository(ctx.db_session)
        quota = await repo.get_or_create(tenant_id)
        
        # 检查余额
        effective_balance = quota.balance + quota.credit_limit
        if effective_balance < 0:
            raise QuotaExceededError("balance", 0, float(effective_balance))
        
        # 检查日配额
        daily_remaining = quota.daily_quota - quota.daily_used
        if daily_remaining < 1:
            raise QuotaExceededError("daily", quota.daily_quota, quota.daily_used)
        
        # 检查月配额
        monthly_remaining = quota.monthly_quota - quota.monthly_used
        if monthly_remaining < 1:
            raise QuotaExceededError("monthly", quota.monthly_quota, quota.monthly_used)
        
        return {
            "balance": float(quota.balance),
            "credit_limit": float(quota.credit_limit),
            "daily_remaining": daily_remaining,
            "monthly_remaining": monthly_remaining,
        }
    
    @staticmethod
    def _today_str() -> str:
        from datetime import date
        return date.today().isoformat()
    
    @staticmethod
    def _month_str() -> str:
        from datetime import date
        d = date.today()
        return f"{d.year:04d}-{d.month:02d}"
```

