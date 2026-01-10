-- 配额扣减脚本（原子操作）
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
