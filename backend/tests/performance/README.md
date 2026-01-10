
# 性能压测与基线指南

本目录包含用于网关双通道性能基线测试的脚本。

## 📁 脚本说明

1.  **`locustfile_main.py`**: 主流程压测。覆盖外部通道的对话（非流式与流式）以及模型列表接口。
2.  **`locustfile_degrade.py`**: 降级与切换测试。模拟高负载或上游异常时的网关降级与多臂赌徒 (Bandit) 切换逻辑。

## 🚀 快速开始

### 1. 环境准备

首先，你需要创建一个具有足够配额和余额的测试 API Key：

```bash
# 在项目根目录执行
backend/.venv/bin/python backend/scripts/init_test_env.py
```

执行后会输出 `API Key`、`API Secret` 和 `Tenant ID`。将这些值填入 `locustfile_main.py` 的 `API_KEY` 和 `API_SECRET` 占位符中。

### 2. 运行压测 (Locust UI)

```bash
# 进入 backend 目录并启动 locust
cd backend
locust -f tests/performance/locustfile_main.py --host http://localhost:8000
```

访问 `http://localhost:8089` 开始压测。

### 3. 无界面运行 (用于 CI/自动采集)

```bash
locust -f backend/tests/performance/locustfile_main.py --host http://localhost:8000 --headless -u 10 -r 1 -t 5m --csv=baseline_results
```

## 📊 性能基线记录 (建议模板)

在进行重大变更前，请记录以下基线指标：

| 场景 | 并发用户 | RPS | P95 Latency | P99 Latency | 成功率 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 主流程 (Chat) | 10 | | | | | |
| 流式响应 | 10 | | | | | |
| 降级路径 | 5 | | | | | |

## ⚠️ 注意事项

- **数据库与 Redis**: 确保 Redis 已启动，因为限流、nonce 去重和熔断状态高度依赖 Redis。
- **上游模拟**: 建议在内网部署一个 Mock Server 模拟上游 AI 服务，以排除真实上游网络波动的干扰。
- **签名校验**: 压测脚本会自动生成 HMAC 签名，这会消耗一定的 CPU，请确保压测机性能足够。
