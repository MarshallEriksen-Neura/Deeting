# Deeting AI OS: Hybrid Edge-Cloud Engineering Blueprint

## 1. Executive Summary

This blueprint unifies two strategic initiatives: the **Deeting OS Plugin Architecture (v2)** (Local/Edge) and the **Cloud MCP Service** (Cloud).

The goal is to build a **Hybrid AI Operating System** where:
1.  **Local Plugins** provide privacy, device control, and low-latency interaction.
2.  **Cloud MCP** provides infinite computing power, internet access, and public service integration.
3.  **The Gateway** acts as the "Microkernel," aggregating these capabilities into a unified experience for the User and the LLM.

---

## 2. System Topology

```mermaid
graph TD
    subgraph "User Device (Frontend)"
        UI[Deeting UI (Next.js)]
        Sandbox[Renderer Sandbox (Iframes)]
        UI -- "SSE / WebSocket" --> Gateway
        UI -- "Render Events" --> Sandbox
    end

    subgraph "Edge Server / Localhost (Backend)"
        Gateway[AI-Higress-Gateway (Kernel)]
        
        subgraph "Kernel Modules"
            PM[Plugin Manager]
            MCLC[MCP Client (Aggregator)]
            Router[Intent Router]
        end
        
        Gateway -- "Spawns" --> LocalPlug1[Local Plugin: Shell/FS]
        Gateway -- "Spawns" --> LocalPlug2[Local Plugin: Docker]
    end

    subgraph "Cloud Infrastructure"
        CloudMCP[Cloud MCP Service]
        Search[Tavily Search]
        Cluster[Playwright Cluster]
        
        CloudMCP -- "SSE (MCP Protocol)" --> Gateway
        CloudMCP --> Search
        CloudMCP --> Cluster
    end
```

---

## 3. The "Unified Kernel" Design

The **Gateway (Backend)** serves as the Kernel. It abstracts the difference between "Local" and "Cloud" from the LLM.

### 3.1 The Aggregator Pattern
When a session starts, the Kernel aggregates tools:

1.  **Local Discovery**: Scans `plugins/` directory (v2 standard), loads `llm-tool.yaml`.
2.  **Remote Handshake**: Connects to configured Cloud MCP Endpoint via SSE. Requests `tools/list`.
3.  **Fusion**: Merges both lists into a single `system_prompt` context for the LLM.

### 3.2 Routing Logic
When LLM requests a tool call (e.g., `{"name": "search_web"}`):

*   **Kernel Lookup**: Checks the Tool Registry.
*   **Path A (Local)**: If owner is Local Plugin -> Invoke Python function in Sandbox.
*   **Path B (Cloud)**: If owner is Cloud MCP -> Send JSON-RPC request over SSE tunnel -> Await Result.

---

## 4. The "Universal Rendering" Protocol

A key innovation is decoupling **Execution** (Cloud/Local) from **Presentation** (Frontend).

### 4.1 Data Flow
Regardless of where the code runs, the UI update path is identical:

1.  **Source**:
    *   *Cloud Tool*: `yield {"type": "weather-data", "renderer": "weather-card", "payload": {...}}`
    *   *Local Tool*: `ctx.push_stream("weather-data", payload, renderer="weather-card")`
2.  **Transport**:
    *   Cloud MCP sends event via SSE to Gateway.
    *   Gateway normalizes event to `ui_event`.
    *   Gateway pushes `ui_event` to Frontend via Client Stream.
3.  **Display**:
    *   Frontend receives `ui_event`.
    *   Frontend checks `renderer` ID (e.g., `weather-card`).
    *   Frontend loads/refreshes the specific **Iframe Renderer**.
    *   Data is passed to Iframe via `postMessage`.

**Result**: A Cloud Search tool and a Local Log Analyzer can both use the same "Table Renderer" or "Chart Renderer" without code duplication.

---

## 5. Development Roadmap

### Phase 1: The Cloud Foundation (Weeks 1-2)
*   **Objective**: Establish the "Cloud Brain".
*   **Tasks**:
    1.  Create `mcp-cloud-server` (Python/FastAPI).
    2.  Migrate existing `CrawlerPlugin` logic to this server.
    3.  Implement `SearchTool` (Tavily/Google) on this server.
    4.  Expose SSE Endpoint implementing MCP Protocol.

### Phase 2: The Kernel Aggregator (Weeks 3-4)
*   **Objective**: Enable Gateway to "think" globally.
*   **Tasks**:
    1.  Refactor `backend/app/agent_plugins/core/manager.py`.
    2.  Implement `MCPClient` to connect to Phase 1 server.
    3.  Build the "Tool Merging" logic for LLM Context.
    4.  Verify LLM can call Cloud Search via the Gateway.

### Phase 3: The Plugin Framework V2 (Weeks 5-6)
*   **Objective**: Standardize Local Extensions.
*   **Tasks**:
    1.  Implement the `kimai.json` & `llm-tool.yaml` loader in Gateway.
    2.  Create the "Plugin Sandbox" (Process isolation for local scripts).
    3.  Implement the GitOps -> CI -> Registry pipeline (from V2 plan).

### Phase 4: The Universal UI (Weeks 7-8)
*   **Objective**: Visuals for everyone.
*   **Tasks**:
    1.  Develop `Deeting Renderer SDK` (HTML/JS host).
    2.  Create `IframeContainer` component in Next.js.
    3.  Port "Weather" and "Stock" renderers as Proof-of-Concepts.
    4.  Standardize the `Stream -> Gateway -> Frontend` event pipe.

---

## 6. Security Model

*   **Cloud Security**: API Keys for Search/Crawl stored securely in Cloud Env. Gateway authenticates via Token.
*   **Local Security**: Local plugins explicitly request permissions (`fs`, `shell`). User approves on install.
*   **Isolation**: Cloud services have NO access to Local Filesystem. They only return text/data.

---

## 7. Conclusion

This blueprint moves AI-Higress-Gateway from a "Chatbot Backend" to a **Hybrid AI Operating System Kernel**. It leverages the best of both worlds:
*   **Cloud MCP**: Scalability, Maintenance-free Updates, Heavy Lifting.
*   **Local Plugins**: Privacy, Hardware Control, Customization.
*   **Shared UI**: Consistent, high-quality experience across both.
