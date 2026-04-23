use std::time::Duration;

use log::warn;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::Value;

use crate::modules::desktop_config::network::build_proxy_aware_reqwest_client;
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;

use super::store::build_new_external_raw_record;
use super::types::{
    ExternalSourceConnectionTestResult, ExternalSourceConnectorType, ExternalSourceStatus,
    ExternalSourceSyncMode, ExternalSourceSyncResult, MAX_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
    MIN_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
};

#[derive(Clone, Copy)]
struct SyncTarget {
    asset_family: &'static str,
    source_asset_id: &'static str,
    path: &'static str,
}

const EVOMAP_PUBLIC_TARGETS: &[SyncTarget] = &[
    SyncTarget {
        asset_family: "market_status",
        source_asset_id: "skill_store_status",
        path: "/a2a/skill/store/status",
    },
    SyncTarget {
        asset_family: "skill_catalog",
        source_asset_id: "skill_store_list",
        path: "/a2a/skill/store/list?limit=20",
    },
    SyncTarget {
        asset_family: "mutation_feed",
        source_asset_id: "mutations",
        path: "/a2a/mutations?limit=20",
    },
    SyncTarget {
        asset_family: "validation_reports",
        source_asset_id: "validation_reports",
        path: "/a2a/validation-reports?limit=20",
    },
    SyncTarget {
        asset_family: "evolution_events",
        source_asset_id: "evolution_events",
        path: "/a2a/evolution-events?limit=20",
    },
];

const EVOMAP_KG_TARGETS: &[SyncTarget] = &[
    SyncTarget {
        asset_family: "kg_status",
        source_asset_id: "kg_status",
        path: "/kg/status",
    },
    SyncTarget {
        asset_family: "kg_graph",
        source_asset_id: "kg_my_graph",
        path: "/kg/my-graph",
    },
];

fn join_url(base_url: &str, path: &str) -> Result<String, String> {
    let normalized_base = base_url.trim().trim_end_matches('/');
    if normalized_base.is_empty() {
        return Err("base_url is required for this connector".to_string());
    }
    let path = path.trim();
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    Ok(format!("{normalized_base}{path}"))
}

fn targets_for_connector(connector_type: ExternalSourceConnectorType) -> &'static [SyncTarget] {
    match connector_type {
        ExternalSourceConnectorType::ManualImport => &[],
        ExternalSourceConnectorType::EvomapPublicFeed => EVOMAP_PUBLIC_TARGETS,
        ExternalSourceConnectorType::EvomapKg => EVOMAP_KG_TARGETS,
    }
}

fn parse_last_synced_at_unix_ms(raw: Option<&str>) -> Option<i64> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    let format = time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::parse(value, &format)
        .ok()
        .map(|value| (value.unix_timestamp_nanos() / 1_000_000) as i64)
}

fn should_schedule_sync(
    sync_mode: ExternalSourceSyncMode,
    is_enabled: bool,
    last_synced_at: Option<&str>,
    sync_interval_minutes: i64,
) -> bool {
    if !is_enabled || sync_mode != ExternalSourceSyncMode::Scheduled {
        return false;
    }
    let interval_minutes = sync_interval_minutes.clamp(
        MIN_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
        MAX_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
    );
    let Some(last_synced_at_unix_ms) = parse_last_synced_at_unix_ms(last_synced_at) else {
        return true;
    };
    let now_unix_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
    now_unix_ms - last_synced_at_unix_ms >= interval_minutes * 60 * 1000
}

async fn build_headers(
    store: &McpStore,
    source_id: &str,
    connector_type: ExternalSourceConnectorType,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if connector_type == ExternalSourceConnectorType::EvomapKg {
        let api_key = store
            .get_external_source_api_key(source_id)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| "api_key is required for evomap_kg connectors".to_string())?;
        let header_value = HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .map_err(|err| err.to_string())?;
        headers.insert(AUTHORIZATION, header_value);
    }
    Ok(headers)
}

async fn fetch_remote_payload(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
) -> Result<(Option<u16>, Value), String> {
    let response = client
        .get(url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let status_code = Some(status.as_u16());
    let body = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {} {}", status.as_u16(), body.trim()));
    }
    let payload = match serde_json::from_str::<Value>(&body) {
        Ok(value) => value,
        Err(_) => serde_json::json!({ "text": body }),
    };
    Ok((status_code, payload))
}

