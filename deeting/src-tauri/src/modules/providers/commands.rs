use tauri::State;
use uuid::Uuid;
use crate::state::AppState;
use crate::modules::providers::types::{ProviderInstance, ProviderModel, CreateInstanceRequest};

#[tauri::command]
pub async fn list_local_provider_instances(
    state: State<'_, AppState>
) -> Result<Vec<ProviderInstance>, String> {
    state.providers.store.list_instances().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_local_provider_instance(
    state: State<'_, AppState>,
    payload: CreateInstanceRequest,
) -> Result<ProviderInstance, String> {
    state.providers.store.create_instance(payload).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_local_provider_models(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<Vec<ProviderModel>, String> {
    let id = Uuid::parse_str(&instance_id).map_err(|e| e.to_string())?;
    state.providers.store.list_models(&id).await.map_err(|e| e.to_string())
}
