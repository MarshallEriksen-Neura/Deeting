use serde_json::{json, Value};

use crate::modules::memory::types::CreateLocalMemoryRequest;
use crate::modules::retrieval_kernel::write_guard::{WriteGuardCandidate, WriteGuardProfile};

const MIN_SUPERSESSION_SCORE_FACT: f32 = 0.74;
const MIN_SUPERSESSION_SCORE_WIKI: f32 = 0.80;
const SUPERSEDED_RANK_MULTIPLIER: f32 = 0.35;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SupersessionDecision {
    pub(crate) target_memory_id: String,
    pub(crate) claim_key: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedClaim {
    subject: String,
    predicate: String,
    value: String,
    temporal_scope: TemporalScope,
    claim_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TemporalScope {
    Current,
    Historical,
    Unknown,
}

pub(crate) fn find_supersession_target(
    profile: WriteGuardProfile,
    payload: &CreateLocalMemoryRequest,
    candidates: &[WriteGuardCandidate],
) -> Option<SupersessionDecision> {
    if !matches!(
        profile,
        WriteGuardProfile::AutoExtractedFact | WriteGuardProfile::WikiPromotion
    ) {
        return None;
    }

    let new_claim = parse_claim(payload.content.as_str())?;
    let min_score = match profile {
        WriteGuardProfile::AutoExtractedFact => MIN_SUPERSESSION_SCORE_FACT,
        WriteGuardProfile::WikiPromotion => MIN_SUPERSESSION_SCORE_WIKI,
        WriteGuardProfile::ManualMemory => return None,
    };

    candidates.iter().find_map(|candidate| {
        if candidate_is_superseded(candidate.meta_info.as_ref())
            || candidate.exact_score < min_score
        {
            return None;
        }

        let old_claim = parse_claim(candidate.content.as_str())?;
        if new_claim.claim_key != old_claim.claim_key || values_equivalent(&new_claim, &old_claim) {
            return None;
        }

        if !temporal_dominance(&new_claim, &old_claim, candidate.exact_score) {
            return None;
        }

        Some(SupersessionDecision {
            target_memory_id: candidate.id.clone(),
            claim_key: new_claim.claim_key.clone(),
            reason: if matches!(new_claim.temporal_scope, TemporalScope::Current)
                && !matches!(old_claim.temporal_scope, TemporalScope::Current)
            {
                "temporal_update".to_string()
            } else {
                "conflicting_claim_update".to_string()
            },
        })
    })
}

pub(crate) fn candidate_is_superseded(meta: Option<&Value>) -> bool {
    metadata_path(meta, "lifecycle.claim_state")
        .and_then(Value::as_str)
        .map(|value| value.eq_ignore_ascii_case("superseded"))
        .unwrap_or(false)
}

pub(crate) fn supersession_rank_multiplier(meta: Option<&Value>) -> f32 {
    if candidate_is_superseded(meta) {
        SUPERSEDED_RANK_MULTIPLIER
    } else {
        1.0
    }
}

pub(crate) fn mark_new_memory_as_superseding(
    current_meta: Option<&Value>,
    superseded_memory_id: &str,
    claim_key: &str,
    reason: &str,
    now: &str,
) -> Value {
    let mut object = current_meta
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let lifecycle = ensure_object_field(&mut object, "lifecycle");
    lifecycle.insert("claim_state".to_string(), json!("active"));
    lifecycle.insert("claimKey".to_string(), json!(claim_key));
    lifecycle.insert("lastValidatedAt".to_string(), json!(now));
    lifecycle.insert("supersededBy".to_string(), Value::Null);
    let supersedes = lifecycle
        .get("supersedes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut supersedes = supersedes
        .into_iter()
        .filter_map(|value| value.as_str().map(|text| text.to_string()))
        .collect::<Vec<_>>();
    if !supersedes.iter().any(|value| value == superseded_memory_id) {
        supersedes.push(superseded_memory_id.to_string());
    }
    lifecycle.insert("supersedes".to_string(), json!(supersedes));
    lifecycle.insert("supersessionReason".to_string(), json!(reason));
    Value::Object(object)
}

pub(crate) fn mark_existing_memory_as_superseded(
    current_meta: Option<&Value>,
    replacement_memory_id: &str,
    claim_key: &str,
    reason: &str,
    now: &str,
) -> Value {
    let mut object = current_meta
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let lifecycle = ensure_object_field(&mut object, "lifecycle");
    lifecycle.insert("claim_state".to_string(), json!("superseded"));
    lifecycle.insert("claimKey".to_string(), json!(claim_key));
    lifecycle.insert("supersededBy".to_string(), json!(replacement_memory_id));
    lifecycle.insert("supersededAt".to_string(), json!(now));
    lifecycle.insert("lastValidatedAt".to_string(), json!(now));
    lifecycle.insert("supersessionReason".to_string(), json!(reason));
    Value::Object(object)
}

fn parse_claim(text: &str) -> Option<ParsedClaim> {
    let normalized = normalize_text(text);
    if normalized.is_empty() {
        return None;
    }

    let temporal_scope = detect_temporal_scope(&normalized);
    let temporal_stripped = strip_temporal_markers(&normalized);
    let patterns = [
        ("works on", "works_on"),
        ("works at", "works_at"),
        ("lives in", "lives_in"),
        ("mainly uses", "primary_tool"),
        ("primarily uses", "primary_tool"),
        ("uses", "uses"),
        ("prefers", "prefers"),
        ("likes", "likes"),
        ("dislikes", "dislikes"),
        ("is", "is"),
        ("are", "is"),
        ("was", "is"),
        ("were", "is"),
    ];

    for (pattern, predicate) in patterns {
        let needle = format!(" {} ", pattern);
        if let Some(index) = temporal_stripped.find(&needle) {
            let subject = temporal_stripped[..index].trim();
            let value = temporal_stripped[index + needle.len()..].trim();
            if value.is_empty() {
                return None;
            }
            let subject = if subject.is_empty() {
                "entity".to_string()
            } else {
                subject.to_string()
            };
            let claim_key = format!("{}::{}", subject, predicate);
            return Some(ParsedClaim {
                subject,
                predicate: predicate.to_string(),
                value: value.to_string(),
                temporal_scope,
                claim_key,
            });
        }
    }

    None
}

fn normalize_text(text: &str) -> String {
    let cleaned = text
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn detect_temporal_scope(text: &str) -> TemporalScope {
    if [
        "currently",
        "right now",
        "now",
        "today",
        "these days",
        "as of now",
    ]
    .iter()
    .any(|marker| text.contains(marker))
    {
        TemporalScope::Current
    } else if [
        "used to",
        "previously",
        "formerly",
        "before",
        "earlier",
        "once",
    ]
    .iter()
    .any(|marker| text.contains(marker))
    {
        TemporalScope::Historical
    } else {
        TemporalScope::Unknown
    }
}

fn strip_temporal_markers(text: &str) -> String {
    let mut stripped = text.to_string();
    for marker in [
        "currently",
        "right now",
        "today",
        "these days",
        "as of now",
        "used to",
        "previously",
        "formerly",
        "earlier",
    ] {
        stripped = stripped.replace(marker, "");
    }
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn values_equivalent(left: &ParsedClaim, right: &ParsedClaim) -> bool {
    left.value == right.value
        || left.value.contains(right.value.as_str())
        || right.value.contains(left.value.as_str())
}

fn temporal_dominance(new_claim: &ParsedClaim, old_claim: &ParsedClaim, score: f32) -> bool {
    match (new_claim.temporal_scope, old_claim.temporal_scope) {
        (TemporalScope::Historical, _) => false,
        (TemporalScope::Current, TemporalScope::Current) => true,
        (TemporalScope::Current, _) => true,
        (TemporalScope::Unknown, TemporalScope::Historical) => true,
        (TemporalScope::Unknown, TemporalScope::Unknown) => score >= 0.88,
        _ => false,
    }
}

fn metadata_path<'a>(meta: Option<&'a Value>, path: &str) -> Option<&'a Value> {
    let mut current = meta?;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn ensure_object_field<'a>(
    object: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> &'a mut serde_json::Map<String, Value> {
    if !object.get(key).map(Value::is_object).unwrap_or(false) {
        object.insert(key.to_string(), Value::Object(serde_json::Map::new()));
    }
    object
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .expect("object field")
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_is_superseded, find_supersession_target, mark_existing_memory_as_superseded,
        mark_new_memory_as_superseding, supersession_rank_multiplier, WriteGuardCandidate,
        WriteGuardProfile,
    };
    use crate::modules::memory::types::CreateLocalMemoryRequest;
    use serde_json::json;

    fn candidate(id: &str, content: &str, score: f32) -> WriteGuardCandidate {
        WriteGuardCandidate {
            id: id.to_string(),
            content: content.to_string(),
            session_id: None,
            capability_id: None,
            meta_info: None,
            category: Some("fact".to_string()),
            source: Some("auto_extraction".to_string()),
            tags: None,
            vitality: Some(1.0),
            last_accessed_at: None,
            created_at: "2026-04-14T00:00:00Z".to_string(),
            updated_at: "2026-04-14T00:00:00Z".to_string(),
            exact_score: score,
        }
    }

    #[test]
    fn detects_supersession_for_same_slot_updated_value() {
        let decision = find_supersession_target(
            WriteGuardProfile::AutoExtractedFact,
            &CreateLocalMemoryRequest {
                content: "user currently uses claude".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("auto_extraction".to_string()),
                tags: None,
            },
            &[candidate("old", "user previously uses gpt 4", 0.91)],
        )
        .expect("supersession decision");

        assert_eq!(decision.target_memory_id, "old");
    }

    #[test]
    fn rank_multiplier_demotes_superseded_claims() {
        let meta = json!({"lifecycle": {"claim_state": "superseded"}});
        assert!(candidate_is_superseded(Some(&meta)));
        assert!(supersession_rank_multiplier(Some(&meta)) < 1.0);
    }

    #[test]
    fn writes_bidirectional_supersession_metadata() {
        let new_meta =
            mark_new_memory_as_superseding(None, "old-id", "user::uses", "reason", "now");
        let old_meta =
            mark_existing_memory_as_superseded(None, "new-id", "user::uses", "reason", "now");
        assert_eq!(
            new_meta["lifecycle"]["supersedes"][0].as_str(),
            Some("old-id")
        );
        assert_eq!(
            old_meta["lifecycle"]["supersededBy"].as_str(),
            Some("new-id")
        );
    }
}
