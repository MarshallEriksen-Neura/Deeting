use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::modules::retrieval_kernel::lifecycle::{touched_vitality, vitality_multiplier};
use crate::modules::retrieval_kernel::ranking::{
    bm25_asset_match_scores, normalize_score_map, reciprocal_rank_fusion,
};
use crate::state::AppState;

use super::config::{load_last_corpus_sync_at, save_last_corpus_sync_at};
use super::types::{LocalLlmWikiCorpusSearchHit, LocalLlmWikiCorpusStatus};

const LLM_WIKI_CORPUS_ASSET_TYPE: &str = "llm_wiki_note";
const LLM_WIKI_CORPUS_SOURCE_TYPE: &str = "llm_wiki_corpus";
const MAX_INDEXED_NOTE_BYTES: usize = 256 * 1024;
const SEARCH_LIMIT_OVERFETCH: usize = 3;

#[derive(Debug, Clone)]
pub(super) struct IndexedCorpusNote {
    pub(super) asset_id: String,
    pub(super) absolute_path: String,
    pub(super) relative_path: String,
    pub(super) title: String,
    pub(super) summary: String,
    pub(super) content: String,
    pub(super) content_hash: String,
    pub(super) scope: String,
}

pub(super) async fn sync_corpus(
    app_state: &AppState,
    vault_root: &Path,
    workspace_path: &Path,
) -> Result<(i64, i64, LocalLlmWikiCorpusStatus), String> {
    let notes = tokio::task::spawn_blocking({
        let vault_root = vault_root.to_path_buf();
        let workspace_path = workspace_path.to_path_buf();
        move || collect_indexable_notes(&vault_root, &workspace_path)
    })
    .await
    .map_err(|err| format!("llm wiki corpus scan task failed: {}", err))??;

    let existing_assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(|err| err.to_string())?;

    let existing_by_id = existing_assets
        .into_iter()
        .filter(|asset| is_llm_wiki_corpus_asset(asset))
        .map(|asset| {
            let id = asset
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (id, asset)
        })
        .collect::<HashMap<_, _>>();

    let mut indexed_files = 0_i64;
    let current_ids = notes
        .iter()
        .map(|note| note.asset_id.clone())
        .collect::<HashSet<_>>();
    let stale_ids = existing_by_id
        .keys()
        .filter(|id| !current_ids.contains(*id))
        .cloned()
        .collect::<Vec<_>>();

    for note in &notes {
        let skip = existing_by_id
            .get(&note.asset_id)
            .and_then(|asset| asset.get("metadata"))
            .and_then(|value| value.get("content_hash"))
            .and_then(Value::as_str)
            .map(|hash| hash == note.content_hash)
            .unwrap_or(false);
        if skip {
            continue;
        }

        let vector = app_state
            .providers
            .embedding
            .embed_text(&note.content)
            .await
            .map_err(|err| format!("failed to embed {}: {}", note.relative_path, err))?;

        app_state
            .memory
            .service
            .upsert_asset(
                note.asset_id.clone(),
                note.title.clone(),
                note.summary.clone(),
                LLM_WIKI_CORPUS_ASSET_TYPE.to_string(),
                LLM_WIKI_CORPUS_SOURCE_TYPE.to_string(),
                None,
                vector,
                Some(json!({
                    "absolute_path": note.absolute_path,
                    "relative_path": note.relative_path,
                    "scope": note.scope,
                    "content_hash": note.content_hash,
                    "vitality": 1.0,
                    "last_accessed_at": serde_json::Value::Null,
                })),
            )
            .await
            .map_err(|err| err.to_string())?;
        indexed_files += 1;
    }

    if !stale_ids.is_empty() {
        app_state
            .memory
            .service
            .delete_assets_by_ids(&stale_ids)
            .await
            .map_err(|err| err.to_string())?;
    }

    let now = mcp_storage::helpers::now_rfc3339().map_err(|err| err.to_string())?;
    save_last_corpus_sync_at(app_state.mcp.store.as_ref(), &now)
        .await
        .map_err(|err| err.to_string())?;

    let status = load_corpus_status(
        app_state.mcp.store.as_ref(),
        vault_root,
        workspace_path,
        Some(notes),
    )
    .await?;

    Ok((indexed_files, stale_ids.len() as i64, status))
}

