use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::Serialize;

use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::types::{McpTool, McpToolStatus, McpTransportKind};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DesktopMcpToolIndexStatus {
    Indexed,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesktopMcpToolView {
    #[serde(flatten)]
    pub tool: McpTool,
    pub desired_enabled: bool,
    pub runtime_ready: bool,
    pub runtime_status_reason: &'static str,
    pub availability_class: ToolAvailabilityClass,
    pub recommended_action: &'static str,
    pub activation_required: bool,
    pub install_required: bool,
    pub index_status: DesktopMcpToolIndexStatus,
    pub index_status_reason: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAvailabilityClass {
    CallableDirect,
    NeedsSetup,
    Unavailable,
}

#[derive(Debug, Clone)]
pub(crate) struct ToolAvailability {
    pub(crate) class: ToolAvailabilityClass,
    pub(crate) install_required: bool,
    pub(crate) activation_required: bool,
    pub(crate) recommended_action: &'static str,
    pub(crate) status_reason: &'static str,
}

impl ToolAvailability {
    fn callable(status_reason: &'static str) -> Self {
        Self {
            class: ToolAvailabilityClass::CallableDirect,
            install_required: false,
            activation_required: false,
            recommended_action: "execute",
            status_reason,
        }
    }

    fn activation_required(recommended_action: &'static str, status_reason: &'static str) -> Self {
        Self {
            class: ToolAvailabilityClass::NeedsSetup,
            install_required: false,
            activation_required: true,
            recommended_action,
            status_reason,
        }
    }

    fn unavailable(recommended_action: &'static str, status_reason: &'static str) -> Self {
        Self {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action,
            status_reason,
        }
    }

    pub(crate) fn is_direct_callable(&self) -> bool {
        matches!(self.class, ToolAvailabilityClass::CallableDirect)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ToolAvailabilityCatalog {
    by_id: HashMap<String, ToolAvailability>,
    by_unique_name: HashMap<String, ToolAvailability>,
}

impl ToolAvailabilityCatalog {
    pub(crate) fn get_for_asset(
        &self,
        asset_id: &str,
        tool_name: &str,
    ) -> Option<&ToolAvailability> {
        self.by_id
            .get(asset_id)
            .or_else(|| self.by_unique_name.get(tool_name.trim()))
    }
}

#[derive(Debug, Clone)]
pub(crate) enum ToolResolutionError {
    InvalidToolReference,
    ToolNotFound {
        tool_ref: String,
    },
    ToolNotCallable {
        tool_ref: String,
        availability: ToolAvailability,
    },
}

impl fmt::Display for ToolResolutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidToolReference => write!(f, "tool id or tool name is required"),
            Self::ToolNotFound { tool_ref } => write!(f, "tool {} not found", tool_ref),
            Self::ToolNotCallable {
                tool_ref,
                availability,
            } => write!(
                f,
                "tool '{}' is not directly callable (reason={}, action={})",
                tool_ref, availability.status_reason, availability.recommended_action
            ),
        }
    }
}

impl std::error::Error for ToolResolutionError {}

pub(crate) fn build_desktop_mcp_tool_view(
    tool: McpTool,
    indexed_tool_ids: Option<&HashSet<String>>,
) -> DesktopMcpToolView {
    let availability = tool_availability_from_tool(&tool);
    let (index_status, index_status_reason) = match indexed_tool_ids {
        Some(ids) if ids.contains(tool.id.as_str()) => (
            DesktopMcpToolIndexStatus::Indexed,
            "indexed_in_local_memory",
        ),
        Some(_) => (
            DesktopMcpToolIndexStatus::Missing,
            "missing_from_local_memory_index",
        ),
        None => (
            DesktopMcpToolIndexStatus::Unknown,
            "local_memory_index_status_unavailable",
        ),
    };

    DesktopMcpToolView {
        desired_enabled: true,
        runtime_ready: availability.is_direct_callable(),
        runtime_status_reason: availability.status_reason,
        availability_class: availability.class,
        recommended_action: availability.recommended_action,
        activation_required: availability.activation_required,
        install_required: availability.install_required,
        index_status,
        index_status_reason,
        tool,
    }
}

pub(crate) async fn build_desktop_mcp_tool_views(
    store: &McpStore,
    indexed_tool_ids: Option<&HashSet<String>>,
) -> Result<Vec<DesktopMcpToolView>, String> {
    let tools = store.list_tools().await.map_err(|err| err.to_string())?;

    Ok(tools
        .into_iter()
        .map(|tool| build_desktop_mcp_tool_view(tool, indexed_tool_ids))
        .collect())
}

pub(crate) fn fallback_local_tool_availability(_pkg_name: Option<&str>) -> ToolAvailability {
    ToolAvailability::callable("ready_in_local_runtime")
}

pub(crate) fn tool_availability_from_tool(tool: &McpTool) -> ToolAvailability {
    match tool.transport_kind() {
        McpTransportKind::Sse => match tool.status {
            McpToolStatus::Healthy | McpToolStatus::Degraded => {
                ToolAvailability::callable("ready_via_remote_mcp")
            }
            McpToolStatus::Stopped => {
                ToolAvailability::activation_required("start_tool", "remote_server_sync_required")
            }
            McpToolStatus::Pending => {
                ToolAvailability::unavailable("wait_for_runtime", "remote_server_pending_sync")
            }
            McpToolStatus::Starting => {
                ToolAvailability::unavailable("wait_for_runtime", "remote_server_sync_starting")
            }
            McpToolStatus::Updating => {
                ToolAvailability::unavailable("wait_for_runtime", "remote_server_sync_updating")
            }
            McpToolStatus::Crashed => {
                ToolAvailability::unavailable("review", "remote_server_sync_crashed")
            }
            McpToolStatus::Error => ToolAvailability::unavailable("review", "remote_server_error"),
            McpToolStatus::Orphaned => {
                ToolAvailability::unavailable("review", "remote_tool_orphaned_from_server")
            }
        },
        McpTransportKind::Stdio => {
            if !tool.supports_local_process_lifecycle() {
                return ToolAvailability::unavailable("review", "stdio_tool_missing_command");
            }

            match tool.status {
                McpToolStatus::Healthy | McpToolStatus::Degraded => {
                    ToolAvailability::callable("ready_in_local_runtime")
                }
                McpToolStatus::Stopped => ToolAvailability::activation_required(
                    "start_tool",
                    "tool_installed_but_stopped",
                ),
                McpToolStatus::Pending => ToolAvailability::unavailable(
                    "wait_for_runtime",
                    "tool_pending_runtime_activation",
                ),
                McpToolStatus::Starting => {
                    ToolAvailability::unavailable("wait_for_runtime", "tool_runtime_starting")
                }
                McpToolStatus::Updating => {
                    ToolAvailability::unavailable("wait_for_runtime", "tool_runtime_updating")
                }
                McpToolStatus::Crashed => {
                    ToolAvailability::unavailable("review", "tool_runtime_crashed")
                }
                McpToolStatus::Error => {
                    ToolAvailability::unavailable("review", "tool_runtime_error")
                }
                McpToolStatus::Orphaned => {
                    ToolAvailability::unavailable("review", "tool_orphaned_from_runtime")
                }
            }
        }
        McpTransportKind::Unknown => {
            ToolAvailability::unavailable("review", "tool_transport_unresolved")
        }
    }
}

pub(crate) async fn build_db_tool_availability_catalog(
    store: &McpStore,
) -> Result<ToolAvailabilityCatalog, String> {
    let tools = store.list_tools().await.map_err(|err| err.to_string())?;
    let mut by_id = HashMap::with_capacity(tools.len());
    let mut by_name_candidates = HashMap::with_capacity(tools.len());
    let mut name_counts = HashMap::<String, usize>::with_capacity(tools.len());

    for tool in tools {
        let availability = tool_availability_from_tool(&tool);
        by_id.insert(tool.id.clone(), availability.clone());

        let normalized_name = tool.name.trim().to_string();
        if !normalized_name.is_empty() {
            *name_counts.entry(normalized_name.clone()).or_insert(0) += 1;
            by_name_candidates.insert(normalized_name, availability);
        }
    }

    let by_unique_name = by_name_candidates
        .into_iter()
        .filter(|(name, _)| name_counts.get(name).copied() == Some(1))
        .collect();

    Ok(ToolAvailabilityCatalog {
        by_id,
        by_unique_name,
    })
}

fn normalize_tool_ref(
    tool_id: Option<&str>,
    tool_name: Option<&str>,
) -> (Option<String>, Option<String>) {
    let normalized_tool_id = tool_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let normalized_tool_name = tool_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    (normalized_tool_id, normalized_tool_name)
}

fn display_tool_ref(tool_id: Option<&str>, tool_name: Option<&str>) -> String {
    tool_id
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            tool_name
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "<unknown>".to_string())
}

