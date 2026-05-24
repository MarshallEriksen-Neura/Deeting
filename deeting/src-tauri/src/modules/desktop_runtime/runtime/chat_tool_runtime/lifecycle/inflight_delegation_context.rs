use super::{now_unix_ms_i64, PersistedDelegationWait};

pub(super) fn build_persisted_delegation_wait(
    delegated_kind: &str,
    delegated_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
) -> Option<PersistedDelegationWait> {
    let normalized_delegated_run_id = delegated_run_id.trim().to_string();
    (!normalized_delegated_run_id.is_empty()).then(|| PersistedDelegationWait {
        kind: delegated_kind.trim().to_string(),
        delegated_run_id: normalized_delegated_run_id,
        delegated_target_id: target_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        delegated_target_name: target_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        resume_policy: "on_completed".to_string(),
        consumed_event_ids: Vec::new(),
        last_status: last_status
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        result_ref: None,
        started_at_unix_ms: now_unix_ms_i64(),
    })
}
