# Deeting Semantic Kernel Architecture (v2.0)

> "The operating system for the semantic age."

## 1. Executive Summary

This document defines the architecture for **Deeting OS Kernel**, a semantic dispatcher that decouples "Persona" (User Interface) from "Skills" (Capabilities) and "Sandboxes" (Execution).

The core philosophy is **"Unified Semantics, Modular Physics"**.
*   **Storage**: Assistants and Skills are pooled together as "Resources" in a unified vector space for global semantic retrieval.
*   **Execution**: They follow distinct lifecycles—Assistants modify the Context (System Prompt), while Skills attach to the Sandbox (Tools).

## 2. Core Concept: Resource Pooling

We abandon the distinction between "searching for an assistant" and "searching for a tool". The Kernel sees only **Resources**.

### 2.1 The Unified Resource Model
Every capability in the system is indexed into Qdrant with a standardized schema.

```json
{
  "id": "resource-uuid",
  "type": "SKILL | ASSISTANT",
  "name": "Docx Redactor",
  "description": "Removes sensitive info from Word documents.",
  "vector_embedding": [0.12, ...], // Derived from name + description + capabilities
  "payload": {
    // For SKILL:
    "runtime": "opensandbox",
    "image": "deeting/docx-utils:latest",
    "mcp_schema": { ... }

    // For ASSISTANT:
    "persona_config": { "system_prompt": "..." }
  }
}
```

### 2.2 The "All-Knowing" View
When a user intent arrives, the Kernel queries the Unified Resource Pool.
*   **Query**: "Help me anonymize this contract."
*   **Result (Mixed)**:
    1.  `SKILL: docx_redactor` (Score: 0.95)
    2.  `ASSISTANT: Legal_Expert` (Score: 0.88)
    3.  `ASSISTANT: General_Writer` (Score: 0.40)

The Kernel now has the full context to make a **Decision**.

---

## 3. The Kernel Dispatch Loop

The Kernel acts as a "JIT Compiler" for the User Session.

### Phase 1: Semantic Interception & Retrieval
*   **Input**: User message + File uploads.
*   **Action**: Vector Search in `resource_pool`.
*   **Decision Logic (The "Mixer")**:
    *   If `Top(SKILL)` score is high -> **Load Tool**.
    *   If `Top(ASSISTANT)` score is high -> **Switch/Merge Persona**.
    *   *Result*: A dynamically assembled "Session Context" containing both the Legal Persona AND the Docx Tool.

### Phase 2: Spec Generation (The "Proposal")
Before execution, the Kernel compiles a **Spec** (Execution Plan) for the user.

```json
{
  "type": "proposal",
  "intent": "Document Anonymization",
  "assembled_context": {
    "persona": "Legal Expert", // Selected from Assistant
    "tools": ["docx_redactor"] // Selected from Skill
  },
  "steps": [
    {"action": "read", "target": "contract.docx"},
    {"action": "redact", "params": {"entities": ["names", "dates"]}}
  ],
  "sandbox_req": {
    "image": "deeting/docx-utils:latest",
    "mounts": ["/user/data/contract.docx"]
  }
}
```

### Phase 3: The Permission Gateway
*   **UI**: Presents the Plan Card.
*   **User**: "Approve".
*   **Kernel**: Only NOW does the system instantiate the Sandbox and grant file permissions.

---

## 4. Execution Architecture: Physical Separation

Although retrieved together, resources execute in different "Physics".

### Layer 1: Persona Layer (Context)
*   **Target**: LLM Context Window.
*   **Action**: Injects the `system_prompt` from the chosen Assistant Resource.
*   **Effect**: Changes *how* the AI speaks and thinks.

### Layer 2: Execution Sandbox (Runtime)
*   **Target**: OpenSandbox Container.
*   **Action**:
    1.  Spins up the Docker container defined in the Skill Resource (`payload.image`).
    2.  Injects the Python/Bash scripts.
    3.  Exposes the `mcp_schema` to the LLM as a Function Call.
*   **Effect**: Gives the AI *hands* to do the work.

---

## 5. Security & Isolation

### 5.1 Skill Caching (Hot/Cold)
*   **Common Skills** (Search, File IO): Pre-loaded in a "Base Kernel" container. Always available.
*   **Rare Skills** (Video Rendering, specialized Parsers): JIT-loaded.
    *   *Process*: Kernel pulls Docker Image -> Starts Container -> Executes Task -> Pauses/Destroys Container.

### 5.2 Permission Scope
*   Resources declare required permissions in their metadata (e.g., `internet: true`, `fs: read_only`).
*   The **Spec** clearly highlights these risks.
*   The Sandbox is initialized with **Strict Limits** (Network deny-by-default, RO mounts) unless the Spec overrides them.

---

## 6. Migration Path: The "Resource" Refactoring

To achieve this, we need to refactor our data models.

1.  **Unified Storage**: Migrate `Assistant` and `Plugin` tables to sync with a `ResourceIndex` in Qdrant.
2.  **Manifest Standardization**: Ensure every Plugin has a clean `mcp_schema` and `runtime` definition (as per `kimai.json` spec).
3.  **Kernel Service**: Implement the `search -> assemble -> spec` logic.

This architecture ensures Deeting OS is not just a chatbot, but a **Semantic Computer** that dynamically configures itself to solve the user's problem.