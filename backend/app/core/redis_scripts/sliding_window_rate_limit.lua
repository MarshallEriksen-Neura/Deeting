--[[
Multi-Level Sliding Window Rate Limit Lua Script

职责：
- 支持多级原子限流（如同时检查 API Key + 租户 + 全局）
- 原子性：要么全部通过并计数，要么全部拒绝且不计数（All-or-Nothing）

参数：
- KEYS: [key1, key2, ...]
- ARGV: [window1, limit1, window2, limit2, ..., now, request_id]
  - window/limit 成对出现，对应 KEYS 中的每个 key
  - 倒数第二个参数是当前时间戳（毫秒）
  - 最后一个参数是请求 ID

逻辑：
1. 遍历所有 Key，清理过期数据并检查计数。
2. 只要有一个 Key 超限，立即返回拒绝（不增加任何计数）。
3. 只有所有 Key 都通过检查，才对所有 Key 进行 ZADD。

返回值：
- 拒绝: {0, rejected_index, limit, retry_after}
- 允许: {1, min_remaining, max_reset}
--]]

local now = tonumber(ARGV[#ARGV - 1])
local request_id = ARGV[#ARGV]
local num_keys = #KEYS

-- 1. Check Phase
for i = 1, num_keys do
    local key = KEYS[i]
    local window = tonumber(ARGV[(i - 1) * 2 + 1]) * 1000 -- 秒 -> 毫秒
    local limit = tonumber(ARGV[(i - 1) * 2 + 2])
    
    -- 清理过期
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
    
    local count = redis.call('ZCARD', key)
    if count >= limit then
        -- 计算最早过期的时间点，用于 Retry-After
        local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local retry_after = 0
        if #earliest > 1 then
            local earliest_ts = tonumber(earliest[2])
            retry_after = math.ceil((earliest_ts + window - now) / 1000)
        else
            retry_after = math.ceil(window / 1000)
        end
        if retry_after < 0 then retry_after = 0 end
        
        return {0, i, limit, retry_after}
    end
end

-- 2. Commit Phase
local min_remaining = -1
local max_reset = 0

for i = 1, num_keys do
    local key = KEYS[i]
    local window = tonumber(ARGV[(i - 1) * 2 + 1]) * 1000
    local limit = tonumber(ARGV[(i - 1) * 2 + 2])
    
    redis.call('ZADD', key, now, now .. ':' .. request_id)
    redis.call('PEXPIRE', key, window)
    
    local count = redis.call('ZCARD', key)
    local remaining = limit - count
    if min_remaining == -1 or remaining < min_remaining then
        min_remaining = remaining
    end
    
    local reset = math.floor(window / 1000)
    if reset > max_reset then
        max_reset = reset
    end
end

return {1, min_remaining, max_reset}
