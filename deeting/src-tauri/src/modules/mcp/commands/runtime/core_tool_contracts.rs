use serde_json::{json, Value};

#[derive(Clone)]
pub(crate) struct CoreToolContract {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub output_schema: Value,
    pub permission_scope: &'static [&'static str],
    pub read_only: bool,
    pub mutating: bool,
    pub risk_level: &'static str,
    pub example_arguments: Value,
}

impl CoreToolContract {
    pub(crate) fn as_function_tool(&self) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            }
        })
    }

    pub(crate) fn as_catalog_asset(&self) -> Value {
        json!({
            "id": format!("core.{}", self.name),
            "name": self.name,
            "description": self.description,
            "asset_type": "tool",
            "source_type": "code_mode_core",
            "pkg_name": "code_mode.core",
            "metadata": self.contract_metadata(),
        })
    }

    fn contract_metadata(&self) -> Value {
        json!({
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "permission_scope": self.permission_scope,
            "read_only": self.read_only,
            "mutating": self.mutating,
            "risk_level": self.risk_level,
            "example_arguments": self.example_arguments,
        })
    }
}

pub(crate) fn build_core_tool_function_entries() -> Vec<Value> {
    code_mode_core_tools()
        .into_iter()
        .map(|tool| tool.as_function_tool())
        .collect()
}

pub(crate) fn build_core_tool_assets() -> Vec<Value> {
    code_mode_core_tools()
        .into_iter()
        .map(|tool| tool.as_catalog_asset())
        .collect()
}

pub(crate) fn code_mode_core_tools() -> Vec<CoreToolContract> {
    vec![
        CoreToolContract {
            name: "search_sdk",
            description: "Search desktop capability control-plane objects by intent and return semantic groups for direct capabilities, grouped capability namespaces, recipes, and orchestration primitives. Direct capabilities include skill tool bindings and user MCP tools. Recipes are guidance-oriented skill or assistant bundles and are not directly callable tools. execute_code_plan is only for multi-step orchestration.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural language intent to search tools." },
                    "limit": { "type": "integer", "description": "Max capability results to return (1-20).", "default": 8 }
                },
                "required": ["query"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "format_version": {"type": "string"},
                    "mode": {"type": "string"},
                    "query": {"type": "string"},
                    "normalized_query": {"type": "object"},
                    "count": {"type": "integer"},
                    "capabilities": {"type": "array"},
                    "recipes": {"type": "array"},
                    "orchestration_primitives": {"type": "array"},
                    "usage_hint": {"type": "string"}
                },
                "required": ["format_version", "mode", "query", "count", "capabilities", "recipes", "orchestration_primitives"]
            }),
            permission_scope: &["local_catalog_read", "capability_discovery"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"query": "search web tools", "limit": 8}),
        },
        CoreToolContract {
            name: "execute_code_plan",
            description: "Execute a Python code plan in sandbox. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are only for direct callable host tools, including skill tool bindings and user MCP tools surfaced by search_sdk. Use `from deeting_sdk import <tool_name>` only for direct tools, or call `deeting.call_tool('tool-name', query='...')` with keyword args. Generate one coherent script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "Python code to execute." },
                    "session_id": { "type": "string", "description": "Optional explicit session ID." },
                    "language": { "type": "string", "description": "Execution language. Only python is supported.", "default": "python" },
                    "execution_timeout": { "type": "integer", "description": "Execution timeout hint in seconds.", "default": 30 },
                    "dry_run": { "type": "boolean", "description": "Only validate code and return plan metadata without executing.", "default": false }
                },
                "required": ["code"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "execution_id": {"type": "string"},
                    "runtime_mode": {"type": "string"},
                    "render_blocks": {"type": "array"},
                    "allowed_tools": {"type": "array"},
                    "capability_snapshot": {"type": "object"}
                }
            }),
            permission_scope: &["sandbox_execution", "tool_bridge", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "code": "from deeting_sdk import search_sdk\nresult = search_sdk(query='search web tools')\ndeeting.log(json.dumps(result, ensure_ascii=False))",
                "language": "python",
                "dry_run": false
            }),
        },
        CoreToolContract {
            name: "sys_submit_onboarding_request",
            description: "Create or install local desktop capabilities. Use `asset_type='skill'` with payload such as `{repo_url, skill_name}` to install a skill, or `asset_type='assistant'` to create a local assistant.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "asset_type": { "type": "string", "enum": ["assistant", "skill"], "description": "Kind of asset to provision locally." },
                    "payload": { "type": "object", "description": "Structured onboarding payload for the selected asset type." }
                },
                "required": ["asset_type", "payload"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string"},
                    "id": {"type": "string"},
                    "status": {"type": "string"},
                    "result": {"type": "object"}
                }
            }),
            permission_scope: &["skill_install", "assistant_management", "local_state_write"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "asset_type": "skill",
                "payload": {
                    "repo_url": "https://github.com/example/weather-skill",
                    "skill_name": "weather"
                }
            }),
        },
        CoreToolContract {
            name: "refresh_skill_index",
            description: "Rescan local skill directories and rebuild the desktop skill registry after external installs, manual file changes, or shared-skill updates.",
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "registered": {"type": "integer"}
                },
                "required": ["status", "registered"]
            }),
            permission_scope: &["skill_registry_write", "local_catalog_refresh"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({}),
        },
        CoreToolContract {
            name: "shell_execute",
            description: "Execute shell commands on the user's machine with security checks and user approval. Supports cross-platform command execution (Windows: cmd, Linux/Mac: sh). Automatically handles encoding (UTF-8/GBK) and provides timeout control.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to execute (e.g., 'npm install', 'git status')"
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional arguments for the command"
                    },
                    "working_dir": {
                        "type": "string",
                        "description": "Working directory for command execution. Must be within allowed paths (user directories)."
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Execution timeout in seconds",
                        "default": 300,
                        "minimum": 5,
                        "maximum": 1800
                    },
                    "env": {
                        "type": "object",
                        "additionalProperties": { "type": "string" },
                        "description": "Environment variables for the command"
                    }
                },
                "required": ["command"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "stdout": {"type": "string"},
                    "stderr": {"type": "string"},
                    "exit_code": {"type": "integer"},
                    "command": {"type": "string"},
                    "working_dir": {"type": "string"},
                    "duration_ms": {"type": "integer"},
                    "approval_level": {"type": "string"}
                },
                "required": ["stdout", "stderr", "exit_code", "command", "duration_ms", "approval_level"]
            }),
            permission_scope: &["shell_execution", "host_access"],
            read_only: false,
            mutating: true,
            risk_level: "MEDIUM",
            example_arguments: json!({
                "command": "git status",
                "working_dir": "/home/user/project"
            }),
        },
    ]
}

