# Design: Skills & OpenSandbox Integration

## 1. Overview
This design documents how to integrate **OpenSandbox** (or a generic Docker-based sandbox) into the Deeting OS backend to empower Skills (Agent Plugins) with secure code execution capabilities.

## 2. Architecture

```mermaid
graph TD
    subgraph "Deeting Backend (Host)"
        Agent[LLM Agent]
        Plugin[Code Interpreter Plugin]
        Manager[Sandbox Manager Service]
    end

    subgraph "Docker Engine (Local/Remote)"
        Container[Sandbox Container]
        Daemon[Execution Daemon (FastAPI/RPC)]
        
        Container -- "Mounts" --> SharedVol[Shared Volume (/mnt/data)]
    end

    Agent -- "1. Call Tool" --> Plugin
    Plugin -- "2. Request Session" --> Manager
    Manager -- "3. Ensure Container" --> Container
    Plugin -- "4. Execute Code (HTTP)" --> Daemon
    Daemon -- "5. Return Result" --> Plugin
```

## 3. Component Design

### 3.1 The Sandbox Manager (`app.core.sandbox`)
A core service responsible for the lifecycle of sandboxes.

*   **Responsibility**: Start, Stop, Restart, and Cleanup containers.
*   **Mapping**: 1 Chat Session = 1 Sandbox Container.
*   **Configuration**:
    *   Image: `deeting/sandbox-python:latest` (Pre-installed with pandas, numpy, etc.)
    *   Limits: CPU: 1.0, Memory: 512MB, Network: None (or Whitelisted).

### 3.2 The Integration Protocol
Communication between the Host (Plugin) and the Sandbox happens over **HTTP** (to a sidecar agent inside the container) or **Docker Exec** (for simple MVPs).

**Recommended: HTTP Sidecar**
The sandbox image runs a lightweight HTTP server on port 8000.

*   `POST /execute`: Run Python/Bash code.
*   `POST /upload`: Upload file to sandbox.
*   `GET /download`: Download artifact.

### 3.3 The Skill Implementation (`app.agent_plugins.builtins.code_interpreter`)
The Skill serves as the "Client" to the Sandbox.

**Tool Definition:**
```yaml
name: run_python
description: Execute Python code.
parameters:
  code: string
```

**Workflow:**
1.  **Init**: `sandbox = SandboxManager.get_instance(session_id)`
2.  **Exec**: `result = await sandbox.run_code(code)`
3.  **Process**:
    *   If `result.images`: Download image -> Upload to Object Storage -> Return URL to LLM.
    *   If `result.stdout`: Return text.

## 4. Implementation Steps

### Phase 1: Infrastructure (The "Hardware")
1.  **Core Module**: Create `backend/app/core/sandbox/`.
2.  **Docker Client**: Implement `DockerSandboxService` using `docker-py`.
    *   Function: `ensure_container(session_id) -> ip_address`
3.  **Base Image**: Create `backend/scout/Dockerfile.sandbox`.
    *   Content: Python 3.10 + FastAPI (Execution Server) + Data Science Libs.

### Phase 2: The Skill (The "Driver")
1.  **Plugin**: Create `backend/app/agent_plugins/builtins/code_interpreter/`.
2.  **Logic**: Implement `plugin.py` to call `DockerSandboxService`.

### Phase 3: Wiring
1.  Update `backend/app/core/config.py` with `SANDBOX_DOCKER_IMAGE` settings.
2.  Register the plugin in `plugins.yaml`.

## 5. Security Considerations
*   **Isolation**: Containers must not have access to Host Network (except specifically allowed).
*   **Volume Mounting**: Only mount a specific sub-folder `backend/media/user/{session_id}` to the container.
*   **Timeouts**: Code execution must hard-timeout after 60s.

## 6. Future: E2B / Cloud Integration
This design uses an abstract `SandboxInterface`. In the future, we can swap `DockerSandboxService` with `E2BCloudService` without changing the Plugin code.
