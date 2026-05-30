-- 世界模型框架历史表现分析查询
-- 数据库: SQLite (evolution_signals 和 evolution_cases 表)
-- 生成时间: 2026-05-30

-- ============================================
-- 1. 进化信号总体统计
-- ============================================
SELECT
    '进化信号总体统计' AS 分析类别,
    COUNT(*) AS 总信号数,
    COUNT(DISTINCT fingerprint_key) AS 唯一任务指纹数,
    COUNT(DISTINCT session_id) AS 涉及会话数,
    COUNT(DISTINCT trace_id) AS 涉及追踪数,
    MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 最早记录时间,
    MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 最新记录时间
FROM evolution_signals;

-- ============================================
-- 2. 按分类统计信号分布
-- ============================================
SELECT
    '按分类统计' AS 分析类别,
    classification AS 分类,
    COUNT(*) AS 信号数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS 占比百分比,
    ROUND(AVG(confidence), 3) AS 平均置信度,
    COUNT(DISTINCT fingerprint_key) AS 涉及任务数
FROM evolution_signals
GROUP BY classification
ORDER BY COUNT(*) DESC;

-- ============================================
-- 3. 按来源统计信号分布
-- ============================================
SELECT
    '按来源统计' AS 分析类别,
    source AS 信号来源,
    COUNT(*) AS 信号数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS 占比百分比,
    COUNT(DISTINCT fingerprint_key) AS 涉及任务数
FROM evolution_signals
GROUP BY source
ORDER BY COUNT(*) DESC;

-- ============================================
-- 4. 按状态统计信号处理进度
-- ============================================
SELECT
    '按状态统计' AS 分析类别,
    status AS 处理状态,
    COUNT(*) AS 信号数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS 占比百分比
FROM evolution_signals
GROUP BY status
ORDER BY
    CASE status
        WHEN 'observed' THEN 1
        WHEN 'classified' THEN 2
        WHEN 'correlated' THEN 3
        WHEN 'applied' THEN 4
        WHEN 'ignored' THEN 5
        ELSE 6
    END;

-- ============================================
-- 5. 成功率分析 (Accepted vs Rejected)
-- ============================================
SELECT
    '成功率分析' AS 分析类别,
    SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS 接受数量,
    SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS 拒绝数量,
    SUM(CASE WHEN classification = 'corrected' THEN 1 ELSE 0 END) AS 修正数量,
    SUM(CASE WHEN classification = 'neutral' THEN 1 ELSE 0 END) AS 中性数量,
    ROUND(
        SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN classification IN ('accepted', 'rejected') THEN 1 ELSE 0 END), 0),
        2
    ) AS 成功率百分比
FROM evolution_signals;

-- ============================================
-- 6. 时间趋势分析 (按天统计)
-- ============================================
SELECT
    '时间趋势' AS 分析类别,
    DATE(created_at_unix_ms/1000, 'unixepoch') AS 日期,
    COUNT(*) AS 信号数量,
    COUNT(DISTINCT fingerprint_key) AS 任务数,
    SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS 接受数,
    SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS 拒绝数
FROM evolution_signals
WHERE created_at_unix_ms > 0
GROUP BY DATE(created_at_unix_ms/1000, 'unixepoch')
ORDER BY 日期 DESC
LIMIT 30;

-- ============================================
-- 7. 高频任务指纹分析 (Top 10)
-- ============================================
SELECT
    '高频任务指纹' AS 分析类别,
    fingerprint_key AS 任务指纹,
    COUNT(*) AS 信号数量,
    SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS 接受数,
    SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS 拒绝数,
    ROUND(AVG(confidence), 3) AS 平均置信度,
    MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 首次出现,
    MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 最近出现
FROM evolution_signals
WHERE fingerprint_key IS NOT NULL
GROUP BY fingerprint_key
ORDER BY COUNT(*) DESC
LIMIT 10;

-- ============================================
-- 8. 进化案例统计
-- ============================================
SELECT
    '进化案例统计' AS 分析类别,
    case_type AS 案例类型,
    COUNT(*) AS 案例数量,
    COUNT(DISTINCT fingerprint_key) AS 涉及任务数,
    ROUND(AVG(confidence), 3) AS 平均置信度,
    MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 最早案例,
    MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS 最新案例
FROM evolution_cases
GROUP BY case_type
ORDER BY COUNT(*) DESC;

