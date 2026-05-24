use super::inflight_pending_approval_parse::pending_approval_record_from_tool_call_meta;
use super::{now_unix_ms_i64, PersistedPendingApproval};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_pending_approval_records_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
    default_session_id: &str,
) -> Vec<PersistedPendingApproval> {
    let now = now_unix_ms_i64() as i128;
    tool_call_meta
        .iter()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
        })
        .filter_map(|item| {
            pending_approval_record_from_tool_call_meta(item, default_session_id, now)
        })
        .collect()
}
