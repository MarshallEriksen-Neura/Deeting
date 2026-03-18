pub(crate) mod support;

#[path = "commands_parts/cloud_subscriptions.rs"]
pub(crate) mod cloud_subscriptions_impl;
#[path = "commands_parts/common.rs"]
pub(crate) mod common_impl;
#[path = "commands_parts/source_registry.rs"]
pub(crate) mod source_registry_impl;
#[path = "commands_parts/tool_management.rs"]
pub(crate) mod tool_management_impl;
#[path = "commands_parts/tool_approval.rs"]
pub(crate) mod tool_approval_impl;

pub mod runtime;

pub use cloud_subscriptions_impl::sync_cloud_subscriptions_v2;
pub use source_registry_impl::{
    create_mcp_source, list_mcp_sources, sync_mcp_source,
};
pub use tool_management_impl::{
    apply_pending_config, clear_mcp_logs, delete_local_mcp_tool, execute_mcp_tool_raw,
    get_mcp_logs, import_mcp_config, resolve_mcp_conflict, start_mcp_tool, stop_mcp_tool,
    update_mcp_tool_env, list_mcp_tools,
};
pub use tool_approval_impl::{approve_mcp_tool, list_pending_mcp_approvals, reject_mcp_tool};
pub use crate::modules::mcp::compat::commands::sync_cloud_subscriptions;

#[cfg(test)]
include!("commands_parts/tests.rs");
