--[[
API Key Quota Check & Deduct Lua Script

Checks and deducts quotas for a specific API Key.
Supports multiple quota types (request, token, cost) and reset periods (daily, monthly, never).

Keys:
    KEYS[1]: quota_key (e.g., "gw:quota:apikey:{uuid}")

Args:
    ARGV[1]: request_increment (usually 1, or 0 to just check)
    ARGV[2]: current_date (YYYY-MM-DD)
    ARGV[3]: current_month (YYYY-MM)

Redis Hash Structure (for each quota type T in {request, token, cost}):
    "T:limit": number (total quota)
    "T:used": number (used quota)
    "T:period": string (daily, monthly, never)
    "T:date": string (last reset date/month)

Logic:
    For each type T found in the hash:
    1. Check if reset is needed based on T:period and T:date vs current date/month.
       If yes, reset T:used to 0 and update T:date.
    2. Check if T:used + increment > T:limit.
       If yes, return error.
    3. If T == 'request', increment T:used.
       (Token/Cost are usually checked here but incremented asynchronously later,
        unless we want to reserve them, but here we just check existing usage).

Returns:
    {1, "OK"} if allowed.
    {0, "QUOTA_EXCEEDED", type, limit, used} if exceeded.
]]

local key = KEYS[1]
local req_inc = tonumber(ARGV[1]) or 0
local today = ARGV[2]
local month = ARGV[3]

-- Helper to parse number
local function to_number(v) return tonumber(v) or 0 end

-- Get all fields
local data = redis.call('HGETALL', key)
if #data == 0 then
    -- Key not found (expired or not warmed up), let caller handle (or return success if no quotas?)
    -- Usually caller ensures warm-up. If empty, we assume no quotas or allowed.
    -- But if it's really empty, it might be better to return a specific code to trigger warm-up?
    -- For now, if empty, we assume no quotas configured, so ALLOW.
    return {1, "OK"}
end

local map = {}
for i = 1, #data, 2 do
    map[data[i]] = data[i+1]
end

local types = {"request", "token", "cost"}

for _, qtype in ipairs(types) do
    local limit_key = qtype .. ":limit"
    if map[limit_key] then
        local limit = to_number(map[limit_key])
        local used_key = qtype .. ":used"
        local used = to_number(map[used_key])
        local period_key = qtype .. ":period"
        local period = map[period_key] or "never"
        local date_key = qtype .. ":date"
        local last_date = map[date_key]

        -- 1. Reset Logic
        local need_reset = false
        local new_date = last_date

        if period == "daily" then
            if last_date ~= today then
                need_reset = true
                new_date = today
            end
        elseif period == "monthly" then
            if last_date ~= month then
                need_reset = true
                new_date = month
            end
        end

        if need_reset then
            used = 0
            redis.call('HSET', key, used_key, 0, date_key, new_date)
            -- Update local var for check
        end

        -- 2. Check Logic
        local increment = 0
        if qtype == "request" then
            increment = req_inc
        end
        -- For token/cost, we don't increment here, just check existing usage.

        if limit > 0 and (used + increment) > limit then
            return {0, "QUOTA_EXCEEDED", qtype, limit, used}
        end

        -- 3. Increment Logic (only for request)
        if increment > 0 then
            redis.call('HINCRBY', key, used_key, increment)
        end
    end
end

return {1, "OK"}