pub(crate) async fn resolve_tool_by_ref(
    store: &McpStore,
    tool_id: Option<&str>,
    tool_name: Option<&str>,
) -> Result<McpTool, ToolResolutionError> {
    let (normalized_tool_id, normalized_tool_name) = normalize_tool_ref(tool_id, tool_name);

    if let Some(tool_id) = normalized_tool_id {
        return store
            .get_tool(&tool_id)
            .await
            .map_err(|_| ToolResolutionError::ToolNotFound {
                tool_ref: tool_id.clone(),
            })?
            .ok_or(ToolResolutionError::ToolNotFound { tool_ref: tool_id });
    }

    let Some(normalized_tool_name) = normalized_tool_name else {
        return Err(ToolResolutionError::InvalidToolReference);
    };

    store
        .get_tool_by_name(&normalized_tool_name)
        .await
        .map_err(|_| ToolResolutionError::ToolNotFound {
            tool_ref: normalized_tool_name.clone(),
        })?
        .ok_or(ToolResolutionError::ToolNotFound {
            tool_ref: normalized_tool_name,
        })
}

pub(crate) async fn resolve_callable_mcp_tool_by_name(
    store: &McpStore,
    tool_name: &str,
) -> Result<McpTool, ToolResolutionError> {
    resolve_callable_mcp_tool_by_ref(store, None, Some(tool_name)).await
}

pub(crate) async fn resolve_callable_mcp_tool_by_ref(
    store: &McpStore,
    tool_id: Option<&str>,
    tool_name: Option<&str>,
) -> Result<McpTool, ToolResolutionError> {
    let tool = resolve_tool_by_ref(store, tool_id, tool_name).await?;
    let tool_ref = display_tool_ref(tool_id, Some(tool.name.as_str()));
    let availability = tool_availability_from_tool(&tool);
    if availability.is_direct_callable() {
        Ok(tool)
    } else {
        Err(ToolResolutionError::ToolNotCallable {
            tool_ref,
            availability,
        })
    }
}
