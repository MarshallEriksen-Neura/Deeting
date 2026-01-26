# Spec Agent API（内部前端）

> 路由前缀：`/api/v1/spec-agent`  
> 认证方式：JWT Bearer Token

---

## 认证

```
Authorization: Bearer <access_token>
```

---

## 1. 生成规划（SSE）

**POST** `/spec-agent/draft`

Query：
- `stream` (bool, 默认 `true`)：`true` 返回 SSE；`false` 返回 JSON

请求体：
```json
{
  "query": "帮我买一台 1 万以内的笔记本",
  "context": { "budget": 10000 }
}
```

SSE 事件：
- `drafting`：开始规划
- `plan_init`：返回 plan_id 与项目名
- `node_added`：节点生长
- `link_added`：依赖连线
- `plan_ready`：规划完成
- `plan_error`：规划失败

SSE 示例：
```
event: plan_init
data: {"plan_id":"uuid","project_name":"Laptop_Purchase_2026"}

event: node_added
data: {"node":{"id":"T1","type":"action","instruction":"..."}}

event: link_added
data: {"source":"T1","target":"G1"}

event: plan_ready
data: {"plan_id":"uuid"}
```

非流式响应（`stream=false`）：
```json
{
  "plan_id": "uuid",
  "manifest": { "spec_v": "1.2", "project_name": "Laptop_Purchase_2026", "nodes": [] }
}
```

---

## 2. 获取计划详情

**GET** `/spec-agent/plans/{plan_id}`

响应：
```json
{
  "id": "uuid",
  "project_name": "Laptop_Purchase_2026",
  "manifest": { "spec_v": "1.2", "project_name": "Laptop_Purchase_2026", "nodes": [] },
  "connections": [{ "source": "T1", "target": "G1" }],
  "execution": { "status": "drafting", "progress": 0 }
}
```

---

## 3. 获取执行状态（轮询）

**GET** `/spec-agent/plans/{plan_id}/status`

响应：
```json
{
  "execution": { "status": "running", "progress": 45 },
  "nodes": [
    { "id": "T1", "status": "completed", "duration_ms": 2500, "output_preview": "..." },
    { "id": "G1", "status": "active", "pulse": "waiting_approval" }
  ],
  "checkpoint": { "node_id": "G1" }
}
```

---

## 4. 启动执行

**POST** `/spec-agent/plans/{plan_id}/start`

说明：在请求内推进若干步（直到等待/完成/失败或步数上限）。

响应：
```json
{ "status": "running|waiting_approval|completed|failed|stalled", "executed": 2 }
```

---

## 5. 审批交互

**POST** `/spec-agent/plans/{plan_id}/interact`

请求体：
```json
{
  "node_id": "G1",
  "decision": "approve",
  "feedback": "继续执行 Plan B"
}
```

响应：
```json
{ "plan_id": "uuid", "node_id": "G1", "decision": "approve" }
```

---

变更记录：
- 2026-01-26：新增 Spec Agent Draft SSE、Plan 状态与交互接口。
