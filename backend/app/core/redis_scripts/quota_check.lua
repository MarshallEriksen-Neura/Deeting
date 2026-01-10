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
    daily_used = 0
end

local daily_remaining = daily_quota - daily_used
if daily_remaining < 1 then
    return {0, 'DAILY_QUOTA_EXCEEDED', daily_quota, daily_used}
end

-- 3. 检查月配额 (自动重置)
if monthly_month ~= month then
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