pub(crate) async fn test_external_source_connection(
    store: &McpStore,
    source_id: &str,
) -> Result<ExternalSourceConnectionTestResult, String> {
    let source = store
        .get_external_source(source_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "external source not found".to_string())?;
    if source.connector_type == ExternalSourceConnectorType::ManualImport {
        return Ok(ExternalSourceConnectionTestResult {
            ok: true,
            status: None,
            message: "Manual import sources accept pasted or uploaded records directly."
                .to_string(),
            connector_type: source.connector_type,
            endpoint: None,
            discovered_targets: Vec::new(),
        });
    }
    let targets = targets_for_connector(source.connector_type);
    let target = targets
        .first()
        .ok_or_else(|| "no sync targets registered for this connector".to_string())?;
    let base_url = source
        .base_url
        .as_deref()
        .ok_or_else(|| "base_url is required for this connector".to_string())?;
    let url = join_url(base_url, target.path)?;
    let headers = build_headers(store, &source.id, source.connector_type).await?;
    let client = build_proxy_aware_reqwest_client(store).await?;
    let (status, _) = fetch_remote_payload(&client, &url, &headers).await?;
    Ok(ExternalSourceConnectionTestResult {
        ok: true,
        status,
        message: "Connection verified".to_string(),
        connector_type: source.connector_type,
        endpoint: Some(url),
        discovered_targets: targets.iter().map(|item| item.path.to_string()).collect(),
    })
}

pub(crate) async fn sync_external_source_inner(
    store: &McpStore,
    source_id: &str,
) -> Result<ExternalSourceSyncResult, String> {
    let source = store
        .get_external_source(source_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "external source not found".to_string())?;
    if source.connector_type == ExternalSourceConnectorType::ManualImport {
        return Err(
            "manual_import sources do not support remote sync; add records manually".to_string(),
        );
    }

    let base_url = source
        .base_url
        .as_deref()
        .ok_or_else(|| "base_url is required for this connector".to_string())?;
    store
        .update_external_source_sync_state(&source.id, ExternalSourceStatus::Syncing, None, None)
        .await
        .map_err(|err| err.to_string())?;

    let sync_result = async {
        let headers = build_headers(store, &source.id, source.connector_type).await?;
        let client = build_proxy_aware_reqwest_client(store).await?;
        let mut fetched_count = 0_usize;
        let mut stored_count = 0_usize;
        let mut synced_targets = Vec::new();

        for target in targets_for_connector(source.connector_type) {
            let url = join_url(base_url, target.path)?;
            let (_, payload) = fetch_remote_payload(&client, &url, &headers).await?;
            fetched_count += 1;
            let record = build_new_external_raw_record(
                &source.id,
                target.source_asset_id,
                None,
                target.asset_family,
                &payload,
                None,
            )
            .map_err(|err| err.to_string())?;
            store
                .upsert_external_raw_record(record)
                .await
                .map_err(|err| err.to_string())?;
            stored_count += 1;
            synced_targets.push(target.path.to_string());
        }

        let synced_at = mcp_storage::helpers::now_rfc3339().map_err(|err| err.to_string())?;
        Ok::<ExternalSourceSyncResult, String>(ExternalSourceSyncResult {
            source_id: source.id.clone(),
            connector_type: source.connector_type,
            fetched_count,
            stored_count,
            synced_targets,
            synced_at,
        })
    }
    .await;

    match sync_result {
        Ok(result) => {
            let next_status = if source.is_enabled {
                ExternalSourceStatus::Ready
            } else {
                ExternalSourceStatus::Disabled
            };
            store
                .update_external_source_sync_state(
                    &source.id,
                    next_status,
                    Some(result.synced_at.as_str()),
                    None,
                )
                .await
                .map_err(|err| err.to_string())?;
            Ok(result)
        }
        Err(err) => {
            store
                .update_external_source_sync_state(
                    &source.id,
                    ExternalSourceStatus::Error,
                    None,
                    Some(err.as_str()),
                )
                .await
                .map_err(|storage_err| storage_err.to_string())?;
            Err(err)
        }
    }
}

pub(crate) fn start_external_source_sync_worker(app_state: AppState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let sources = match app_state.mcp.store.list_external_sources().await {
                Ok(value) => value,
                Err(err) => {
                    warn!("external source scheduler failed to list sources: {}", err);
                    continue;
                }
            };
            for source in sources {
                if source.status == ExternalSourceStatus::Syncing {
                    continue;
                }
                if !should_schedule_sync(
                    source.sync_mode,
                    source.is_enabled,
                    source.last_synced_at.as_deref(),
                    source.sync_interval_minutes,
                ) {
                    continue;
                }
                if let Err(err) =
                    sync_external_source_inner(app_state.mcp.store.as_ref(), &source.id).await
                {
                    warn!(
                        "scheduled external source sync failed source_id={} err={}",
                        source.id, err
                    );
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::should_schedule_sync;
    use crate::modules::external_sources::types::ExternalSourceSyncMode;

    #[test]
    fn schedule_requires_enabled_scheduled_sources() {
        assert!(!should_schedule_sync(
            ExternalSourceSyncMode::Manual,
            true,
            None,
            60
        ));
        assert!(!should_schedule_sync(
            ExternalSourceSyncMode::Scheduled,
            false,
            None,
            60
        ));
        assert!(should_schedule_sync(
            ExternalSourceSyncMode::Scheduled,
            true,
            None,
            60
        ));
    }
}
