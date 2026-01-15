# 积分与消费 API

> 供 Dashboard /credits 页面使用的只读接口（不含充值/会员）。

---

## GET /api/v1/credits/balance

获取当前账户余额与当月消费（只统计已确认扣费）。

响应示例：

```json
{
  "balance": 12.5,
  "monthlySpent": 3.5,
  "usedPercent": 21.88
}
```

字段说明：
- `balance`: 当前可用余额
- `monthlySpent`: 本月已确认扣费
- `usedPercent`: 本月消费占比（monthlySpent / (monthlySpent + balance)）

---

## GET /api/v1/credits/consumption?days=30

获取近 N 天游量趋势（按模型汇总的 Token 消耗）。

响应示例：

```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-01-30",
  "days": 30,
  "models": ["gpt-4o", "claude-3.5"],
  "timeline": [
    {
      "date": "2026-01-01",
      "tokensByModel": {
        "gpt-4o": 1200,
        "claude-3.5": 300
      }
    }
  ]
}
```

---

## GET /api/v1/credits/model-usage?days=30

获取近 N 天按模型聚合的 Token 消耗占比。

响应示例：

```json
{
  "totalTokens": 1500,
  "models": [
    {"model": "gpt-4o", "tokens": 1200, "percentage": 80.0},
    {"model": "claude-3.5", "tokens": 300, "percentage": 20.0}
  ]
}
```

---

## GET /api/v1/credits/transactions?limit=20&offset=0

获取最近扣费流水（仅 `deduct + committed`）。

响应示例：

```json
{
  "items": [
    {
      "id": "uuid",
      "traceId": "trace-id",
      "model": "gpt-4o",
      "status": "success",
      "amount": 0.12,
      "inputTokens": 120,
      "outputTokens": 30,
      "totalTokens": 150,
      "createdAt": "2026-01-01T12:00:00Z"
    }
  ],
  "nextOffset": 20
}
```
