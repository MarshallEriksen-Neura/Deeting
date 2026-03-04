# Design: Production-Grade OpenSandbox Architecture

## 1. Executive Summary

To move from a "Demo" to a "Production" architecture, we must address **Scalability** (10k+ sessions), **Security** (Multi-tenant isolation), and **Reliability** (Distributed State).

This design introduces a **Stateless Backend + Redis State + Kubernetes Runtime** architecture.

## 2. High-Level Architecture

```mermaid
graph TD
    subgraph "Control Plane (Stateless)"
        API1[Backend API Replica 1]
        API2[Backend API Replica 2]
        
        Manager[Sandbox Manager Service]
    end

    subgraph "State Layer (Persistence)"
        Redis[(Redis Cluster)]
    end

    subgraph "Compute Plane (Kubernetes)"
        K8sAPI[K8s API Server]
        
        subgraph "Sandbox Nodes (gVisor/Kata)"
            Pod1[Sandbox Pod A (User 1)]
            Pod2[Sandbox Pod B (User 2)]
        end
    end

    API1 -- "1. Get/Lock Session" --> Redis
    API1 -- "2. Ensure Pod" --> K8sAPI
    K8sAPI -- "3. Schedule" --> Pod1
    API1 -- "4. Execute (HTTP)" --> Pod1
```

## 3. Key Architectural Decisions

### 3.1 Distributed State Management (Redis)
In production, you will have multiple Backend API replicas. We cannot store the `SessionID -> ContainerID` mapping in Python memory.

*   **Store**: Redis.
*   **Key**: `sandbox:instance:{session_id}`
*   **Schema**:
    ```json
    {
      "backend": "kubernetes",
      "id": "sandbox-pod-uuid-12345",
      "ip": "10.244.2.15",
      "port": 8000,
      "state": "running",
      "created_at": "2026-02-02T10:00:00Z",
      "last_accessed": "2026-02-02T10:05:00Z"
    }
    ```
*   **TTL**: Set to 30 minutes. Refreshed on every interaction. If Redis key expires, the "Reaper" cleans up the Pod.

### 3.2 The "Driver" Pattern (Polymorphism)
The `SandboxManager` should rely on an abstract driver interface, allowing seamless switching between Local Dev and Prod.

```python
class SandboxDriver(ABC):
    async def create(self, session_id: str) -> SandboxInfo: ...
    async def get_url(self, sandbox_id: str) -> str: ...
    async def destroy(self, sandbox_id: str): ...

# Implementations
class DockerDriver(SandboxDriver): ... # For Local Dev
class KubernetesDriver(SandboxDriver): ... # For Production
```

### 3.3 Security Hardening (The "gVisor" Requirement)
Standard Docker containers (`runc`) share the Host Kernel. A malicious script could exploit a Kernel vulnerability to escape the sandbox.

*   **Requirement**: Use **gVisor** (Google) or **Kata Containers**.
*   **K8s Configuration**:
    ```yaml
    apiVersion: v1
    kind: Pod
    spec:
      runtimeClassName: gvisor  # <--- CRITICAL
      containers:
        - name: sandbox
          image: opensandbox/code-interpreter:v1.0.1
          resources:
            limits:
              cpu: "1"
              memory: "512Mi"
    ```
*   **Network Policy**: Deny all Egress except `DNS` and `PyPI` (if allowed).

### 3.4 The "Reaper" (Garbage Collection)
A background process (Celery Beat or a Leader-Elected Goroutine) must periodically sync Redis with K8s.

1.  **Scan**: List all Sandbox Pods in K8s namespace.
2.  **Check**: Does this Pod ID exist in Redis?
3.  **Action**:
    *   If **No** (Key expired): Delete the Pod immediately.
    *   If **Yes**: Do nothing.

## 4. Implementation Stages

### Stage 1: The Abstraction (Now)
*   Implement `SandboxManager` with the `SandboxDriver` interface.
*   Implement `RedisStateStore`.
*   Implement `DockerDriver` (using `opensandbox` SDK).

### Stage 2: The Production Driver (Later)
*   Implement `KubernetesDriver` (using `kubernetes-asyncio` or `opensandbox` K8s support).
*   Configure `gVisor` on the cluster.

## 5. Failure Recovery
*   **Pod Crash**: The Manager detects connection failure -> Invalidates Redis Key -> Spawns new Pod transparently.
*   **Backend Crash**: Since state is in Redis, any other Backend Replica can take over the session immediately.
