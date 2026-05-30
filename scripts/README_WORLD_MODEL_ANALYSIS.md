# 世界模型框架历史表现分析工具

分析 Deeting 世界模型框架(任务学习 / 策略进化)的历史运行表现。

## 📋 文件说明

| 文件 | 用途 |
|---|---|
| `analyze_world_model.py` | **主力工具**。纯 Python 标准库,只读连接,格式化输出 + JSON/CSV 导出 |
| `query_world_model_performance.sql` | sqlite3 CLI 查询脚本(16 个分析维度) |
| `run_world_model_analysis.sh` | Bash 封装,自动探测库路径并以只读模式执行 SQL |

## 🗄️ 数据源(真实表)

世界模型框架的表现数据存储在桌面应用主库 `deeting.db` 中,核心是以下 4 张表:

| 表 | 含义 | 关键字段 |
|---|---|---|
| **`task_learning_runs`** | 每次任务执行的学习记录(**核心**) | `outcome_json`、`execution_policy_json`、`policy_delta_json`、`learning_eligible`、`delta_state`、`last_signal`、`fingerprint_key` |
| `task_policy_priors` | 学到的策略先验 | `decision_point`、`action_key`、`weight`、`confidence`、`evidence_count`、`maturity` |
| `posterior_signal_events` | 后验信号事件 | `source`、`signal`、`confidence` |
| `evolution_signals` | 进化信号(辅助,显式反馈链路) | `source`、`classification`、`confidence` |

### 数据库默认路径

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\com.deeting.desktop\deeting.db` |
| macOS | `~/Library/Application Support/com.deeting.desktop/deeting.db` |
| Linux | `~/.local/share/com.deeting.desktop/deeting.db` |

> ⚠️ 桌面应用运行时会以 WAL 模式持有该库。本工具**一律只读连接**(`file:...?mode=ro` / `sqlite3 -readonly`),不会写入或加锁。可在应用运行时安全查询。

## 🚀 快速开始

### 方法 1: Python(推荐,无需额外依赖)

```bash
# 自动探测默认库路径
python scripts/analyze_world_model.py

# 指定库路径
python scripts/analyze_world_model.py "%APPDATA%\com.deeting.desktop\deeting.db"

# 导出 JSON / CSV
python scripts/analyze_world_model.py --export-json report.json
python scripts/analyze_world_model.py --export-csv ./csv_out
```

### 方法 2: Bash + sqlite3 CLI

```bash
./scripts/run_world_model_analysis.sh
./scripts/run_world_model_analysis.sh /path/to/deeting.db
```

### 方法 3: 直接 SQL

```bash
sqlite3 -readonly ~/AppData/Roaming/com.deeting.desktop/deeting.db \
  < scripts/query_world_model_performance.sql
