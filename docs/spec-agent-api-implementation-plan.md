# Spec Agent API Implementation Plan

## 1. Objective
To implement the RESTful API layer for the "Spec Agent" system, bridging the existing React Frontend (`deeting/app/[locale]/spec-agent`) with the Python Backend (`app.services.spec_agent_service`).

## 2. API Design (Draft)

Base URL: `/api/v1/spec-agent`

### 2.1. Draft & Create Plan (SSE)
**Endpoint**: `POST /draft`
*   **Description**: Analyzes user intent and generates a Spec DAG (Blueprinting). Default returns SSE for node-by-node rendering.
*   **Query**:
    - `stream` (bool, default `true`): `true` → SSE events; `false` → JSON response.
*   **Request**:
    ```json
    {
      "query": "Help me buy a laptop under $1000",
      "context": { "user_id": "..." }
    }
    ```
*   **SSE Events**:
    - `drafting`: 模型开始规划
    - `plan_init`: 返回 plan_id 与 project_name
    - `node_added`: 节点逐个生长
    - `link_added`: 依赖连线
    - `plan_ready`: 规划完成
    - `plan_error`: 规划失败
*   **SSE Example**:
    ```
    event: plan_init
    data: {"plan_id":"uuid","project_name":"Laptop_Purchase_2026"}

    event: node_added
    data: {"node": {"id":"T1","type":"action", ...}}

    event: link_added
    data: {"source":"T1","target":"G1"}

    event: plan_ready
    data: {"plan_id":"uuid"}
    ```
*   **Non-Stream Response** (`stream=false`):
    ```json
    {
      "plan_id": "uuid",
      "manifest": { ...SpecManifest JSON... }
    }
    ```

### 2.2. Get Plan Details (Workspace Init)
**Endpoint**: `GET /plans/{plan_id}`
*   **Description**: Retrieves static structure (manifest + connections) and current execution metadata.
*   **Response**:
    ```json
    {
      "id": "uuid",
      "project_name": "Laptop_Purchase",
      "manifest": { ...SpecManifest JSON... },
      "connections": [
        { "source": "T1", "target": "G1" }
      ],
      "execution": {
        "status": "drafting|running|waiting|completed|error",
        "progress": 0
      }
    }
    ```

### 2.3. Get Real-time Status (Polling)
**Endpoint**: `GET /plans/{plan_id}/status`
*   **Description**: Polling endpoint for Canvas UI. Aggregates logs into node statuses.
*   **Response**:
    ```json
    {
      "execution": { "status": "running", "progress": 45 },
      "nodes": [
        {
          "id": "T1",
          "status": "completed",
          "duration_ms": 2500,
          "output_preview": "..."
        },
        {
          "id": "G1",
          "status": "active",
          "pulse": "waiting_approval"
        }
      ],
      "checkpoint": { "node_id": "G1" }
    }
    ```

### 2.4. Control Execution
**Endpoint**: `POST /plans/{plan_id}/start`
*   **Description**: Starts execution (in-request stepping, until waiting/completed/failed or step limit).
*   **Response**:
    ```json
    { "status": "running|waiting_approval|completed|failed|stalled", "executed": 2 }
    ```

**Endpoint**: `POST /plans/{plan_id}/interact`
*   **Description**: Handles "Human-in-the-loop" decisions (Check-ins).
*   **Request**:
    ```json
    {
      "node_id": "G1",
      "decision": "approve", // or "reject", "modify"
      "feedback": "Proceed with Option B"
    }
    ```
*   **Response**:
    ```json
    { "plan_id": "uuid", "node_id": "G1", "decision": "approve" }
    ```

## 3. Data Mapping Strategy

### 3.1. Status Mapping
| Backend (Log Status) | Frontend (NodeStatus) | Visual Effect |
| :--- | :--- | :--- |
| `None` (No log) | `pending` | Gray / Dashed border |
| `RUNNING` | `active` | Blue Pulse |
| `SUCCESS` | `completed` | Green Check |
| `FAILED` | `error` | Red Alert |
| `WAITING_APPROVAL` | `waiting` | Yellow/Orange Pulse |
| `SKIPPED` | `completed` | Grayed out (dimmed) |

## 4. Service Layer Modifications
The `SpecAgentService` needs minor extensions to support these APIs:
1.  **`generate_plan(query, context)`**: 调用 `SPEC_PLANNER_SYSTEM_PROMPT` 并生成/校验 SpecManifest，落库为 SpecPlan。
2.  **`get_plan_detail(plan_id)`**: 返回 manifest + connections + execution。
3.  **`get_plan_status(plan_id)`**: 聚合节点执行日志为 Canvas 状态。
4.  **`start_plan(plan_id)`**: 在请求内推进若干步（直到等待/完成/失败）。
5.  **`interact_with_plan(plan_id, node_id, decision)`**: 处理审批决策，更新日志与计划状态。

## 5. Next Steps
1.  完成 Spec Agent API 路由与 SSE Draft 事件。
2.  补充 `docs/api/spec-agent.md` 对外文档。
3.  编写 API 单测（draft/status/start/interact）。
