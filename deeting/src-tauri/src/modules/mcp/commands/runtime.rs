pub(crate) mod capability_catalog;
pub(crate) mod capability_registry_cache;
pub(crate) mod config;
pub(crate) mod remote_transport;
pub(crate) mod source_sync;
pub(crate) mod tool_execution;
pub(crate) mod tool_resolution;

pub(crate) use capability_catalog::{
    build_capability_assets_for_read_mode, CapabilityRegistryReadMode,
};
pub(crate) use config::{apply_config_payload, now_rfc3339};
pub(crate) use tool_execution::{
    approve_pending_tool_with_context_and_mode, execute_mcp_tool,
    execute_or_queue_mcp_tool_call_with_tool_ref, ApprovePersistMode, RejectPersistMode,
};
pub(crate) use tool_resolution::{
    build_db_tool_availability_catalog, build_desktop_mcp_tool_views,
    fallback_local_tool_availability, resolve_callable_mcp_tool_by_name,
    resolve_callable_mcp_tool_by_ref, DesktopMcpToolView, ToolAvailability,
    ToolAvailabilityCatalog, ToolResolutionError,
};
