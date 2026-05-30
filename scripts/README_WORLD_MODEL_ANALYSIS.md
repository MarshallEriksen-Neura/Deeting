# 世界模型框架历史表现分析工具

本目录包含用于分析世界模型框架历史表现的工具脚本。

## 📋 文件说明

- `query_world_model_performance.sql` - SQL查询脚本，包含14个分析维度
- `run_world_model_analysis.sh` - Bash脚本，快速执行SQL分析
- `analyze_world_model.py` - Python分析工具，提供格式化输出和数据导出

## 🚀 快速开始

### 方法1: 使用Bash脚本 (推荐用于快速查看)

```bash
# 使用默认数据库路径 (~/.deeting/mcp.db)
./scripts/run_world_model_analysis.sh

# 指定数据库路径
./scripts/run_world_model_analysis.sh /path/to/your/mcp.db
```

### 方法2: 使用Python脚本 (推荐用于详细分析)

```bash
# 使用默认数据库路径
python scripts/analyze_world_model.py

# 指定数据库路径
python scripts/analyze_world_model.py ~/.deeting/mcp.db

# 导出JSON报告
python scripts/analyze_world_model.py --export-json report.json

# 导出CSV数据
python scripts/analyze_world_model.py --export-csv ./csv_output

# 查看帮助
python scripts/analyze_world_model.py --help
```

### 方法3: 直接使用SQL (用于自定义查询)

```bash
sqlite3 ~/.deeting/mcp.db < scripts/query_world_model_performance.sql
```

## 📊 分析维度

### 1. 进化信号总体统计
- 总信号数量
- 唯一任务指纹数
- 涉及会话数和追踪数
- 时间范围

### 2. 按分类统计
- Accepted (接受)
- Rejected (拒绝)
- Corrected (修正)
- Neutral (中性)
- Unknown (未知)

### 3. 按来源统计
- `deeting_think` - Deeting思考过程
- `explicit_trace_feedback` - 显式追踪反馈
- `manual_task_learning_revision` - 手动任务学习修订
- `monitor_observation` - 监控观察
- `monitor_feedback` - 监控反馈

### 4. 按状态统计
- `observed` - 已观察
- `classified` - 已分类
- `correlated` - 已关联
- `applied` - 已应用
- `ignored` - 已忽略

### 5. 成功率分析
- 接受/拒绝比率
- 整体成功率百分比

### 6. 时间趋势分析
- 按天统计信号数量
- 每日接受/拒绝趋势

### 7. 高频任务指纹
- Top 10 最活跃的任务
- 每个任务的成功/失败统计

### 8. 进化案例统计
- Reference (参考案例)
- Negative (负面案例)
- Constraint (约束案例)

### 9. 显式反馈分析
- 用户显式反馈的分类分布
- 置信度统计

### 10. 问题信号识别
- 低置信度 + 拒绝的信号
- 潜在问题点

### 11. 监控任务相关
- 监控任务产生的信号统计

### 12. 最近7天活跃度
- 近期活跃度趋势
- 接受率变化

### 13. 案例与信号关联
- 进化案例与原始信号的关联关系

### 14. 置信度分布
- 按置信度区间统计信号分布

## 📈 输出示例

### Python脚本输出示例

```
================================================================================
 世界模型框架历史表现分析报告
================================================================================

数据库路径: /home/user/.deeting/mcp.db
分析时间: 2026-05-30T10:30:00

================================================================================
 1. 总体统计
================================================================================
  总信号数: 1,234
  唯一任务指纹数: 89
  涉及会话数: 156
  涉及追踪数: 234
  最早记录: 2026-04-15 08:23:45
  最新记录: 2026-05-30 10:15:32

================================================================================
 2. 按分类统计
================================================================================
  分类          | 数量    | 占比(%)  | 平均置信度 | 涉及任务数
  ----------------------------------------------------------------
  accepted      | 678     | 54.94    | 0.823      | 67
  rejected      | 234     | 18.96    | 0.456      | 45
  corrected     | 156     | 12.64    | 0.712      | 34
  neutral       | 123     | 9.97     | 0.500      | 28
  unknown       | 43      | 3.48     | 0.234      | 12

================================================================================
 3. 成功率分析
================================================================================
  接受数量: 678
  拒绝数量: 234
  修正数量: 156
  中性数量: 123
  成功率: 74.34%
```

