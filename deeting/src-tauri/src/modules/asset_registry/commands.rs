use tauri::State;

use crate::state::AppState;

use super::service::save_local_asset as save_local_asset_inner;
use super::store::{
    list_local_assets as list_local_assets_inner,
    update_local_asset_record as update_local_asset_record_inner,
};
use super::types::{
    ListLocalAssetsRequest, LocalAssetRecord, SaveLocalAssetRequest, UpdateLocalAssetRequest,
};

#[tauri::command]
pub async fn list_local_assets(
    state: State<'_, AppState>,
    request: Option<ListLocalAssetsRequest>,
) -> Result<Vec<LocalAssetRecord>, String> {
    list_local_assets_inner(state.mcp.store.as_ref(), request.unwrap_or_default())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_local_asset(
    state: State<'_, AppState>,
    asset_id: String,
    request: UpdateLocalAssetRequest,
) -> Result<LocalAssetRecord, String> {
    update_local_asset_record_inner(state.mcp.store.as_ref(), &asset_id, request)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_local_asset(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SaveLocalAssetRequest,
) -> Result<LocalAssetRecord, String> {
    save_local_asset_inner(&app, state.inner(), state.mcp.store.as_ref(), request)
        .await
        .map_err(|err| err.to_string())
}
