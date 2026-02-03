# Design: OpenSandbox Service Architecture

## 1. Decision: Service + Plugin (Layered Architecture)

We **must** implement this as a **Core Service + Agent Plugin** pair. Implementing it *only* as a Plugin is not feasible for a high-quality "Code Interpreter" experience.

### Why? (The "State" & "Speed" Problem)

1.  **Variable Persistence (State)**
    *   *Scenario*:
        *   Turn 1: User says "Load this CSV as `df`".
        *   Turn 2: User says "Now plot `df`".
    *   *Plugin-Only*: The function finishes after Turn 1. If we don't have a persistent service holding the container handle, the container dies (or we lose the reference). In Turn 2, we'd start a fresh container, and `df` would be gone.
    *   *Service*: The Service holds the `Sandbox` instance in memory (mapped to `session_id`). The container stays "warm" and keeps its memory state.

2.  **Performance (Cold Starts)**
    *   *Plugin-Only*: Starting a Docker container takes 1-3 seconds. Doing this for *every* code snippet is a bad user experience.
    *   *Service*: The container starts once. Subsequent commands are millisecond-level API calls to the running container.

3.  **Centralized Management**:
    *   The Service handles "Garbage Collection" (killing containers that have been idle for 30 mins) globally, ensuring we don't leak server resources.

## 2. Architecture Breakdown

### Layer 1: The Core Service (Infrastructure)
**Location**: `backend/app/core/sandbox/`

This is the "Engine Room". It doesn't know about LLMs. It only knows about managing secure environments.

*   **`SandboxManager` (Singleton)**:
    *   **Map**: `Dict[session_id, SandboxInstance]`
    *   **Method** `get_sandbox(session_id)`: Returns existing or spawns new.
    *   **Method** `cleanup_expired()`: Background task to kill old containers.
*   **Responsibilities**:
    *   Docker/K8s connection.
    *   Mounting volumes (for file uploads).
    *   Enforcing resource limits (CPU/RAM).

### Layer 2: The Agent Plugin (Interface)
**Location**: `backend/app/agent_plugins/builtins/code_interpreter/`

This is the "Driver". It knows how to talk to the LLM.

*   **`CodeInterpreterPlugin`**:
    *   **Input**: Receives code from LLM.
    *   **Logic**:
        1.  Calls `SandboxManager.get_sandbox(current_session_id)`.
        2.  Calls `sandbox.exec(code)`.
        3.  **Post-Processing**: Truncates 10MB logs to 2KB; Formats images as Markdown links.
    *   **Output**: Returns clean text to LLM.

## 3. Directory Structure

```text
backend/app/
├── core/
│   └── sandbox/           <-- THE SERVICE
│       ├── __init__.py
│       ├── manager.py     # Global Instance Manager
│       └── instance.py    # Wrapper around OpenSandbox SDK
│
└── agent_plugins/
    └── builtins/
        └── code_interpreter/  <-- THE PLUGIN
            ├── __init__.py
            └── tools.py       # Defines the 'run_code' tool
```
