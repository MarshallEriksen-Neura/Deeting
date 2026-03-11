# Deeting Plugin Development Kit (PDK)

Welcome to the Deeting OS ecosystem. This monorepo provides the starter packages you need to build, test, and publish plugins that extend Deeting.

## 🚀 Quick Start in 3 Steps

### 1. Scaffold your project
Run the following command in your terminal to create a new plugin project:

```bash
bunx create-deeting-plugin
```

Follow the prompts to name your plugin. This creates a standard structure:

- `SKILL.md`: Primary AI-facing entry point. Describe the tool surface, usage rules, and guardrails here first.
- `deeting.json`: Metadata, runtime, permissions, and UI/backend entrypoints.
- `main.py`: Backend logic that implements `async def invoke`.
- `ui/`: Optional frontend interface.
- `llm-tool.yaml`: Optional host tool contract for environments that still expect an explicit schema.

### 2. Implement the logic
Your `main.py` should export an `async def invoke` function:

```python
async def invoke(tool_name, args, deeting):
    deeting.log("Doing something cool...")
    return {"result": "Done!"}
```

Update `SKILL.md` first when you rename tools or change behavior. Keep `llm-tool.yaml` in sync only when you need it.

### 3. Publish to Market
Copy your GitHub URL and paste it into **Deeting Dashboard > Developer Lab**. Click **Publish** to sync your plugin.

---

## 📦 Skill-First Packaging

- Start with `SKILL.md`. This is the main contract an AI agent should read.
- Keep `deeting.json` focused on metadata, runtime, permissions, packaging, and UI support.
- Keep `main.py` aligned with the tool names and behavior described in `SKILL.md`.
- Use `llm-tool.yaml` when a host integration still requires a structured tool schema or when you need legacy compatibility.
- If your plugin renders UI, keep `entry.ui` in `deeting.json` and `ui/index.html` in place.

---

## 🛠 Deeting SDK Reference

When running in the OpenSandbox, a `deeting` object is automatically injected.

| Method | Description | Example |
| :--- | :--- | :--- |
| `deeting.log(*args)` | Prints a log to the chat debug panel. | `deeting.log("User input:", args)` |
| `deeting.render(type, data)` | Renders a UI block in the chat stream. | `deeting.render("table.v1", rows)` |
| `deeting.call_tool(name, **kwargs)` | Calls another system tool or plugin. | `deeting.call_tool("google_search", q="...")` |
| `deeting.section(title)` | Groups the following logs under a header. | `deeting.section("Analyzing Data")` |

---

## 🎨 UI Rendering Lifecycle

Deeting uses a secure, sandboxed `<iframe>` to render plugin UIs. To ensure data is injected correctly, your `ui/index.html` must follow this handshake protocol:

### 1. The handshake protocol
1. **Iframe load**: Deeting renders your iframe pointing to the signed URL.
2. **Ready signal**: Your UI sends a `DEETING_PLUGIN_READY` message to the parent window once it is fully loaded.
3. **Data injection**: Deeting responds with a `DEETING_PLUGIN_DATA` message containing the `payload` returned by your `main.py`.
4. **Theme sync**: Deeting may send `DEETING_THEME_CHANGE` whenever the user switches between light and dark mode.

### 2. Frontend implementation example
Add this script to your `ui/index.html`:

```javascript
window.addEventListener('message', (event) => {
    const { type, payload } = event.data;

    if (type === 'DEETING_PLUGIN_DATA') {
        console.log("Received data from skill:", payload);
        renderMyApp(payload);
    }

    if (type === 'DEETING_THEME_CHANGE') {
        document.documentElement.className = payload;
    }
});

window.parent.postMessage({ type: 'DEETING_PLUGIN_READY' }, '*');
```

---

## 🛡 Security & Permissions

Plugins run in a strictly isolated Docker sandbox. Request any required permissions in `deeting.json`:

- `network.outbound`: Required for external API calls.
- `filesystem.read/write`: Required for processing files.

---

## 🤖 Developing with AI Assistance

You can use AI tools to help you build plugins faster. If you do, give them the packaging rules below:

> I am developing a plugin for Deeting OS. Please act as an expert developer.
>
> Architecture rules:
> 1. `SKILL.md` is the primary AI-facing entry point.
> 2. `deeting.json` stores metadata, runtime, permissions, and UI/backend entrypoints.
> 3. `main.py` must implement `async def invoke(tool_name, args, deeting)`.
> 4. `llm-tool.yaml` is optional and should stay aligned with `SKILL.md` when present.
> 5. `ui/index.html` is optional and should listen for `DEETING_PLUGIN_DATA` if the plugin renders UI.
>
> SDK capabilities:
> - `deeting.log(msg)`: Debugging.
> - `deeting.render(view_type, payload)`: Send UI data to the frontend.
> - `deeting.call_tool(name, **kwargs)`: Call other system tools.
>
> Task: [Describe your plugin idea here.]

---

## 🧪 Smoke Testing (CI)

We recommend adding the workflow at `packages/templates/default-plugin/.github/workflows/plugin-check.yml` to your repository. It validates `deeting.json` and basic plugin syntax on every push.