pub(super) async fn load_corpus_status(
    store: &crate::modules::mcp::store::McpStore,
    vault_root: &Path,
    workspace_path: &Path,
    prefetched_notes: Option<Vec<IndexedCorpusNote>>,
) -> Result<LocalLlmWikiCorpusStatus, String> {
    let notes = if let Some(notes) = prefetched_notes {
        notes
    } else {
        tokio::task::spawn_blocking({
            let vault_root = vault_root.to_path_buf();
            let workspace_path = workspace_path.to_path_buf();
            move || collect_indexable_notes(&vault_root, &workspace_path)
        })
        .await
        .map_err(|err| format!("llm wiki corpus scan task failed: {}", err))??
    };

    let managed_workspace_note_count = notes
        .iter()
        .filter(|note| note.scope == "managed_workspace")
        .count() as i64;
    let legacy_vault_note_count = notes
        .iter()
        .filter(|note| note.scope == "legacy_vault")
        .count() as i64;
    let last_synced_at = load_last_corpus_sync_at(store)
        .await
        .map_err(|err| err.to_string())?;

    Ok(LocalLlmWikiCorpusStatus {
        indexed_note_count: notes.len() as i64,
        managed_workspace_note_count,
        legacy_vault_note_count,
        last_synced_at,
    })
}

