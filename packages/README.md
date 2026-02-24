# Deeting Plugin Development Kit (PDK)

Welcome to the Deeting OS ecosystem. This monorepo provides everything you need to build, test, and publish plugins that extend the intelligence of Deeting OS.

## 🚀 Quick Start in 3 Steps

### 1. Create your repository
Use the [Template](./templates/default-plugin) to create a new GitHub repository. Ensure your repo contains:
- `deeting.json`: Metadata and permissions.
- `llm-tool.yaml`: Tool definitions for the AI.
- `main.py`: Your backend logic.

### 2. Implement the Logic
Your `main.py` should export an `async def invoke` function:
```python
async def invoke(tool_name, args, deeting):
    deeting.log("Doing something cool...")
    return {"result": "Done!"}
```

### 3. Publish to Market
Copy your GitHub URL and paste it into the **Deeting Dashboard > Developer Lab**. Click "Publish" to sync your plugin instantly.

---

## 🛠 Deeting SDK Reference

When running in the **OpenSandbox**, a `deeting` object is automatically injected.

| Method | Description | Example |
| :--- | :--- | :--- |
| `deeting.log(*args)` | Prints a log to the chat debug panel. | `deeting.log("User input:", args)` |
| `deeting.render(type, data)` | Renders a UI Block in the chat stream. | `deeting.render("table.v1", rows)` |
| `deeting.call_tool(name, **kwargs)` | Calls another system tool or plugin. | `deeting.call_tool("google_search", q="...")` |
| `deeting.section(title)` | Groups the following logs under a header. | `deeting.section("Analyzing Data")` |

---

## 🛡 Security & Permissions
Plugins run in a strictly isolated **Docker Sandbox**. You must request permissions in `deeting.json`:
- `network.outbound`: Required for external API calls.
- `filesystem.read/write`: Required for processing files.

---

## 🤖 Developing with AI Assistance

You can use AI (ChatGPT, Claude, Gemini) to help you build plugins faster. Simply copy and paste the context below into your AI tool to make it understand the Deeting development standards.

### Copy-Paste Context for AI:
> I am developing a plugin for **Deeting OS**. Please act as an expert developer.
> 
> **Architecture Rules:**
> 1. **deeting.json**: Metadata and permissions (network.outbound, etc.).
> 2. **llm-tool.yaml**: Tool definition in OpenAI Function Calling format.
> 3. **main.py**: Must implement `async def invoke(tool_name, args, deeting)`.
> 4. **ui/index.html**: A transparent HTML page that listens for `DEETING_DATA` message.
> 
> **SDK Capabilities:**
> - `deeting.log(msg)`: Debugging.
> - `deeting.render(view_type, payload)`: Send UI data to frontend.
> - `deeting.call_tool(name, **kwargs)`: Call other system tools.
> 
> **Task:** [Describe your plugin idea here, e.g., "Help me write a crypto price tracker with a glassmorphism UI"]

---

## 🧪 Smoke Testing (CI)
We recommend adding the [Deeting Check Workflow](./templates/default-plugin/.github/workflows/plugin-check.yml) to your repository. It will automatically validate your `deeting.json` and syntax on every push.
