use tauri::State;

use crate::modules::im::runtime::spawn_im_runtime_worker;
use crate::state::AppState;

#[tauri::command]
pub async fn start_local_wechat_pairing(
    state: State<'_, AppState>,
) -> Result<super::types::WechatPairingResponse, String> {
    state.wechat.start_pairing().await
}

#[tauri::command]
pub async fn get_local_wechat_pairing_status(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    pairing_id: String,
) -> Result<super::types::WechatPairingResponse, String> {
    let response = state.wechat.get_pairing_status(pairing_id.as_str()).await?;
    if response.state == "connected" {
        spawn_im_runtime_worker(state.inner().clone(), app_handle);
    }
    Ok(response)
}

#[tauri::command]
pub async fn cancel_local_wechat_pairing(
    state: State<'_, AppState>,
    pairing_id: String,
) -> Result<super::types::WechatCancelPairingResponse, String> {
    state.wechat.cancel_pairing(pairing_id.as_str()).await
}

#[tauri::command]
pub async fn get_local_wechat_connection_state(
    state: State<'_, AppState>,
    _channel_id: String,
) -> Result<super::types::WechatConnectionStateResponse, String> {
    state.wechat.get_connection_state().await
}

#[tauri::command]
pub async fn disconnect_local_wechat_channel(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    _channel_id: String,
) -> Result<super::types::WechatDisconnectResponse, String> {
    let response = state.wechat.disconnect().await?;
    spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(response)
}

#[tauri::command]
pub async fn approve_local_wechat_pairing(
    state: State<'_, AppState>,
    channel_id: String,
    pairing_code: String,
) -> Result<super::types::WechatPairingDecisionResponse, String> {
    let _ = channel_id;
    state.wechat.approve_pairing(pairing_code.as_str()).await
}

#[tauri::command]
pub async fn reject_local_wechat_pairing(
    state: State<'_, AppState>,
    channel_id: String,
    pairing_code: String,
) -> Result<super::types::WechatPairingDecisionResponse, String> {
    let _ = channel_id;
    state.wechat.reject_pairing(pairing_code.as_str()).await
}
