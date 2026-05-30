-- 世界模型框架历史表现分析查询
-- 数据库: SQLite (主库 deeting.db)
-- 真实表: task_learning_runs / task_policy_priors / posterior_signal_events / evolution_signals
-- 更新时间: 2026-05-30
--
-- 用法 (需已安装 sqlite3 CLI 且编译了 JSON1 扩展, 现代版本默认包含):
--   sqlite3 "file:<db路径>?mode=ro" < query_world_model_performance.sql
-- Windows 默认库路径:
--   %APPDATA%\com.deeting.desktop\deeting.db
-- 说明: 务必用 mode=ro 只读连接, 因为桌面应用运行时会持有该库 (WAL 模式)。

.headers on
.mode column

-- ============================================
-- 1. 学习运行总体统计 (task_learning_runs)
-- ============================================
SELECT
    '总体统计' AS 分析类别,
    COUNT(*) AS 学习运行数,
    COUNT(DISTINCT fingerprint_key) AS 唯一任务指纹数,
    COUNT(DISTINCT session_id) AS 涉及会话数,
    COUNT(DISTINCT trace_id) AS 涉及追踪数,
    SUM(learning_eligible) AS 可学习运行数,
    datetime(MIN(created_at_unix_ms)/1000, 'unixepoch') AS 最早记录,
    datetime(MAX(created_at_unix_ms)/1000, 'unixepoch') AS 最新记录
FROM task_learning_runs;

-- ============================================
-- 2. 最终状态分布 (成功率核心)
-- ============================================
SELECT
    '最终状态' AS 分析类别,
    json_extract(outcome_json, '$.final_status') AS 状态,
    COUNT(*) AS 数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM task_learning_runs WHERE json_valid(outcome_json)), 1) AS 占比
FROM task_learning_runs
WHERE json_valid(outcome_json)
GROUP BY 状态
ORDER BY 数量 DESC;

-- ============================================
-- 3. 验证结果分布 (质量含金量)
-- ============================================
SELECT
    '验证结果' AS 分析类别,
    json_extract(outcome_json, '$.verification_result') AS 验证结果,
    COUNT(*) AS 数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM task_learning_runs WHERE json_valid(outcome_json)), 1) AS 占比
FROM task_learning_runs
WHERE json_valid(outcome_json)
GROUP BY 验证结果
ORDER BY 数量 DESC;

-- ============================================
-- 4. 成本等级分布 (cost_class)
-- ============================================
SELECT
    '成本等级' AS 分析类别,
    json_extract(outcome_json, '$.cost_class') AS 成本等级,
    COUNT(*) AS 数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM task_learning_runs WHERE json_valid(outcome_json)), 1) AS 占比
FROM task_learning_runs
WHERE json_valid(outcome_json)
GROUP BY 成本等级
ORDER BY 数量 DESC;

-- ============================================
-- 5. 框架自评判断 (route / discovery / execution)
-- ============================================
SELECT '路由判断' AS 维度, json_extract(outcome_json, '$.route_judgment') AS 取值, COUNT(*) AS 数量
FROM task_learning_runs WHERE json_valid(outcome_json) GROUP BY 取值
UNION ALL
SELECT '发现判断', json_extract(outcome_json, '$.discovery_judgment'), COUNT(*)
FROM task_learning_runs WHERE json_valid(outcome_json) GROUP BY json_extract(outcome_json, '$.discovery_judgment')
UNION ALL
SELECT '执行判断', json_extract(outcome_json, '$.execution_judgment'), COUNT(*)
FROM task_learning_runs WHERE json_valid(outcome_json) GROUP BY json_extract(outcome_json, '$.execution_judgment')
ORDER BY 维度, 数量 DESC;

-- ============================================
-- 6. 执行路由与平面分布 (execution_policy_json)
-- ============================================
SELECT
    '执行路由' AS 分析类别,
    json_extract(execution_policy_json, '$.route') AS 路由,
    json_extract(execution_policy_json, '$.plane') AS 平面,
    COUNT(*) AS 数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM task_learning_runs WHERE json_valid(execution_policy_json)), 1) AS 占比
FROM task_learning_runs
WHERE json_valid(execution_policy_json)
GROUP BY 路由, 平面
ORDER BY 数量 DESC;

-- ============================================
-- 7. 置信度区间分布 (outcome.confidence)
-- ============================================
SELECT
    '置信度分布' AS 分析类别,
    CASE
        WHEN json_extract(outcome_json, '$.confidence') >= 0.8 THEN '0.8-1.0 (高)'
        WHEN json_extract(outcome_json, '$.confidence') >= 0.6 THEN '0.6-0.8 (中高)'
        WHEN json_extract(outcome_json, '$.confidence') >= 0.4 THEN '0.4-0.6 (中)'
        ELSE '<0.4 (低)'
    END AS 置信度区间,
    COUNT(*) AS 数量,
    ROUND(AVG(json_extract(outcome_json, '$.confidence')), 3) AS 区间均值
FROM task_learning_runs
WHERE json_valid(outcome_json)
GROUP BY 置信度区间
ORDER BY 置信度区间 DESC;

