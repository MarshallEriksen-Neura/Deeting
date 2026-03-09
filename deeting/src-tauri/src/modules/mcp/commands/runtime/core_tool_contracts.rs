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
            description: "Search desktop Code Mode capabilities by intent and return grouped results: callable_now, installable, and advisory. Use before execute_code_plan to decide what can run immediately versus what must be installed or enabled.",
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
                    "callable_now": {"type": "array"},
                    "installable": {"type": "array"},
                    "advisory": {"type": "array"},
                    "usage_hint": {"type": "string"}
                },
                "required": ["format_version", "mode", "query", "count", "callable_now", "installable", "advisory"]
            }),
            permission_scope: &["local_catalog_read", "capability_discovery"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"query": "search web tools", "limit": 8}),
        },
        CoreToolContract {
            name: "execute_code_plan",
            description: "Execute a Python code plan in sandbox. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are auto-injected based on your code: use `from deeting_sdk import <tool_name>` directly without calling search_sdk first (search_sdk is optional for discovery). Important: call tools with keyword args (`deeting.call_tool('tool-name', query='...')`), not positional dict args. Generate one coherent script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
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
    ]
}