## 🔍 关键指标解读

### 成功率 (Success Rate)
- **计算公式**: `接受数 / (接受数 + 拒绝数) × 100%`
- **健康范围**: 70% - 85%
- **低于60%**: 表明世界模型框架可能存在系统性问题
- **高于90%**: 可能表明验证不够严格

### 置信度 (Confidence)
- **0.9-1.0**: 极高置信度，模型非常确定
- **0.7-0.9**: 高置信度，正常范围
- **0.5-0.7**: 中等置信度，需要关注
- **0.3-0.5**: 低置信度，可能存在问题
- **0.0-0.3**: 极低置信度，需要人工审查

### 进化案例类型
- **Reference**: 成功案例，用于正向学习
- **Negative**: 失败案例，用于避免重复错误
- **Constraint**: 约束案例，用于边界条件学习

## 🛠️ 故障排查

### 数据库文件找不到

```bash
# 检查默认路径
ls -la ~/.deeting/mcp.db

# 查找所有.db文件
find ~ -name "*.db" -type f 2>/dev/null | grep -i deeting
```

### Python依赖问题

```bash
# 脚本只依赖Python标准库，无需额外安装
python3 --version  # 确保Python 3.6+
```

### 权限问题

```bash
# 添加执行权限
chmod +x scripts/run_world_model_analysis.sh
chmod +x scripts/analyze_world_model.py
```

## 📝 自定义查询

如果需要自定义分析，可以直接修改 `query_world_model_performance.sql` 或编写新的SQL查询：

```sql
-- 示例: 查询特定时间范围的信号
SELECT *
FROM evolution_signals
WHERE created_at_unix_ms >= strftime('%s', '2026-05-01') * 1000
  AND created_at_unix_ms < strftime('%s', '2026-06-01') * 1000
ORDER BY created_at_unix_ms DESC;

-- 示例: 查询特定任务指纹的详细信息
SELECT
    es.*,
    datetime(es.created_at_unix_ms/1000, 'unixepoch') AS created_at
FROM evolution_signals es
WHERE es.fingerprint_key = 'your-fingerprint-key-here'
ORDER BY es.created_at_unix_ms DESC;
```

## 🔗 相关文档

- [世界模型架构审计文档](../docs/world-model-architecture-audit.md)
- [架构审计2026-05](../docs/architecture-audit-2026-05.md)
- [委托批处理代码审查](../docs/delegation-batch-code-review.md)

## 📧 问题反馈

如果发现数据异常或工具问题，请检查：

1. 数据库文件是否完整
2. SQLite版本是否兼容 (建议3.35+)
3. 是否有足够的磁盘空间
4. 数据库文件是否被其他进程锁定

## 🎯 最佳实践

1. **定期分析**: 建议每周运行一次分析，跟踪趋势变化
2. **关注异常**: 重点关注成功率突然下降或置信度异常的时期
3. **对比分析**: 保存历史报告，进行时间序列对比
4. **深入调查**: 对于问题信号，使用fingerprint_key深入追踪
5. **导出数据**: 使用`--export-json`或`--export-csv`保存数据用于进一步分析

## 📊 数据可视化建议

导出的JSON/CSV数据可以导入到以下工具进行可视化：

- **Grafana**: 时间序列趋势图
- **Jupyter Notebook**: 自定义Python分析
- **Excel/Google Sheets**: 快速图表生成
- **Tableau/Power BI**: 企业级仪表板

---

**最后更新**: 2026-05-30
**维护者**: Deeting Team
