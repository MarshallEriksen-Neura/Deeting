use super::{PersistedPendingApproval, SuspendedChatToolExecution};

impl SuspendedChatToolExecution {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn pending_requires_approval_call_ids(
        &self,
    ) -> Vec<String> {
        self.pending_tool_call_meta()
            .into_iter()
            .filter(|item| {
                item.get("status")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
            })
            .filter_map(|item| {
                item.get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .collect()
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn sync_remaining_pending_approvals(
        &mut self,
        approved_token: &str,
    ) -> Vec<String> {
        let normalized_approved_token = approved_token.trim();
        let remaining_call_ids = self.pending_requires_approval_call_ids();
        if remaining_call_ids.is_empty() {
            self.pending_approvals.clear();
            return remaining_call_ids;
        }

        self.pending_approvals.retain(|pending| {
            if pending.approval_token.trim() == normalized_approved_token {
                return false;
            }

            let Some(call_id) = pending
                .call_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return true;
            };

            remaining_call_ids
                .iter()
                .any(|candidate| candidate == call_id)
        });

        remaining_call_ids
    }

    pub(crate) fn set_pending_approval_status(
        &mut self,
        approval_token: &str,
        status: &str,
    ) -> bool {
        let normalized_token = approval_token.trim();
        if normalized_token.is_empty() {
            return false;
        }
        let Some(pending) = self
            .pending_approvals
            .iter_mut()
            .find(|pending| pending.approval_token.trim() == normalized_token)
        else {
            return false;
        };
        pending.approval_status = Some(status.to_string());
        true
    }

    pub(crate) fn pending_approval_by_token(
        &self,
        approval_token: &str,
    ) -> Option<&PersistedPendingApproval> {
        let normalized_token = approval_token.trim();
        if normalized_token.is_empty() {
            return None;
        }
        self.pending_approvals
            .iter()
            .find(|pending| pending.approval_token.trim() == normalized_token)
    }

    pub(crate) fn pending_approvals(&self) -> &[PersistedPendingApproval] {
        &self.pending_approvals
    }
}
