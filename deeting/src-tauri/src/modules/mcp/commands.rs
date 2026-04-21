pub(crate) mod support;

#[path = "commands_parts/common.rs"]
pub(crate) mod common_impl;
#[path = "commands_parts/source_registry.rs"]
pub(crate) mod source_registry_impl;
#[path = "commands_parts/tool_approval.rs"]
pub(crate) mod tool_approval_impl;
#[path = "commands_parts/tool_management.rs"]
pub(crate) mod tool_management_impl;

pub mod runtime;

pub use source_registry_impl::{create_mcp_source, list_mcp_sources, sync_mcp_source};
pub use tool_approval_impl::{
    approve_mcp_tool, clear_tool_approval_rules, delete_tool_approval_rule,
    get_tool_approval_learning_summary, list_pending_mcp_approvals, list_tool_approval_rules,
    recover_local_chat_execution, reject_mcp_tool, reset_tool_approval_learning,
};
pub use tool_management_impl::{
    apply_pending_config, clear_mcp_logs, delete_local_mcp_tool, execute_mcp_tool_raw,
    get_mcp_logs, import_mcp_config, list_mcp_tools, reindex_mcp_tool, resolve_mcp_conflict,
    start_mcp_tool, stop_mcp_tool, update_mcp_tool_env,
};

#[cfg(test)]
include!("commands_parts/tests.rs");