-- ============================================
-- 8. 用户反馈信号分布 (last_signal)
-- ============================================
SELECT
    '用户反馈信号' AS 分析类别,
    COALESCE(last_signal, '(null)') AS 信号,
    COUNT(*) AS 数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM task_learning_runs), 1) AS 占比
FROM task_learning_runs
GROUP BY last_signal
ORDER BY 数量 DESC;

-- ============================================
-- 9. 学习资格与策略调整状态
-- ============================================
SELECT
    '学习资格×Δ状态' AS 分析类别,
    learning_eligible AS 可学习,
    COALESCE(delta_state, '(null)') AS Δ状态,
    COUNT(*) AS 数量
FROM task_learning_runs
GROUP BY learning_eligible, delta_state
ORDER BY 数量 DESC;

-- ============================================
-- 10. 策略调整方向与决策点 (policy_delta_json)
-- ============================================
SELECT
    '策略调整' AS 分析类别,
    json_extract(policy_delta_json, '$.decision_point') AS 决策点,
    json_extract(policy_delta_json, '$.action_key') AS 动作,
    json_extract(policy_delta_json, '$.direction') AS 方向,
    COUNT(*) AS 数量,
    ROUND(AVG(json_extract(policy_delta_json, '$.magnitude')), 3) AS 平均幅度
FROM task_learning_runs
WHERE json_valid(policy_delta_json)
GROUP BY 决策点, 动作, 方向
ORDER BY 数量 DESC
LIMIT 15;

-- ============================================
-- 11. 按周时间趋势
-- ============================================
SELECT
    '按周趋势' AS 分析类别,
    strftime('%Y-W%W', datetime(created_at_unix_ms/1000, 'unixepoch')) AS 周,
    COUNT(*) AS 运行数,
    COUNT(DISTINCT fingerprint_key) AS 任务数,
    SUM(learning_eligible) AS 可学习,
    SUM(CASE WHEN json_extract(outcome_json, '$.final_status') = 'success' THEN 1 ELSE 0 END) AS 成功,
    SUM(CASE WHEN json_extract(outcome_json, '$.final_status') = 'blocked' THEN 1 ELSE 0 END) AS 拦截,
    ROUND(AVG(json_extract(outcome_json, '$.confidence')), 3) AS 平均置信度
FROM task_learning_runs
GROUP BY 周
ORDER BY 周;

-- ============================================
-- 12. 高频任务指纹 Top 12
-- ============================================
SELECT
    '高频任务' AS 分析类别,
    substr(fingerprint_key, 1, 16) AS 任务指纹,
    COUNT(*) AS 运行数,
    SUM(learning_eligible) AS 可学习,
    SUM(CASE WHEN json_extract(outcome_json, '$.final_status') = 'success' THEN 1 ELSE 0 END) AS 成功,
    SUM(CASE WHEN json_extract(outcome_json, '$.final_status') = 'blocked' THEN 1 ELSE 0 END) AS 拦截,
    ROUND(AVG(json_extract(outcome_json, '$.confidence')), 3) AS 平均置信度
FROM task_learning_runs
GROUP BY fingerprint_key
ORDER BY 运行数 DESC
LIMIT 12;

-- ============================================
-- 13. 策略先验成熟度 (task_policy_priors)
-- ============================================
SELECT
    '先验成熟度' AS 分析类别,
    maturity AS 成熟度,
    COUNT(*) AS 先验数,
    ROUND(AVG(weight), 3) AS 平均权重,
    ROUND(AVG(confidence), 3) AS 平均置信度,
    SUM(evidence_count) AS 总证据数
FROM task_policy_priors
GROUP BY maturity
ORDER BY 先验数 DESC;

-- ============================================
-- 14. 最成熟的先验 Top 10 (按证据数)
-- ============================================
SELECT
    '成熟先验' AS 分析类别,
    decision_point AS 决策点,
    substr(action_key, 1, 20) AS 动作,
    ROUND(weight, 3) AS 权重,
    ROUND(confidence, 3) AS 置信度,
    evidence_count AS 证据数,
    maturity AS 成熟度
FROM task_policy_priors
ORDER BY evidence_count DESC, confidence DESC
LIMIT 10;

-- ============================================
-- 15. 后验信号事件分布 (posterior_signal_events)
-- ============================================
SELECT
    '后验信号' AS 分析类别,
    signal AS 信号,
    source AS 来源,
    COUNT(*) AS 数量,
    ROUND(AVG(confidence), 3) AS 平均置信度
FROM posterior_signal_events
GROUP BY signal, source
ORDER BY 数量 DESC;

-- ============================================
-- 16. 进化信号分布 (evolution_signals, 辅助)
-- ============================================
SELECT
    '进化信号' AS 分析类别,
    source AS 来源,
    classification AS 分类,
    COUNT(*) AS 数量,
    ROUND(AVG(confidence), 3) AS 平均置信度
FROM evolution_signals
GROUP BY source, classification
ORDER BY 数量 DESC;
