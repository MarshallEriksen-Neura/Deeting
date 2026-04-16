use std::path::Path;

use crate::state::AppState;

use super::store::{
    bootstrap_corpus as bootstrap_corpus_store, clear_legacy_projection_assets,
    load_corpus_status as load_corpus_status_store, reconcile_corpus as reconcile_corpus_store,
    rebuild_projection_assets, search_corpus as search_corpus_store, workspace_id_from_path,
};
use super::types::{LocalLlmWikiCorpusSearchHit, LocalLlmWikiCorpusStatus};

pub(super) async fn sync_corpus(
    app_state: &AppState,
    vault_root: &Path,
    workspace_path: &Path,
) -> Result<(i64, i64, LocalLlmWikiCorpusStatus), String> {
    clear_legacy_projection_assets(app_state)
        .await
        .map_err(|err| err.to_string())?;
    let sync = reconcile_corpus_store(
        app_state.mcp.store.as_ref(),
        vault_root,
        workspace_path,
        "manual_sync",
    )
    .await
    .map_err(|err| err.to_string())?;
    rebuild_projection_assets(
        app_state,
        workspace_id_from_path(workspace_path).as_str(),
        &sync.changed_doc_ids,
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok((sync.indexed_files, sync.removed_files, sync.status))
}

pub(super) async fn bootstrap_corpus(
    app_state: &AppState,
    vault_root: &Path,
    workspace_path: &Path,
) -> Result<LocalLlmWikiCorpusStatus, String> {
    clear_legacy_projection_assets(app_state)
        .await
        .map_err(|err| err.to_string())?;
    let sync = bootstrap_corpus_store(
        app_state.mcp.store.as_ref(),
        vault_root,
        workspace_path,
        "workspace_bootstrap",
    )
    .await
    .map_err(|err| err.to_string())?;
    rebuild_projection_assets(
        app_state,
        workspace_id_from_path(workspace_path).as_str(),
        &sync.changed_doc_ids,
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(sync.status)
}

pub(super) async fn load_corpus_status(
    store: &crate::modules::mcp::store::McpStore,
    _vault_root: &Path,
    workspace_path: &Path,
    _prefetched_notes: Option<Vec<()>>,
) -> Result<LocalLlmWikiCorpusStatus, String> {
    load_corpus_status_store(store, workspace_id_from_path(workspace_path).as_str())
        .await
        .map_err(|err| err.to_string())
}

pub(crate) async fn search_corpus(
    app_state: &AppState,
    workspace_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalLlmWikiCorpusSearchHit>, String> {
    let workspace_id = workspace_id_from_path(workspace_path);
    let hits = search_corpus_store(
        app_state.mcp.store.as_ref(),
        app_state,
        workspace_id.as_str(),
        query,
        limit,
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(hits
        .into_iter()
        .map(|hit| LocalLlmWikiCorpusSearchHit {
            asset_id: hit.chunk_id,
            doc_id: hit.doc_id,
            chunk_index: hit.chunk_index,
            relative_path: hit.relative_path,
            title: hit.title,
            scope: hit.scope,
            summary: hit.snippet,
            lexical_score: hit.lexical_score,
            semantic_score: hit.semantic_score,
            score: hit.final_score,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::load_corpus_status;
    use crate::modules::mcp::store::McpStore;

    #[tokio::test]
    async fn load_corpus_status_returns_default_for_empty_workspace() {
        let store = McpStore::new("sqlite::memory:")
            .await
            .expect("create store");
        store.init().await.expect("init store");

        let status = load_corpus_status(
            &store,
            Path::new("C:/vault"),
            Path::new("C:/vault/Deeting Wiki"),
            None,
        )
        .await
        .expect("load status");

        assert_eq!(status.indexed_note_count, 0);
        assert_eq!(status.managed_workspace_note_count, 0);
        assert_eq!(status.legacy_vault_note_count, 0);
        assert!(status.last_synced_at.is_none());
    }
}
