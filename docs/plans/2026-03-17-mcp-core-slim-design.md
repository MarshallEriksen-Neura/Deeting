# MCP Core Slim Design

**Goal**
Make the MCP module keep only MCP core business + compatibility layer, and move all non-core business logic/types/storage into their respective modules without breaking behavior.

**Scope**
- MCP keeps: core tool/source config & sync, transport/process management, tool execution + approval/risk, MCP gateway + logs, MCP tool directory (tool dimension only), compatibility shims (old command names/type paths/shape adapters).
- MCP removes: admin, assistants, conversations, knowledge/docs, skills registry/scan, system assets, code-mode orchestration, desktop capability aggregation, memory/monitor/provider onboarding, etc. Those live in their own modules.

**Architecture**
- MCP becomes a thin core + compat layer. Compat forwards legacy entrypoints/paths to their target modules; no business logic lives in MCP.
- Each domain module owns its own commands, types, and store tables. Callers should import from the owning module directly.

**Data Flow**
- UI/Invoke -> Module Commands (admin/assistants/conversations/knowledge/skills/etc.)
- MCP core runtime -> tool/source execution, transport, logging
- Compat layer -> legacy command/type/stored-shape adapters to preserve backward compatibility

**Error Handling**
- Avoid behavioral change: migration is path/type rewiring first, logic stays where it belongs.
- Compile errors surface any missing re-exports before runtime.

**Testing**
- Minimum: `cargo check --manifest-path deeting/src-tauri/Cargo.toml --lib`.
- Targeted tests only if specific module flows are touched.

**Guardrails**
- Keep `system_asset` table initialization in MCP until the final cleanup phase, then move it to `admin` last.

**Out of Scope**
- Functional changes or new features.
- Removing compatibility layer.
