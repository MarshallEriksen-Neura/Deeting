--[[
令牌桶限流 Lua 脚本

职责：
- 实现令牌桶算法限流
- 支持突发流量处理
- 平滑限流效果

算法：
- 桶有固定容量（burst）
- 以固定速率（rate）添加令牌
- 每次请求消耗一个令牌
- 令牌不足时拒绝请求

参数：
- KEYS[1]: 限流 Key
- ARGV[1]: 桶容量（最大突发）
- ARGV[2]: 填充速率（每秒令牌数）
- ARGV[3]: 当前时间戳（秒）
- ARGV[4]: 请求消耗的令牌数（默认 1）

返回值：
- [1]: 是否允许（1=允许，0=拒绝）
- [2]: 剩余令牌数
- [3]: 下次可用时间（秒后）

存储结构（Hash）：
- tokens: 当前令牌数
- last_update: 最后更新时间

使用场景：
- TPM 限流（每个 token 消耗 1 个令牌）
- 需要允许突发但限制平均速率的场景

与滑动窗口对比：
- 滑动窗口：精确计数，无突发容忍
- 令牌桶：允许突发，平滑长期速率
--]]

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])        -- tokens per second
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1

-- 读取当前状态
local tokens = 0
local last_update = now
local data = redis.call('HMGET', key, 'tokens', 'last_update')
if data[1] then tokens = tonumber(data[1]) end
if data[2] then last_update = tonumber(data[2]) end

-- 补充令牌
local elapsed = math.max(0, now - last_update)
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
local retry_after = 0
if tokens >= cost then
    allowed = 1
    tokens = tokens - cost
else
    retry_after = math.ceil((cost - tokens) / rate)
end

redis.call('HMSET', key, 'tokens', tokens, 'last_update', now)
redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)

return {allowed, tokens, retry_after}
