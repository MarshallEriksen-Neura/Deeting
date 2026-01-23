# Deeting AI OS Plugin Architecture (v2)

## 1. Core Architecture (Microkernel + Sandbox)

### 1.1 Microkernel (Core)
*   **Responsibilities:** Session management, Message Bus, Permission validation, Plugin Loader.
*   **Philosophy:** "Zero built-in features, everything is a plugin."

### 1.2 Plugin Sandbox
*   **Isolation:** Each plugin runs in an independent Process/Worker Thread.
*   **Communication:** JSON-RPC with Kernel.
*   **Permissions:** Granular scopes (Network, Filesystem, GPU, Shell) granted by user on install.

### 1.3 Message Bus (EventBus)
*   **Pattern:** Topic + Priority.
*   **Events:** `user.message`, `user.image`, `system.tick`.
*   **Logic:** Priority-based handling (First-come, first-handled).

---

## 2. Plugin Lifecycle (npm-style)

| Phase | Hook | Description |
| :--- | :--- | :--- |
| **Install** | `postinstall` | Download -> Verify Signature -> Unzip -> Init Script |
| **Enable** | `activate` | Register routes, Start event listening |
| **Upgrade** | `pre/postupgrade` | Hot-swap without session loss |
| **Disable** | `deactivate` | Remove routes, Stop listeners |
| **Uninstall** | `preuninstall` | Cleanup data/cache |

---

## 3. Technical Implementation

### 3.1 Directory Structure
```text
my-plugin/
├─ package.json   # Standard npm fields
├─ kimai.json     # Plugin Manifest
├─ llm-tool.yaml  # LLM Function Calling Spec
├─ src/
│ ├─ index.js     # Entry (activate/deactivate)
│ └─ handler.js   # Logic
└─ README.md
```

### 3.2 Manifest (`kimai.json`)
```json
{
  "name": "search-bing",
  "version": "1.0.0",
  "permissions": ["network"],
  "trigger": {
    "regex": "^Search(.*)"
  },
  "renderer": "search-cards" 
}
```

---

## 4. Frontend Rendering (The "Iron Triangle")

**Concept:** Plugins provide **Data**; Core provides **Renderers**.

1.  **Plugin:** Pushes data stream via `ctx.push_stream('weather.data', payload)`. Specifies `renderer: "weather-cards"`.
2.  **Core:** Detects renderer request. Loads secure **Iframe** (from CDN/Local). Establishes `postMessage` tunnel.
3.  **Renderer:** Pure HTML/JS/Canvas (e.g., Lightweight Charts). Receives data, updates UI.

**Benefits:**
*   Plugin developers write 0 frontend code.
*   UI is sandboxed (Iframe).
*   Professional-grade visuals (TradingView, Maps, etc.) available out-of-the-box.

---

## 5. LLM Perception (Zero Hallucination)

### 5.1 `llm-tool.yaml`
Standard OpenAI Function Calling definition.
```yaml
name: get_weather
description: Get 7-day forecast
parameters:
  type: object
  required: [city]
  properties: 
    city: {type: string}
```

### 5.2 Dynamic Context
*   Kernel injects available tools into System Prompt.
*   LLM generates JSON `{"name": "get_weather", ...}`.
*   Kernel routes to Plugin `invoke()`.
*   Plugin returns **Structured JSON** (for UI) and **Text Summary** (for LLM).

---

## 6. Distribution System (GitOps + CDN)

### 6.1 Architecture
`Dev Repo (PR)` -> `Official Repo (CI)` -> `Release (Artifact)` -> `CDN` -> `Client`

### 6.2 CI/CD Pipeline (GitHub Actions)
1.  **Lint:** Validate `kimai.json` schema.
2.  **Security:** CodeQL / CVE Scan.
3.  **Smoke Test:** Run plugin in Docker sandbox, verify `invoke` return.
4.  **Publish:** Sign Artifact (GPG) -> Upload Release -> Update `registry.json`.

### 6.3 Registry Structure (`registry.json`)
```json
{
  "plugins": {
    "weather": {
      "version": "1.2.3",
      "hash": "sha256:...",
      "signature": "...",
      "tarball": "https://cdn.../weather-1.2.3.zip"
    }
  }
}
```

### 6.4 Client Sync
*   Downloads `registry.json`.
*   Compares versions.
*   Incremental download (Diffs or Zips).
*   Verifies Signatures.

---

## 7. Key Scripts

### 7.1 CI Lint (`ci/lint.py`)
Validates plugin metadata structure and constraints.

### 7.2 Registry Gen (`gen_registry.py`)
Scans plugin directories, builds distribution artifacts, calculates hashes, and generates the global `registry.json` index.
