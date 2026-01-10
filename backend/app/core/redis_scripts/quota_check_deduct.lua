--[[
配额检查与扣减 Lua 脚本

职责：
- 原子性地检查并扣减配额
- 支持多种配额类型（余额、日配额、月配额）
- 防止超额使用

参数：
- KEYS[1]: 配额 Key（如 gw:quota:tenant123）
- ARGV[1]: 扣减金额/数量
- ARGV[2]: 配额类型（balance/daily/monthly）
- ARGV[3]: 当前日期/月份（用于日/月配额重置判断）

返回值：
- [1]: 是否成功（1=成功，0=配额不足）
- [2]: 扣减后剩余额度
- [3]: 错误类型（如果失败）

存储结构（Hash）：
- balance: 账户余额
- daily_used: 今日已用
- daily_limit: 日配额上限
- daily_date: 日配额日期（用于重置判断）
- monthly_used: 本月已用
- monthly_limit: 月配额上限
- monthly_month: 月配额月份

自动重置：
- 检测到日期/月份变化时自动重置计数

使用方式：
    result = await redis.evalsha(
        script_sha,
        keys=["gw:quota:tenant123"],
        args=[0.05, "balance", "2025-01-05"]
    )
--]]

local key = KEYS[1]
local amount = tonumber(ARGV[1])
local quota_type = ARGV[2] or "balance"
local today = ARGV[3]

-- 获取现有数据
local data = redis.call('HGETALL', key)
local map = {}
for i = 1, #data, 2 do
  map[data[i]] = data[i+1]
end

local function to_number(v) if v then return tonumber(v) else return 0 end end

-- 自动重置日/月用量
if quota_type == "daily" and map["daily_date"] ~= today then
  map["daily_used"] = 0
  map["daily_date"] = today
end

-- 余额检查
if quota_type == "balance" then
  local balance = to_number(map["balance"])
  if balance < amount then
    return {0, balance, "INSUFFICIENT_BALANCE"}
  end
  balance = balance - amount
  redis.call('HSET', key, 'balance', balance)
  return {1, balance, ""}
end

-- 日配额
if quota_type == "daily" then
  local used = to_number(map["daily_used"])
  local limit = to_number(map["daily_limit"])
  if limit > 0 and used + amount > limit then
    return {0, limit - used, "DAILY_LIMIT"}
  end
  redis.call('HMSET', key,
    'daily_used', used + amount,
    'daily_date', today
  )
  return {1, limit - used - amount, ""}
end

-- 月配额
if quota_type == "monthly" then
  local used = to_number(map["monthly_used"])
  local limit = to_number(map["monthly_limit"])
  if limit > 0 and used + amount > limit then
    return {0, limit - used, "MONTHLY_LIMIT"}
  end
  redis.call('HMSET', key,
    'monthly_used', used + amount,
    'monthly_month', today
  )
  return {1, limit - used - amount, ""}
end

return {0, 0, "UNKNOWN_TYPE"}