fn core_tool_execution_surface(tool_name: &str) -> &'static str {
    match tool_name {
        "execute_code_plan" => "sandbox",
        "shell_execute" => "host",
        _ => "host",
    }
}

fn core_tool_risk_runtime_state(tool_name: &str) -> &'static str {
    let _ = tool_name;
    "ready"
}

pub(crate) fn build_core_tool_registry_entries(
    generation: i64,
) -> Vec<crate::modules::mcp::store::LocalCapabilityRegistryUpsert> {
    code_mode_core_tools()
        .into_iter()
        .map(
            |tool| crate::modules::mcp::store::LocalCapabilityRegistryUpsert {
                capability_id: format!("core.{}", tool.name),
                source_kind: "core".to_string(),
                asset_kind: "core_tool".to_string(),
                package_id: "code_mode.core".to_string(),
                package_version: Some("1".to_string()),
                title: tool.name.to_string(),
                description: tool.description.to_string(),
                tool_name: Some(tool.name.to_string()),
                callable_name: None,
                binding_kind: None,
                execution_surface: core_tool_execution_surface(tool.name).to_string(),
                runtime: Some(core_tool_execution_surface(tool.name).to_string()),
                entry_path: None,
                is_direct_callable: true,
                activation_state: "enabled".to_string(),
                runtime_state: core_tool_risk_runtime_state(tool.name).to_string(),
                search_index_state: "not_required".to_string(),
                generation,
                descriptor_json: json!({
                    "capability_id": format!("core.{}", tool.name),
                    "tool_name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                    "output_schema": tool.output_schema,
                    "permission_scope": tool.permission_scope,
                    "read_only": tool.read_only,
                    "mutating": tool.mutating,
                    "risk_level": tool.risk_level,
                    "example_arguments": tool.example_arguments,
                    "activation_state": "enabled",
                    "runtime_state": core_tool_risk_runtime_state(tool.name),
                    "search_index_state": "not_required",
                    "execution_surface": core_tool_execution_surface(tool.name),
                })
                .to_string(),
            },
        )
        .collect()
}

pub(crate) async fn sync_core_tool_registry_entries(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<i64, String> {
    let generation = store
        .next_local_capability_registry_generation()
        .await
        .map_err(|err| err.to_string())?;
    let entries = build_core_tool_registry_entries(generation);
    store
        .replace_local_capability_registry_entries("code_mode.core", &entries)
        .await
        .map_err(|err| err.to_string())
}
