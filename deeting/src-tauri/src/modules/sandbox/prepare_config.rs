use crate::modules::desktop_config::network::resolve_desktop_network_proxy_settings;
use crate::modules::desktop_config::{
    parse_sandbox_image_registries, DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY,
};
use crate::modules::mcp::store::McpStore;
use crate::modules::sandbox::manager::SandboxPrepareConfig;
use crate::state::{global_app_state, AppState};

pub(crate) async fn resolve_sandbox_prepare_config(
    state: &AppState,
) -> Result<SandboxPrepareConfig, String> {
    resolve_sandbox_prepare_config_from_mcp_store(state.mcp.store.as_ref()).await
}

pub(crate) async fn resolve_sandbox_prepare_config_from_global_state(
) -> Option<SandboxPrepareConfig> {
    let state = global_app_state()?;
    resolve_sandbox_prepare_config(&state).await.ok()
}

async fn resolve_sandbox_prepare_config_from_mcp_store(
    store: &McpStore,
) -> Result<SandboxPrepareConfig, String> {
    let proxy_settings = resolve_desktop_network_proxy_settings(store)
        .await
        .map_err(|err| err.to_string())?;
    let raw = store
        .get_desktop_config(DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY)
        .await
        .map_err(|err| err.to_string())?;

    Ok(SandboxPrepareConfig {
        proxy_settings: Some(proxy_settings),
        image_registries: parse_sandbox_image_registries(raw.as_deref()),
    })
}