```

## 📊 分析维度(16 项)

1. 总体统计(运行数 / 任务数 / 会话 / 时间范围)
2. **最终状态**(`final_status`: success / blocked / failed)— 成功率
3. **验证结果**(`verification_result`: unverified / failed / passed / weak_pass)— 质量含金量
4. **成本等级**(`cost_class`: low / medium / high / disproportionate)
5. 框架自评判断(`route_judgment` / `discovery_judgment` / `execution_judgment`)
6. 执行路由 / 平面(`route`: Direct / Worker;`plane`: ResponseOnly / WorkerReasoning)
7. 置信度区间(`outcome.confidence`)
8. 用户反馈信号(`last_signal`: silent / accepted / rejected / corrected)
9. 学习资格 × Δ状态(`learning_eligible` × `delta_state`)
10. 策略调整(`policy_delta`: direction / decision_point / action_key / magnitude)
11. 按周时间趋势
12. 高频任务指纹 Top 12
13. 策略先验成熟度(`maturity`: provisional / confirmed)
14. 最成熟先验 Top 10(按证据数)
15. 后验信号事件(`signal` / `source`)
16. 进化信号(辅助)

## 🔑 关键字段含义

### `outcome_json`(任务结果画像)
- `final_status`: 最终状态 — `success` / `blocked`(被验证拦截)/ `failed`
- `verification_result`: 验证结果 — `unverified`(未验证)/ `failed` / `passed` / `weak_pass`
- `cost_class`: 成本评级 — `low` / `medium` / `high` / `disproportionate`(不成比例)
- `route_judgment`: 路由质量 — `good` / `acceptable` / `wrong` / `wasteful`
- `discovery_judgment`: 发现质量 — `sufficient` / `shallow` / `skipped_when_needed` / `excessive`
- `execution_judgment`: 执行质量 — `justified` / `failed` / `unnecessary` / `fragile`
- `confidence`: 框架对本次判断的置信度(0~1)

### `execution_policy_json`(执行策略)
- `route`: `Direct`(直接响应)/ `Worker`(委托工作者)
- `plane`: `ResponseOnly` / `WorkerReasoning`
- `allow_worker_delegation`、`prefer_workflow_runtime`、`allowed_tool_names` 等

### `policy_delta_json`(策略调整)
- `decision_point`: 决策点 — `route` / `discovery` / `verification` / `worker_selection`
- `direction`: `strengthen`(强化)/ `weaken`(弱化)
- `magnitude`: 调整幅度;`state`: `provisional` / `confirmed`

## 🩺 指标解读

| 指标 | 健康区间 | 异常含义 |
|---|---|---|
| 成功率(`success` 占比) | 70%–85% | 过低=系统性问题;过高=验证不严 |
| **验证通过率**(`passed`/`weak_pass`) | 越高越好 | 大量 `unverified` = "成功"含金量低 |
| 成本(`disproportionate` 占比) | 越低越好 | 高占比 = 用力过猛 / 产出不足 |
| 置信度均值 | >0.6 | 长期 <0.5 = 框架普遍不确定 |
| 先验成熟度(`confirmed` 占比) | 随时间上升 | 长期全 `provisional` = 学习闭环未收敛 |
| 用户反馈(`silent` 占比) | 越低越好 | 接近 100% silent = 缺乏正向确认信号 |

## 📈 关键发现速览(2026-05 快照)

> 基于 2026-04-14 ~ 2026-05-29、445 次运行的一次实测,实际以你运行结果为准。

- 成功率 76.9%,但 **76.4% 的运行 `unverified`**,真正通过验证仅 2 个 → 成功含金量存疑。
- **77.8% 的任务 `cost_class=disproportionate`** → 成本与产出失衡显著。
- 路由 96.4% 是 `Direct`,Worker 委托几乎闲置。
- 置信度 70.8% 落在 0.4–0.6,均值 0.446 偏低。
- 用户反馈 99.8% `silent`;先验 25/26 停留 `provisional`(平均置信度 0.30)。
- **W19 起 `blocked` 与策略调整双双归零**,疑与框架收敛重构相关,建议确认是否预期。

## 🛠️ 故障排查

```bash
# 找不到库?手动定位
find ~ -name "deeting.db" 2>/dev/null

# Windows 中文乱码?Python 脚本已内置 UTF-8 修复;sqlite3 CLI 可设:
export PYTHONIOENCODING=utf-8

# sqlite3 未安装?直接用 Python 版(零依赖)
python scripts/analyze_world_model.py
```

## 📝 自定义查询示例

```sql
-- 某任务指纹的逐次运行明细
SELECT datetime(created_at_unix_ms/1000,'unixepoch') AS t,
       json_extract(outcome_json,'$.final_status') AS status,
       json_extract(outcome_json,'$.confidence')   AS conf
FROM task_learning_runs
WHERE fingerprint_key LIKE '7403a26f%'
ORDER BY created_at_unix_ms DESC;

-- 验证失败(blocked)的运行分布
SELECT json_extract(outcome_json,'$.verification_result') AS vr, COUNT(*)
FROM task_learning_runs
WHERE json_extract(outcome_json,'$.final_status')='blocked'
GROUP BY vr;
```

## 🔗 相关文档

- [世界模型架构审计](../docs/world-model-architecture-audit.md)
- [架构审计 2026-05](../docs/architecture-audit-2026-05.md)

---
**最后更新**: 2026-05-30
