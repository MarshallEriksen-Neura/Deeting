use crate::modules::desktop_config::network::resolve_desktop_network_proxy_settings;
use crate::modules::desktop_config::{
    parse_sandbox_image_registries, DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY,
};
use crate::modules::sandbox::manager::SandboxPrepareConfig;
use crate::state::AppState;

pub(crate) async fn resolve_sandbox_prepare_config(
    state: &AppState,
) -> Result<SandboxPrepareConfig, String> {
    let proxy_settings = resolve_desktop_network_proxy_settings(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    let raw = state
        .mcp
        .store
        .get_desktop_config(DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY)
        .await
        .map_err(|err| err.to_string())?;

    Ok(SandboxPrepareConfig {
        proxy_settings: Some(proxy_settings),
        image_registries: parse_sandbox_image_registries(raw.as_deref()),
    })
}
