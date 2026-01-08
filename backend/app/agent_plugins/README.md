# Agent Plugins

This directory contains the new plugin system for AI Agents, migrated from `backend_old`.

## Structure

- **core/**: Core interfaces and managers (`PluginManager`, `AgentPlugin`, `PluginContext`).
- **builtins/**: Built-in plugins (e.g., Provider Registry, Crawler).
- **examples/**: Example plugins (e.g., `HelloWorldPlugin`).

## Creating a New Plugin

1. Inherit from `app.agent_plugins.core.interfaces.AgentPlugin`.
2. Implement `metadata` and `get_tools` (optional).
3. Implement `async def on_activate(self)` and `async def on_deactivate(self)` if needed.
4. If you expose tools, implement the corresponding handler methods (convention: `handle_<tool_name>`).

## Usage

Plugins are managed by `app.agent_plugins.core.manager.PluginManager`.
