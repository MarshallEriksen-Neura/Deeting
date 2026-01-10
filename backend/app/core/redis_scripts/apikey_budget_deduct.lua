-- API Key 预算扣减脚本
-- KEYS[1]: gw:quota:apikey:{api_key_id}
-- ARGV[1]: amount (扣减金额)
-- ARGV[2]: budget_limit (预算上限)
-- ARGV[3]: timestamp (更新时间戳)

local key = KEYS[1]

-- 检查 Hash 是否存在
if redis.call('EXISTS', key) == 0 then
    return {0, 'APIKEY_NOT_FOUND'}
end

-- 读取当前用量
local budget_used = tonumber(redis.call('HGET', key, 'budget_used') or 0)
local budget_limit = tonumber(ARGV[2])
local amount = tonumber(ARGV[1])

-- 检查是否超限
local new_budget_used = budget_used + amount
if budget_limit > 0 and new_budget_used > budget_limit then
    return {0, 'BUDGET_EXCEEDED', budget_limit, budget_used}
end

-- 扣减
redis.call('HINCRBYFLOAT', key, 'budget_used', amount)

-- 更新时间戳
redis.call('HSET', key, 'updated_at', ARGV[3] or '')

return {1, 'OK', new_budget_used}
