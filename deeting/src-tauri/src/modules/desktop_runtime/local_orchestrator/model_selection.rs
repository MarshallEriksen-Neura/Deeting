use serde_json::Value;

use crate::modules::ai_upstream::types::LocalModelConnection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LocalModelSelectionMode {
    Pool,
    ExactProvider,
}

impl LocalModelSelectionMode {
    pub(super) fn from_input(raw: Option<&str>, compare_only: bool) -> Self {
        if compare_only {
            return Self::ExactProvider;
        }

        match raw
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("exact_provider") => Self::ExactProvider,
            _ => Self::Pool,
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Pool => "pool",
            Self::ExactProvider => "exact_provider",
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct LocalConversationModelBinding {
    pub(crate) pinned_model_key: Option<String>,
    pub(crate) pinned_provider_model_id: Option<String>,
    pub(crate) pinned_binding_source: Option<String>,
}

pub(super) fn extract_local_conversation_model_binding(
    meta: Option<&serde_json::Value>,
) -> Option<LocalConversationModelBinding> {
    let meta = meta?.as_object()?;
    let pinned_model_key = meta
        .get("pinned_model_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let pinned_provider_model_id = meta
        .get("pinned_provider_model_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let pinned_binding_source = meta
        .get("pinned_binding_source")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if pinned_model_key.is_none()
        && pinned_provider_model_id.is_none()
        && pinned_binding_source.is_none()
    {
        None
    } else {
        Some(LocalConversationModelBinding {
            pinned_model_key,
            pinned_provider_model_id,
            pinned_binding_source,
        })
    }
}

pub(super) fn reusable_pinned_provider_model_id<'a>(
    binding: Option<&'a LocalConversationModelBinding>,
    requested_model: &str,
) -> Option<&'a str> {
    let binding = binding?;
    let pinned_provider_model_id = binding
        .pinned_provider_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let requested_model = requested_model.trim();
    if requested_model.is_empty() {
        return Some(pinned_provider_model_id);
    }

    let matches_requested_pool = binding
        .pinned_model_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.eq_ignore_ascii_case(requested_model))
        .unwrap_or(false);
    let matches_requested_provider = pinned_provider_model_id.eq_ignore_ascii_case(requested_model);
    if matches_requested_pool || matches_requested_provider {
        Some(pinned_provider_model_id)
    } else {
        None
    }
}

pub(super) fn pool_request_matches_model_connection(
    requested_model: &str,
    connection: &LocalModelConnection,
) -> bool {
    let requested_model = requested_model.trim();
    if requested_model.is_empty() {
        return true;
    }

    connection
        .provider_model_id
        .eq_ignore_ascii_case(requested_model)
        || connection.model_id.eq_ignore_ascii_case(requested_model)
        || connection
            .logical_model_key
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(requested_model))
            .unwrap_or(false)
}