-- ============================================
-- 9. 显式反馈信号分析 (ExplicitTraceFeedback)
-- ============================================
SELECT
    '显式反馈分析' AS 分析类别,
    classification AS 分类,
    COUNT(*) AS 数量,
    ROUND(AVG(confidence), 3) AS 平均置信度,
    COUNT(DISTINCT fingerprint_key) AS 涉及任务数
FROM evolution_signals
WHERE source = 'explicit_trace_feedback'
GROUP BY classification
ORDER BY COUNT(*) DESC;

-- ============================================
-- 10. 问题信号识别 (低置信度 + 拒绝)
-- ============================================
SELECT
    '问题信号识别' AS 分析类别,
    id AS 信号ID,
    source AS 来源,
    classification AS 分类,
    fingerprint_key AS 任务指纹,
    confidence AS 置信度,
    datetime(created_at_unix_ms/1000, 'unixepoch') AS 创建时间,
    SUBSTR(note, 1, 100) AS 备注摘要
FROM evolution_signals
WHERE classification = 'rejected' AND confidence < 0.5
ORDER BY created_at_unix_ms DESC
LIMIT 20;

-- ============================================
-- 11. 监控任务相关信号
-- ============================================
SELECT
    '监控任务信号' AS 分析类别,
    COUNT(*) AS 监控信号总数,
    COUNT(DISTINCT monitor_task_id) AS 涉及监控任务数,
    SUM(CASE WHEN source = 'monitor_observation' THEN 1 ELSE 0 END) AS 观察信号数,
    SUM(CASE WHEN source = 'monitor_feedback' THEN 1 ELSE 0 END) AS 反馈信号数
FROM evolution_signals
WHERE monitor_task_id IS NOT NULL;

-- ============================================
-- 12. 最近7天活跃度分析
-- ============================================
SELECT
    '最近7天活跃度' AS 分析类别,
    DATE(created_at_unix_ms/1000, 'unixepoch') AS 日期,
    COUNT(*) AS 信号数量,
    COUNT(DISTINCT session_id) AS 活跃会话数,
    ROUND(
        SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) * 100.0 / COUNT(*),
        2
    ) AS 接受率百分比
FROM evolution_signals
WHERE created_at_unix_ms >= (strftime('%s', 'now', '-7 days') * 1000)
GROUP BY DATE(created_at_unix_ms/1000, 'unixepoch')
ORDER BY 日期 DESC;

-- ============================================
-- 13. 案例与信号关联分析
-- ============================================
SELECT
    '案例信号关联' AS 分析类别,
    ec.case_type AS 案例类型,
    ec.fingerprint_key AS 任务指纹,
    ec.confidence AS 案例置信度,
    COUNT(DISTINCT es.id) AS 关联信号数,
    datetime(ec.created_at_unix_ms/1000, 'unixepoch') AS 案例创建时间,
    SUBSTR(ec.summary, 1, 100) AS 案例摘要
FROM evolution_cases ec
LEFT JOIN evolution_signals es ON
    es.fingerprint_key = ec.fingerprint_key
    AND es.created_at_unix_ms <= ec.created_at_unix_ms
GROUP BY ec.id
ORDER BY ec.created_at_unix_ms DESC
LIMIT 20;

-- ============================================
-- 14. 置信度分布分析
-- ============================================
SELECT
    '置信度分布' AS 分析类别,
    CASE
        WHEN confidence >= 0.9 THEN '0.9-1.0 (极高)'
        WHEN confidence >= 0.7 THEN '0.7-0.9 (高)'
        WHEN confidence >= 0.5 THEN '0.5-0.7 (中)'
        WHEN confidence >= 0.3 THEN '0.3-0.5 (低)'
        ELSE '0.0-0.3 (极低)'
    END AS 置信度区间,
    COUNT(*) AS 信号数量,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS 占比百分比
FROM evolution_signals
GROUP BY
    CASE
        WHEN confidence >= 0.9 THEN '0.9-1.0 (极高)'
        WHEN confidence >= 0.7 THEN '0.7-0.9 (高)'
        WHEN confidence >= 0.5 THEN '0.5-0.7 (中)'
        WHEN confidence >= 0.3 THEN '0.3-0.5 (低)'
        ELSE '0.0-0.3 (极低)'
    END
ORDER BY MIN(confidence) DESC;