pub(crate) async fn search_corpus(
    app_state: &AppState,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalLlmWikiCorpusSearchHit>, String> {
    let normalized_query = query.trim();
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .filter(is_llm_wiki_corpus_asset)
        .collect::<Vec<_>>();
    if assets.is_empty() {
        return Ok(Vec::new());
    }

    let bm25_scores = bm25_asset_match_scores(normalized_query, &assets);
    let semantic_scores =
        search_semantic_scores(app_state, normalized_query, limit * SEARCH_LIMIT_OVERFETCH).await?;
    let fused_scores = reciprocal_rank_fusion(&[&bm25_scores, &semantic_scores]);

    let now = time::OffsetDateTime::now_utc();
    let mut hits = assets
        .into_iter()
        .filter_map(|asset| {
            let key = asset
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?
                .to_string();
            let base_score = fused_scores
                .get(&key)
                .copied()
                .or_else(|| bm25_scores.get(&key).copied())
                .or_else(|| semantic_scores.get(&key).copied())?;
            if base_score <= 0.0 {
                return None;
            }

            let metadata = asset.get("metadata");
            let vitality = metadata
                .and_then(|value| value.get("vitality"))
                .and_then(Value::as_f64)
                .map(|value| value as f32);
            let reference_timestamp = metadata
                .and_then(|value| value.get("last_accessed_at"))
                .and_then(Value::as_str)
                .or_else(|| asset.get("updated_at").and_then(Value::as_str))
                .unwrap_or("1970-01-01T00:00:00Z");
            let score = base_score * vitality_multiplier(vitality, reference_timestamp, now) as f64;

            Some(LocalLlmWikiCorpusSearchHit {
                asset_id: key,
                relative_path: metadata
                    .and_then(|value| value.get("relative_path"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                title: asset
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                scope: metadata
                    .and_then(|value| value.get("scope"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                summary: asset
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                score,
            })
        })
        .collect::<Vec<_>>();

    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    hits.truncate(limit);
    touch_search_hits(app_state, &hits).await?;
    Ok(hits)
}

fn collect_indexable_notes(
    vault_root: &Path,
    workspace_path: &Path,
) -> Result<Vec<IndexedCorpusNote>, String> {
    let mut notes = Vec::new();
    let mut stack = vec![vault_root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = fs::read_dir(&current_dir)
            .map_err(|err| format!("failed to read {}: {}", current_dir.display(), err))?;

        for entry in entries {
            let entry = entry
                .map_err(|err| format!("failed to inspect {}: {}", current_dir.display(), err))?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let lower_name = file_name.to_ascii_lowercase();
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;

            if file_type.is_dir() {
                if should_skip_dir(&lower_name) {
                    continue;
                }
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }
            if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("md"))
                .unwrap_or(true)
            {
                continue;
            }

            let content = fs::read_to_string(&path)
                .map_err(|err| format!("failed to read {}: {}", path.display(), err))?;
            let trimmed = content.trim();
            if trimmed.is_empty() {
                continue;
            }
            let truncated = if trimmed.len() > MAX_INDEXED_NOTE_BYTES {
                &trimmed[..MAX_INDEXED_NOTE_BYTES]
            } else {
                trimmed
            };

            let relative_path = path
                .strip_prefix(vault_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let title = file_stem_title(&path);
            let summary = summarize_markdown(truncated);
            let scope = if path.starts_with(workspace_path) {
                "managed_workspace"
            } else {
                "legacy_vault"
            }
            .to_string();
            let content_hash = hash_text(truncated);
            let asset_id = format!("llm_wiki::{}", hash_text(&relative_path));

            notes.push(IndexedCorpusNote {
                asset_id,
                absolute_path: path.to_string_lossy().to_string(),
                relative_path,
                title,
                summary,
                content: truncated.to_string(),
                content_hash,
                scope,
            });
        }
    }

    notes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(notes)
}

async fn search_semantic_scores(
    app_state: &AppState,
    query: &str,
    limit: usize,
) -> Result<HashMap<String, f64>, String> {
    let vector = app_state
        .providers
        .embedding
        .embed_text(query)
        .await
        .map_err(|err| format!("failed to embed llm wiki query: {}", err))?;

    let semantic_hits = app_state
        .memory
        .service
        .search_assets(vector, limit.max(1), Some(LLM_WIKI_CORPUS_ASSET_TYPE))
        .await
        .map_err(|err| err.to_string())?;

    let scores = semantic_hits
        .into_iter()
        .filter_map(|item| {
            let key = item.get("id").and_then(Value::as_str)?.trim().to_string();
            let distance = item.get("_distance").and_then(Value::as_f64)?;
            let similarity = 1.0 / (1.0 + distance.max(0.0));
            Some((key, similarity))
        })
        .collect::<HashMap<_, _>>();

    Ok(normalize_score_map(scores))
}

async fn touch_search_hits(
    app_state: &AppState,
    hits: &[LocalLlmWikiCorpusSearchHit],
) -> Result<(), String> {
    for hit in hits.iter().take(3) {
        let Some(asset) = app_state
            .memory
            .service
            .get_asset_by_id(&hit.asset_id)
            .await
            .map_err(|err| err.to_string())?
        else {
            continue;
        };
        let Some(metadata) = asset.get("metadata").and_then(Value::as_object).cloned() else {
            continue;
        };
        let Some(absolute_path) = metadata
            .get("absolute_path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let content = match fs::read_to_string(absolute_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let vector = match app_state.providers.embedding.embed_text(&content).await {
            Ok(vector) => vector,
            Err(_) => continue,
        };
        let current_vitality = metadata
            .get("vitality")
            .and_then(Value::as_f64)
            .map(|value| value as f32);
        let mut next_metadata = serde_json::Map::new();
        for (key, value) in metadata {
            next_metadata.insert(key, value);
        }
        next_metadata.insert(
            "vitality".to_string(),
            json!(touched_vitality(current_vitality)),
        );
        next_metadata.insert(
            "last_accessed_at".to_string(),
            json!(mcp_storage::helpers::now_rfc3339().map_err(|err| err.to_string())?),
        );
        app_state
            .memory
            .service
            .upsert_asset(
                hit.asset_id.clone(),
                asset
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                asset
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                LLM_WIKI_CORPUS_ASSET_TYPE.to_string(),
                LLM_WIKI_CORPUS_SOURCE_TYPE.to_string(),
                None,
                vector,
                Some(Value::Object(next_metadata)),
            )
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn is_llm_wiki_corpus_asset(asset: &Value) -> bool {
    asset.get("asset_type").and_then(Value::as_str) == Some(LLM_WIKI_CORPUS_ASSET_TYPE)
        && asset.get("source_type").and_then(Value::as_str) == Some(LLM_WIKI_CORPUS_SOURCE_TYPE)
}

fn should_skip_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | ".next" | ".trash")
}

fn file_stem_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled Note")
        .to_string()
}

fn summarize_markdown(content: &str) -> String {
    let single_line = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    if single_line.len() > 220 {
        format!("{}...", &single_line[..220])
    } else {
        single_line
    }
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{collect_indexable_notes, summarize_markdown};
    use std::fs;

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "deeting-llm-wiki-corpus-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn collect_indexable_notes_marks_workspace_scope() {
        let root = temp_root("scan");
        let workspace = root.join("Deeting Wiki");
        fs::create_dir_all(workspace.join("wiki")).expect("create workspace");
        fs::write(root.join("legacy.md"), "# Legacy").expect("write legacy");
        fs::write(workspace.join("Home.md"), "# Home").expect("write home");

        let notes = collect_indexable_notes(&root, &workspace).expect("collect notes");

        assert_eq!(notes.len(), 2);
        assert!(notes.iter().any(|note| note.scope == "legacy_vault"));
        assert!(notes.iter().any(|note| note.scope == "managed_workspace"));
    }

    #[test]
    fn summarize_markdown_compacts_lines() {
        let summary = summarize_markdown(
            "# Title\n\nThis is a note.\nIt has multiple lines.\nAnd a final point.",
        );
        assert!(summary.contains("# Title"));
        assert!(summary.contains("This is a note."));
    }
}
