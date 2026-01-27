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
  "context": { "budget": 10000 },
  "model": "gpt-4o"
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
data: {"plan_id":"uuid","project_name":"Laptop_Purchase_2026","conversation_session_id":"uuid"}

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

## 2. 获取计划列表

**GET** `/spec-agent/plans`

Query：
- `cursor` (string, 可选)：游标
- `size` (int, 可选)：每页条数
- `status` (string, 可选)：按状态过滤（DRAFT/RUNNING/PAUSED/COMPLETED/FAILED）

响应：
```json
{
  "items": [
    {
      "id": "uuid",
      "project_name": "Laptop_Purchase_2026",
      "status": "RUNNING",
      "created_at": "2026-01-26T03:21:12.123Z",
      "updated_at": "2026-01-26T03:25:45.456Z"
    }
  ],
  "next_page": "cursor",
  "previous_page": null
}
```

---

## 3. 获取计划详情

**GET** `/spec-agent/plans/{plan_id}`

响应：
```json
{
  "id": "uuid",
  "conversation_session_id": "uuid",
  "project_name": "Laptop_Purchase_2026",
  "manifest": { "spec_v": "1.2", "project_name": "Laptop_Purchase_2026", "nodes": [] },
  "connections": [{ "source": "T1", "target": "G1" }],
  "execution": { "status": "drafting", "progress": 0 }
}
```

---

## 4. 获取执行状态（轮询）

**GET** `/spec-agent/plans/{plan_id}/status`

响应：
```json
{
  "execution": { "status": "running", "progress": 45 },
  "nodes": [
    { "id": "T1", "status": "completed", "duration_ms": 2500, "output_preview": "...", "logs": ["> Node started. Tool count: 2"] },
    { "id": "G1", "status": "active", "pulse": "waiting_approval" }
  ],
  "checkpoint": { "node_id": "G1" }
}
```

---

## 5. 获取节点详情（抽屉/审查）

**GET** `/spec-agent/plans/{plan_id}/nodes/{node_id}`

响应：
```json
{
  "plan_id": "uuid",
  "node_id": "T1",
  "node": { "id": "T1", "type": "action", "instruction": "..." },
  "execution": {
    "status": "waiting",
    "created_at": "2026-01-27T03:21:12.123Z",
    "started_at": "2026-01-27T03:21:20.123Z",
    "completed_at": null,
    "duration_ms": null,
    "input_snapshot": { "resolved_args": {} },
    "output_data": null,
    "raw_response": null,
    "error_message": null,
    "worker_snapshot": null,
    "logs": ["> Node started. Tool count: 2"]
  }
}
```

错误码：
- 404 `plan_not_found`
- 404 `node_not_found`

---

## 6. 节点重跑（应用预约指令）

**POST** `/spec-agent/plans/{plan_id}/nodes/{node_id}/rerun`

响应：
```json
{
  "plan_id": "uuid",
  "node_id": "T1",
  "queued_nodes": ["T1", "T2"]
}
```

说明：
- 如果节点存在 `pending_instruction`，调用后会自动应用并清空。
- 会把该节点及其下游节点重置为 PENDING，等待重新执行。

错误码：
- 404 `plan_not_found`
- 404 `node_not_found`

---

## 7. 节点事件记录（审计）

**POST** `/spec-agent/plans/{plan_id}/nodes/{node_id}/events`

请求体：
```json
{
  "event": "rerun_prompt",
  "source": "auto_drawer",
  "payload": {
    "edit_distance": 0.12,
    "error_code": "none"
  }
}
```

响应：
```json
{ "status": "ok" }
```

说明：
- 用于记录 UI 行为触发来源（例如 rerun 弹窗的自动提示来源），写入会话日志便于审计。
- payload 可选，承载编辑距离、错误码、应用结果等扩展信息。
- 当 plan 未绑定 `conversation_session_id` 时返回 `status=skip`。

错误码：
- 404 `plan_not_found`
- 404 `node_not_found`

---

## 8. 启动执行

**POST** `/spec-agent/plans/{plan_id}/start`

说明：在请求内推进若干步（直到等待/完成/失败或步数上限）。

响应：
```json
{ "status": "running|waiting_approval|completed|failed|stalled", "executed": 2 }
```

---

## 9. 审批交互

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

## 10. 节点模型覆盖 / 指令热修改

**PATCH** `/spec-agent/plans/{plan_id}/nodes/{node_id}`

请求体（传 `null` 清空覆盖）：
```json
{
  "model_override": "gpt-4o",
  "instruction": "重新生成对比表，包含价格与汇率"
}
```

响应：
```json
{
  "plan_id": "uuid",
  "node_id": "T1",
  "model_override": "gpt-4o",
  "instruction": "重新生成对比表，包含价格与汇率",
  "pending_instruction": null
}
```

说明：
- 当节点处于 RUNNING 状态且传入 instruction 时，会写入 `pending_instruction`，不打断当前执行。
- 当节点处于 WAITING_APPROVAL/DRAFT 时，instruction 会直接覆盖并清空 `pending_instruction`。

错误码：
- 404 `plan_not_found`：计划不存在或不属于当前用户
- 404 `node_not_found`：节点不存在
- 400 `node_not_action`：仅 action 节点支持模型覆盖
- 400 `model_not_available`：模型不可用或不可访问
- 400 `node_not_waiting`：仅等待审批节点可修改指令（运行中将进入预约）
- 400 `instruction_empty`：指令不能为空
- 400 `node_not_waiting`：仅等待审批节点可修改指令
- 400 `instruction_empty`：指令不能为空

---

变更记录：
- 2026-01-26：新增 Spec Agent Draft SSE、Plan 状态与交互接口。
- 2026-01-26：新增节点级模型覆盖接口。
- 2026-01-26：新增计划列表接口。
- 2026-01-26：Plan 状态节点返回执行日志 logs。
- 2026-01-27：新增节点事件记录接口（审计 UI 触发来源）。
- 2026-01-26：Plan 详情新增 conversation_session_id，用于关联会话历史。
- 2026-01-27：新增节点详情接口与指令热修改字段。
- 2026-01-27：新增节点重跑接口与预约指令合并逻辑。
