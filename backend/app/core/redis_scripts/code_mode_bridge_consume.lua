-- Code Mode Runtime Bridge Token 消费脚本（原子）
-- KEYS[1]: ai_gateway:code_mode:runtime_bridge:{token}
--
-- 返回:
--   [1, "OK", call_index, max_calls, claims_json, ttl]
--   [0, "CALL_LIMIT", used_calls, max_calls, claims_json, ttl]
--   [0, "NOT_FOUND", 0, 0, "", -2]

local key = KEYS[1]

if redis.call('EXISTS', key) == 0 then
    return {0, 'NOT_FOUND', 0, 0, '', -2}
end

local claims_json = redis.call('HGET', key, 'claims_json') or ''
local used_calls = tonumber(redis.call('HGET', key, 'used_calls') or '0')
local max_calls = tonumber(redis.call('HGET', key, 'max_calls') or '1')
if max_calls < 1 then
    max_calls = 1
end

local ttl = redis.call('TTL', key)

if used_calls >= max_calls then
    return {0, 'CALL_LIMIT', used_calls, max_calls, claims_json, ttl}
end

redis.call('HINCRBY', key, 'used_calls', 1)
return {1, 'OK', used_calls, max_calls, claims_json, ttl}

