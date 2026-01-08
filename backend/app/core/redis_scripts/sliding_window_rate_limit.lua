--[[
滑动窗口限流 Lua 脚本

职责：
- 实现精确的滑动窗口限流
- 原子性操作，避免竞态条件
- 返回是否允许和剩余额度

算法：
- 使用 Sorted Set 存储请求时间戳
- 每次请求先清理过期数据
- 检查当前窗口内请求数
- 未超限则添加新请求

参数：
- KEYS[1]: 限流 Key（如 gw:rl:tenant123:chat:rpm）
- ARGV[1]: 窗口大小（秒）
- ARGV[2]: 限流阈值
- ARGV[3]: 当前时间戳（毫秒）
- ARGV[4]: 请求唯一标识（用于去重）

返回值：
- [1]: 是否允许（1=允许，0=拒绝）
- [2]: 剩余额度
- [3]: 重置时间（秒）

使用方式（Python）:
    result = await redis.evalsha(
        script_sha,
        keys=["gw:rl:tenant:chat:rpm"],
        args=[60, 100, current_time_ms, request_id]
    )
    allowed, remaining, reset_after = result

注意事项：
- 时间戳使用毫秒精度
- 窗口大小通常为 60 秒（RPM）或自定义
- 需要定期清理过期数据（脚本内自动处理）
--]]

local key = KEYS[1]
local window = tonumber(ARGV[1]) * 1000  -- 秒 -> 毫秒
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4] or now

-- 清理过期数据
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 当前窗口计数
local count = redis.call('ZCARD', key)
if count >= limit then
    return {0, 0, math.floor(window / 1000)}
end

-- 记录当前请求
redis.call('ZADD', key, now, now .. ':' .. request_id)
redis.call('PEXPIRE', key, window)

local remaining = limit - count - 1
return {1, remaining, math.floor(window / 1000)}
