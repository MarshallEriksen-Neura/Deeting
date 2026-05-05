use std::time::Duration;

use log::warn;

use crate::modules::mcp::store::McpStore;
use crate::state::AppState;

use super::translators::translate_external_record;
use super::types::ExternalSourceTranslationRunResult;

pub(crate) async fn translate_pending_external_records_once(
    store: &McpStore,
    limit: usize,
) -> Result<ExternalSourceTranslationRunResult, String> {
    let records = store
        .list_pending_external_raw_records_for_translation(limit)
        .await
        .map_err(|err| err.to_string())?;
    let mut translated_count = 0_usize;
    let mut failed_count = 0_usize;

    for item in records {
        let result = async {
            let candidate = translate_external_record(&item).map_err(|err| err.to_string())?;
            store
                .upsert_external_experience_candidate(candidate)
                .await
                .map_err(|err| err.to_string())?;
            store
                .update_external_raw_record_translation_state(&item.record.id, "translated", None)
                .await
                .map_err(|err| err.to_string())?;
            Ok::<(), String>(())
        }
        .await;

        match result {
            Ok(()) => translated_count += 1,
            Err(err) => {
                failed_count += 1;
                store
                    .update_external_raw_record_translation_state(
                        &item.record.id,
                        "failed",
                        Some(err.as_str()),
                    )
                    .await
                    .map_err(|storage_err| storage_err.to_string())?;
            }
        }
    }

    Ok(ExternalSourceTranslationRunResult {
        translated_count,
        failed_count,
    })
}

pub(crate) fn start_external_source_translation_worker(app_state: AppState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(25)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            if let Err(err) =
                translate_pending_external_records_once(app_state.mcp.store.as_ref(), 20).await
            {
                warn!("external source translation worker failed: {}", err);
            }
        }
    });
}
