# Spec Agent API Implementation Plan

## 1. Objective
To implement the RESTful API layer for the "Spec Agent" system, bridging the existing React Frontend (`deeting/app/[locale]/spec-agent`) with the Python Backend (`app.services.spec_agent_service`).

## 2. API Design (Draft)

Base URL: `/api/v1/spec-agent`

### 2.1. Draft & Create Plan
**Endpoint**: `POST /draft`
*   **Description**: Analyzes user intent and generates a Spec DAG (Blueprinting).
*   **Request**:
    ```json
    {
      "query": "Help me buy a laptop under $1000",
      "context": { "user_id": "..." }
    }
    ```
*   **Response**:
    ```json
    {
      "plan_id": "uuid",
      "manifest": { ...SpecManifest JSON... }
    }
    ```

### 2.2. Get Plan Details (Workspace Init)
**Endpoint**: `GET /plans/{plan_id}`
*   **Description**: Retrieves the static structure (Nodes/Connections) and current execution metadata.
*   **Response**:
    ```json
    {
      "id": "uuid",
      "project_name": "Laptop_Purchase",
      "dag": {
        "nodes": [ ... ],
        "connections": [ ... ]
      },
      "execution": {
        "status": "drafting|running|paused|completed|failed",
        "start_time": "ISO8601"
      }
    }
    ```

### 2.3. Get Real-time Status (Polling)
**Endpoint**: `GET /plans/{plan_id}/status`
*   **Description**: High-frequency polling endpoint for the Canvas UI. Aggregates logs into node statuses.
*   **Response**: Matches frontend `SpecAgentStatus` interface.
    ```json
    {
      "execution": { "status": "running", "progress": 45 },
      "nodes": [
        {
          "id": "T1",
          "status": "completed", // mapped from Backend SUCCESS
          "duration": "2.5s",
          "output_preview": "..."
        },
        {
          "id": "G1",
          "status": "active",    // mapped from Backend RUNNING
          "pulse": "Thinking..." // generated from latest log
        }
      ],
      "checkpoint": null // Present if status is WAITING_APPROVAL
    }
    ```

### 2.4. Control Execution
**Endpoint**: `POST /plans/{plan_id}/start`
*   **Description**: Commits the draft and triggers the Celery worker.

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
1.  **`generate_plan(query: str)`**: Needs to call the `SPEC_PLANNER_SYSTEM_PROMPT` logic (currently in test scripts).
2.  **`get_plan_status(plan_id)`**: A fast aggregator query to build the polling response without fetching heavy payloads.

## 5. Next Steps
1.  Implement `app/api/v1/spec_agent_route.py`.
2.  Register router in `app/api/api.py`.
3.  Verify integration with `test_spec_agent_flow.py` logic.
