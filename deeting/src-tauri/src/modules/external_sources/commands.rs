use tauri::State;

use crate::modules::memory::types::{CreateLocalMemoryRequest, WriteAction};
use crate::modules::retrieval_kernel::write_guard::WriteGuardProfile;
use crate::state::AppState;

use super::sync::{sync_external_source_inner, test_external_source_connection};
use super::translation::translate_pending_external_records_once;
use super::types::{
    AcceptExternalExperienceCandidateRequest, AcceptExternalExperienceCandidateResult,
    AdoptExternalExperienceCandidateRequest, AdoptExternalExperienceCandidateResult,
    CreateExternalSourceRequest, CreateManualExternalRawRecordRequest, ExternalExperienceCandidate,
    ExternalRawRecord, ExternalSourceConnectionTestResult, ExternalSourceRecord,
    ExternalSourceSyncResult, ExternalSourceTranslationRunResult,
    ListExternalExperienceCandidatesRequest, ReviewExternalExperienceCandidateRequest,
    UpdateExternalSourceRequest,
};

#[tauri::command]
pub async fn list_local_external_sources(
    state: State<'_, AppState>,
) -> Result<Vec<ExternalSourceRecord>, String> {
    state
        .mcp
        .store
        .list_external_sources()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_local_external_source(
    state: State<'_, AppState>,
    payload: CreateExternalSourceRequest,
) -> Result<ExternalSourceRecord, String> {
    state
        .mcp
        .store
        .create_external_source(payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
    payload: UpdateExternalSourceRequest,
) -> Result<ExternalSourceRecord, String> {
    state
        .mcp
        .store
        .update_external_source(&source_id, payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_external_source(&source_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn test_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<ExternalSourceConnectionTestResult, String> {
    test_external_source_connection(state.mcp.store.as_ref(), &source_id).await
}

#[tauri::command]
pub async fn sync_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<ExternalSourceSyncResult, String> {
    sync_external_source_inner(state.mcp.store.as_ref(), &source_id).await
}

#[tauri::command]
pub async fn list_local_external_source_records(
    state: State<'_, AppState>,
    source_id: String,
    limit: Option<usize>,
) -> Result<Vec<ExternalRawRecord>, String> {
    state
        .mcp
        .store
        .list_external_raw_records(&source_id, limit.unwrap_or(10))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_local_manual_external_record(
    state: State<'_, AppState>,
    source_id: String,
    payload: CreateManualExternalRawRecordRequest,
) -> Result<ExternalRawRecord, String> {
    state
        .mcp
        .store
        .create_manual_external_raw_record(&source_id, payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn translate_local_external_records_once(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<ExternalSourceTranslationRunResult, String> {
    translate_pending_external_records_once(state.mcp.store.as_ref(), limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn list_local_external_experience_candidates(
    state: State<'_, AppState>,
    payload: Option<ListExternalExperienceCandidatesRequest>,
) -> Result<Vec<ExternalExperienceCandidate>, String> {
    let payload = payload.unwrap_or_default();
    state
        .mcp
        .store
        .list_external_experience_candidates(
            payload.source_id.as_deref(),
            payload.raw_record_id.as_deref(),
            payload.limit.unwrap_or(20),
        )
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn review_local_external_experience_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
    payload: ReviewExternalExperienceCandidateRequest,
) -> Result<ExternalExperienceCandidate, String> {
    state
        .mcp
        .store
        .review_external_experience_candidate(
            &candidate_id,
            &payload.review_status,
            payload.rejected_reason.as_deref(),
        )
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn accept_local_external_experience_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
    payload: AcceptExternalExperienceCandidateRequest,
) -> Result<AcceptExternalExperienceCandidateResult, String> {
    let target = payload.target.unwrap_or_else(|| "llm_wiki".to_string());
    if target != "llm_wiki" {
        return Err(
            "only llm_wiki acceptance is supported for external experience candidates".to_string(),
        );
    }
    let candidate = state
        .mcp
        .store
        .get_external_experience_candidate(&candidate_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "external experience candidate not found".to_string())?;
    if candidate.review_status == "rejected" {
        return Err("rejected candidates cannot be accepted".to_string());
    }
    let accepted_ref =
        crate::modules::llm_wiki::service::accept_external_experience_candidate_to_llm_wiki(
            state.inner(),
            crate::modules::llm_wiki::service::ExternalExperienceLlmWikiCandidate {
                candidate_id: candidate.id.clone(),
                candidate_kind: candidate.candidate_kind.clone(),
                title: candidate.title.clone(),
                summary: candidate.summary.clone(),
                canonical_payload_json: candidate.canonical_payload_json.clone(),
                provenance_json: candidate.provenance_json.clone(),
            },
        )
        .await?;
    let candidate = state
        .mcp
        .store
        .mark_external_experience_candidate_accepted(&candidate_id, &target, &accepted_ref)
        .await
        .map_err(|err| err.to_string())?;

    Ok(AcceptExternalExperienceCandidateResult {
        candidate,
        accepted_ref,
    })
}

#[tauri::command]
pub async fn adopt_local_external_experience_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
    payload: AdoptExternalExperienceCandidateRequest,
) -> Result<AdoptExternalExperienceCandidateResult, String> {
    let target = payload.target.unwrap_or_else(|| "memory".to_string());
    if target != "memory" {
        return Err(
            "only memory adoption is supported for external experience candidates".to_string(),
        );
    }
    let candidate = state
        .mcp
        .store
        .get_external_experience_candidate(&candidate_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "external experience candidate not found".to_string())?;
    if candidate.review_status != "accepted" {
        return Err("candidate must be accepted into LLM Wiki before adoption".to_string());
    }
    if let Some(memory_id) = candidate.adopted_memory_id.clone() {
        return Ok(AdoptExternalExperienceCandidateResult {
            candidate,
            memory_id,
            memory_action: "already_adopted".to_string(),
        });
    }

    let memory_payload = build_external_candidate_memory_request(&candidate);
    let result = state
        .memory
        .service
        .append_guarded_with_profile(memory_payload, WriteGuardProfile::WikiPromotion)
        .await
        .map_err(|err| err.to_string());

    let result = match result {
        Ok(value) => value,
        Err(err) => {
            let _ = state
                .mcp
                .store
                .mark_external_experience_candidate_adoption_failed(&candidate_id, &err)
                .await;
            return Err(err);
        }
    };
    let memory_id = result
        .item
        .as_ref()
        .map(|item| item.id.clone())
        .or_else(|| result.updated_memory_id.clone())
        .ok_or_else(|| "memory adoption did not produce a memory id".to_string())?;
    let memory_action = match result.action {
        WriteAction::Add => "add",
        WriteAction::Update => "update",
        WriteAction::Noop => "noop",
    }
    .to_string();
    let candidate = state
        .mcp
        .store
        .mark_external_experience_candidate_adopted(&candidate_id, &memory_id, None)
        .await
        .map_err(|err| err.to_string())?;

    Ok(AdoptExternalExperienceCandidateResult {
        candidate,
        memory_id,
        memory_action,
    })
}

fn build_external_candidate_memory_request(
    candidate: &ExternalExperienceCandidate,
) -> CreateLocalMemoryRequest {
    let accepted_ref = candidate.accepted_ref.as_deref().unwrap_or("");
    let content = format!(
        "External experience adopted for agent behavior.\n\nTitle: {}\nKind: {}\nSummary: {}\nLLM Wiki source: {}",
        candidate.title.trim(),
        candidate.candidate_kind.trim(),
        candidate.summary.trim(),
        accepted_ref.trim()
    );
    CreateLocalMemoryRequest {
        content,
        session_id: None,
        capability_id: Some("external_experience".to_string()),
        meta_info: Some(serde_json::json!({
            "source": "external_experience_adoption",
            "candidateId": candidate.id,
            "candidateKind": candidate.candidate_kind,
            "rawRecordId": candidate.raw_record_id,
            "sourceId": candidate.source_id,
            "acceptedRef": candidate.accepted_ref,
            "canonicalPayload": serde_json::from_str::<serde_json::Value>(&candidate.canonical_payload_json).unwrap_or(serde_json::Value::Null),
            "provenance": serde_json::from_str::<serde_json::Value>(&candidate.provenance_json).unwrap_or(serde_json::Value::Null),
            "lifecycle": {
                "promotionState": "promoted",
                "validatedBy": "external_experience_review",
                "writeBoundary": "llm_wiki_to_memory"
            }
        })),
        category: Some("external_experience".to_string()),
        source: Some(format!("external_experience::{}", candidate.id)),
        tags: Some(vec![
            "external-experience".to_string(),
            "llm-wiki".to_string(),
            candidate.candidate_kind.clone(),
        ]),
    }
}
