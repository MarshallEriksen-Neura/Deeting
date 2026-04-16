use serde_json::Value;

use crate::modules::memory::types::{CreateLocalMemoryRequest, LocalMemoryItem};
use crate::modules::retrieval_kernel::lifecycle::memory_recency_multiplier;

const DYNAMIC_THRESHOLD_MAX_BOOST: f32 = 0.04;
const DYNAMIC_THRESHOLD_TOP2_FLOOR: f32 = 0.70;
const DYNAMIC_THRESHOLD_RATIO_BASELINE: f32 = 0.85;
const IMPORTANCE_PROTECT_THRESHOLD: f32 = 0.75;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteGuardCoreAction {
    Add,
    Update,
    Noop,
    Ambiguous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteGuardProfile {
    ManualMemory,
    AutoExtractedFact,
    WikiPromotion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteGuardScopeMode {
    #[allow(dead_code)]
    Global,
    PayloadFilters,
}

#[derive(Debug, Clone)]
pub(crate) struct WriteGuardPolicy {
    pub(crate) base_update_threshold: f32,
    pub(crate) base_noop_threshold: f32,
    pub(crate) min_gap: f32,
    pub(crate) max_ratio: f32,
    pub(crate) allow_auto_merge: bool,
    pub(crate) protected_noop_threshold: f32,
    pub(crate) scope_mode: WriteGuardScopeMode,
}

#[derive(Debug, Clone)]
pub(crate) struct WriteGuardCandidate {
    pub(crate) id: String,
    pub(crate) content: String,
    pub(crate) session_id: Option<String>,
    pub(crate) capability_id: Option<String>,
    pub(crate) meta_info: Option<Value>,
    pub(crate) category: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) tags: Option<Vec<String>>,
    pub(crate) vitality: Option<f32>,
    pub(crate) last_accessed_at: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) exact_score: f32,
}

impl WriteGuardCandidate {
    pub(crate) fn to_memory_item(&self) -> LocalMemoryItem {
        LocalMemoryItem {
            id: self.id.clone(),
            content: self.content.clone(),
            session_id: self.session_id.clone(),
            capability_id: self.capability_id.clone(),
            meta_info: self.meta_info.clone(),
            embedding_model: None,
            category: self.category.clone(),
            source: self.source.clone(),
            tags: self.tags.clone(),
            vitality: self.vitality,
            last_accessed_at: self.last_accessed_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct WriteGuardDecisionDetail {
    pub(crate) action: WriteGuardCoreAction,
    pub(crate) reason: String,
    pub(crate) top1_score: Option<f32>,
    pub(crate) top2_score: Option<f32>,
    pub(crate) score_gap: Option<f32>,
    pub(crate) score_ratio: Option<f32>,
    pub(crate) effective_update_threshold: f32,
    pub(crate) effective_noop_threshold: f32,
    pub(crate) protected_existing: bool,
    pub(crate) selected_existing_id: Option<String>,
}

pub(crate) fn policy_for_profile(profile: WriteGuardProfile) -> WriteGuardPolicy {
    match profile {
        WriteGuardProfile::ManualMemory => WriteGuardPolicy {
            base_update_threshold: 0.92,
            base_noop_threshold: 0.985,
            min_gap: 0.04,
            max_ratio: 0.975,
            allow_auto_merge: true,
            protected_noop_threshold: 0.995,
            scope_mode: WriteGuardScopeMode::PayloadFilters,
        },
        WriteGuardProfile::AutoExtractedFact => WriteGuardPolicy {
            base_update_threshold: 0.86,
            base_noop_threshold: 0.96,
            min_gap: 0.03,
            max_ratio: 0.98,
            allow_auto_merge: true,
            protected_noop_threshold: 0.99,
            scope_mode: WriteGuardScopeMode::PayloadFilters,
        },
        WriteGuardProfile::WikiPromotion => WriteGuardPolicy {
            base_update_threshold: 0.93,
            base_noop_threshold: 0.99,
            min_gap: 0.05,
            max_ratio: 0.97,
            allow_auto_merge: true,
            protected_noop_threshold: 0.997,
            scope_mode: WriteGuardScopeMode::PayloadFilters,
        },
    }
}

pub(crate) fn decide_write_guard(
    profile: WriteGuardProfile,
    _payload: &CreateLocalMemoryRequest,
    candidates: &[WriteGuardCandidate],
    now: time::OffsetDateTime,
) -> WriteGuardDecisionDetail {
    let policy = policy_for_profile(profile);
    let Some(top1) = candidates.first() else {
        return WriteGuardDecisionDetail {
            action: WriteGuardCoreAction::Add,
            reason: "no_candidate".to_string(),
            top1_score: None,
            top2_score: None,
            score_gap: None,
            score_ratio: None,
            effective_update_threshold: policy.base_update_threshold,
            effective_noop_threshold: policy.base_noop_threshold,
            protected_existing: false,
            selected_existing_id: None,
        };
    };

    let top1_score = top1.exact_score.clamp(0.0, 1.0);
    let top2_score = candidates
        .get(1)
        .map(|candidate| candidate.exact_score.clamp(0.0, 1.0));
    let score_gap = top2_score.map(|score| (top1_score - score).max(0.0));
    let score_ratio = top2_score.and_then(|score| {
        if top1_score <= f32::EPSILON {
            None
        } else {
            Some((score / top1_score).clamp(0.0, 1.0))
        }
    });

    let dynamic_boost = dynamic_threshold_boost(top2_score, score_gap, score_ratio);
    let protection = candidate_protection(top1, now);
    let protection_boost = (protection.score * 0.03).min(DYNAMIC_THRESHOLD_MAX_BOOST);
    let effective_update_threshold =
        (policy.base_update_threshold + dynamic_boost + protection_boost).clamp(0.0, 0.999);
    let effective_noop_threshold =
        (policy.base_noop_threshold + dynamic_boost + protection_boost * 0.5).clamp(0.0, 0.9995);

    let protected_existing = protection.is_protected;
    let selected_existing_id = Some(top1.id.clone());

    if top1_score < effective_update_threshold {
        return WriteGuardDecisionDetail {
            action: WriteGuardCoreAction::Add,
            reason: "below_update_threshold".to_string(),
            top1_score: Some(top1_score),
            top2_score,
            score_gap,
            score_ratio,
            effective_update_threshold,
            effective_noop_threshold,
            protected_existing,
            selected_existing_id,
        };
    }

    if let (Some(gap), Some(ratio)) = (score_gap, score_ratio) {
        if gap < policy.min_gap || ratio > policy.max_ratio {
            return WriteGuardDecisionDetail {
                action: WriteGuardCoreAction::Ambiguous,
                reason: "ambiguous_candidate_set".to_string(),
                top1_score: Some(top1_score),
                top2_score,
                score_gap: Some(gap),
                score_ratio: Some(ratio),
                effective_update_threshold,
                effective_noop_threshold,
                protected_existing,
                selected_existing_id,
            };
        }
    }

    if protected_existing {
        let protected_noop_threshold =
            effective_noop_threshold.max(policy.protected_noop_threshold);
        if top1_score >= protected_noop_threshold {
            return WriteGuardDecisionDetail {
                action: WriteGuardCoreAction::Noop,
                reason: "protected_existing_near_duplicate".to_string(),
                top1_score: Some(top1_score),
                top2_score,
                score_gap,
                score_ratio,
                effective_update_threshold,
                effective_noop_threshold: protected_noop_threshold,
                protected_existing,
                selected_existing_id,
            };
        }
        return WriteGuardDecisionDetail {
            action: WriteGuardCoreAction::Add,
            reason: "protected_existing".to_string(),
            top1_score: Some(top1_score),
            top2_score,
            score_gap,
            score_ratio,
            effective_update_threshold,
            effective_noop_threshold: protected_noop_threshold,
            protected_existing,
            selected_existing_id,
        };
    }

    if top1_score >= effective_noop_threshold {
        return WriteGuardDecisionDetail {
            action: WriteGuardCoreAction::Noop,
            reason: "high_similarity_duplicate".to_string(),
            top1_score: Some(top1_score),
            top2_score,
            score_gap,
            score_ratio,
            effective_update_threshold,
            effective_noop_threshold,
            protected_existing,
            selected_existing_id,
        };
    }

    if policy.allow_auto_merge {
        return WriteGuardDecisionDetail {
            action: WriteGuardCoreAction::Update,
            reason: "confident_unique_match".to_string(),
            top1_score: Some(top1_score),
            top2_score,
            score_gap,
            score_ratio,
            effective_update_threshold,
            effective_noop_threshold,
            protected_existing,
            selected_existing_id,
        };
    }

    WriteGuardDecisionDetail {
        action: WriteGuardCoreAction::Add,
        reason: "auto_merge_disabled".to_string(),
        top1_score: Some(top1_score),
        top2_score,
        score_gap,
        score_ratio,
        effective_update_threshold,
        effective_noop_threshold,
        protected_existing,
        selected_existing_id,
    }
}

fn dynamic_threshold_boost(
    top2_score: Option<f32>,
    score_gap: Option<f32>,
    score_ratio: Option<f32>,
) -> f32 {
    let top2_boost = top2_score
        .map(|score| ((score - DYNAMIC_THRESHOLD_TOP2_FLOOR).max(0.0) * 0.2).min(0.02))
        .unwrap_or(0.0);
    let gap_boost = score_gap
        .map(|gap| ((0.08 - gap).max(0.0) * 0.25).min(0.015))
        .unwrap_or(0.0);
    let ratio_boost = score_ratio
        .map(|ratio| ((ratio - DYNAMIC_THRESHOLD_RATIO_BASELINE).max(0.0) * 0.1).min(0.015))
        .unwrap_or(0.0);

    (top2_boost + gap_boost + ratio_boost).min(DYNAMIC_THRESHOLD_MAX_BOOST)
}

#[derive(Debug, Clone, Copy)]
struct CandidateProtection {
    score: f32,
    is_protected: bool,
}

fn candidate_protection(
    candidate: &WriteGuardCandidate,
    now: time::OffsetDateTime,
) -> CandidateProtection {
    let pinned = metadata_bool(candidate.meta_info.as_ref(), &["pinned", "is_pinned"])
        || metadata_bool(candidate.meta_info.as_ref(), &["lifecycle.pinned"]);
    let manual_override =
        metadata_bool(
            candidate.meta_info.as_ref(),
            &["manual_override", "manualOverride"],
        ) || metadata_bool(candidate.meta_info.as_ref(), &["lifecycle.manualOverride"]);
    let explicit_importance = metadata_importance(candidate.meta_info.as_ref());
    let tag_boost = candidate
        .tags
        .as_ref()
        .map(|tags| {
            if tags.iter().any(|tag| {
                matches!(
                    tag.trim().to_ascii_lowercase().as_str(),
                    "important" | "pinned" | "critical" | "favorite" | "stable-conclusion"
                )
            }) {
                0.2
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);
    let category_boost = match candidate
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("llm_wiki") => 0.12,
        Some("fact") => 0.08,
        _ => 0.0,
    };
    let source_boost = candidate
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .map(|value| {
            if value.contains("llm_wiki_automation") {
                0.1
            } else if value.contains("manual") {
                0.08
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);

    let explicit = explicit_importance.unwrap_or(0.0);
    let freshness_reference = candidate.last_accessed_at.as_deref().unwrap_or_else(|| {
        if candidate.updated_at.trim().is_empty() {
            candidate.created_at.as_str()
        } else {
            candidate.updated_at.as_str()
        }
    });
    let freshness = memory_recency_multiplier(
        candidate.vitality,
        freshness_reference,
        now,
        candidate.category.as_deref(),
        candidate.source.as_deref(),
        candidate.session_id.as_deref(),
        candidate.meta_info.as_ref(),
    );
    let vitality_score = candidate.vitality.unwrap_or(1.0).clamp(0.0, 1.0);

    let score = if pinned || manual_override {
        1.0
    } else {
        (explicit * 0.5
            + freshness * 0.2
            + vitality_score * 0.1
            + tag_boost
            + category_boost
            + source_boost)
            .clamp(0.0, 1.0)
    };

    CandidateProtection {
        score,
        is_protected: pinned || manual_override || score >= IMPORTANCE_PROTECT_THRESHOLD,
    }
}

fn metadata_importance(meta: Option<&Value>) -> Option<f32> {
    let direct = metadata_value(meta, &["importance"]);
    let nested = metadata_value(meta, &["lifecycle.importance"]);
    direct
        .or(nested)
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64().map(|raw| raw as f32),
            Value::String(text) => Some(match text.trim().to_ascii_lowercase().as_str() {
                "critical" => 1.0,
                "high" => 0.9,
                "medium" => 0.6,
                "low" => 0.3,
                _ => 0.0,
            }),
            _ => None,
        })
        .map(|value| value.clamp(0.0, 1.0))
}

fn metadata_bool(meta: Option<&Value>, paths: &[&str]) -> bool {
    paths.iter().any(|path| {
        metadata_value(meta, &[path])
            .and_then(Value::as_bool)
            .unwrap_or(false)
    })
}

fn metadata_value<'a>(meta: Option<&'a Value>, paths: &[&str]) -> Option<&'a Value> {
    paths.iter().find_map(|path| {
        let mut current = meta?;
        for segment in path.split('.') {
            current = current.get(segment)?;
        }
        Some(current)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decide_write_guard, policy_for_profile, WriteGuardCandidate, WriteGuardCoreAction,
        WriteGuardProfile,
    };
    use serde_json::json;

    fn candidate(
        id: &str,
        score: f32,
        meta_info: Option<serde_json::Value>,
        vitality: Option<f32>,
        last_accessed_at: Option<&str>,
    ) -> WriteGuardCandidate {
        WriteGuardCandidate {
            id: id.to_string(),
            content: format!("memory {}", id),
            session_id: None,
            capability_id: None,
            meta_info,
            category: Some("fact".to_string()),
            source: Some("manual".to_string()),
            tags: None,
            vitality,
            last_accessed_at: last_accessed_at.map(str::to_string),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            exact_score: score,
        }
    }

    #[test]
    fn manual_profile_is_scoped_and_conservative() {
        let policy = policy_for_profile(WriteGuardProfile::ManualMemory);
        assert!(policy.base_update_threshold > 0.9);
        assert!(policy.base_noop_threshold > policy.base_update_threshold);
    }

    #[test]
    fn ambiguous_candidates_prefer_add() {
        let now = time::OffsetDateTime::parse(
            "2026-04-14T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let detail = decide_write_guard(
            WriteGuardProfile::WikiPromotion,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("llm_wiki".to_string()),
                source: Some("llm_wiki_automation::workspace-1".to_string()),
                tags: None,
            },
            &[
                candidate("a", 0.97, None, Some(1.0), Some("2026-04-14T00:00:00Z")),
                candidate("b", 0.95, None, Some(1.0), Some("2026-04-14T00:00:00Z")),
            ],
            now,
        );
        assert_eq!(detail.action, WriteGuardCoreAction::Ambiguous);
        assert_eq!(detail.reason, "ambiguous_candidate_set");
    }

    #[test]
    fn protected_existing_only_noops_for_near_duplicates() {
        let now = time::OffsetDateTime::parse(
            "2026-04-14T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let add_detail = decide_write_guard(
            WriteGuardProfile::ManualMemory,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("manual".to_string()),
                tags: None,
            },
            &[candidate(
                "protected",
                0.985,
                Some(json!({"pinned": true})),
                Some(1.0),
                Some("2026-04-14T00:00:00Z"),
            )],
            now,
        );
        assert_eq!(add_detail.action, WriteGuardCoreAction::Add);
        assert!(add_detail.protected_existing);

        let noop_detail = decide_write_guard(
            WriteGuardProfile::ManualMemory,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("manual".to_string()),
                tags: None,
            },
            &[candidate(
                "protected",
                0.999,
                Some(json!({"pinned": true})),
                Some(1.0),
                Some("2026-04-14T00:00:00Z"),
            )],
            now,
        );
        assert_eq!(noop_detail.action, WriteGuardCoreAction::Noop);
    }

    #[test]
    fn dynamic_thresholds_stay_bounded() {
        let now = time::OffsetDateTime::parse(
            "2026-04-14T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let detail = decide_write_guard(
            WriteGuardProfile::AutoExtractedFact,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("auto_extraction".to_string()),
                tags: None,
            },
            &[
                candidate("a", 0.91, None, Some(0.4), Some("2026-04-01T00:00:00Z")),
                candidate("b", 0.89, None, Some(0.4), Some("2026-04-01T00:00:00Z")),
                candidate("c", 0.88, None, Some(0.4), Some("2026-04-01T00:00:00Z")),
            ],
            now,
        );
        assert!(detail.effective_update_threshold >= 0.86);
        assert!(detail.effective_update_threshold <= 0.93);
        assert!(detail.effective_noop_threshold >= 0.96);
        assert!(detail.effective_noop_threshold <= 0.9995);
    }

    #[test]
    fn fresh_high_vitality_candidate_is_more_protected() {
        let now = time::OffsetDateTime::parse(
            "2026-04-14T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let fresh = decide_write_guard(
            WriteGuardProfile::ManualMemory,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("manual".to_string()),
                tags: None,
            },
            &[candidate(
                "fresh",
                0.99,
                Some(json!({"importance": "medium"})),
                Some(1.0),
                Some("2026-04-13T23:00:00Z"),
            )],
            now,
        );
        let stale = decide_write_guard(
            WriteGuardProfile::ManualMemory,
            &crate::modules::memory::types::CreateLocalMemoryRequest {
                content: "candidate".to_string(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                category: Some("fact".to_string()),
                source: Some("manual".to_string()),
                tags: None,
            },
            &[candidate(
                "stale",
                0.99,
                Some(json!({"importance": "medium"})),
                Some(0.2),
                Some("2026-02-01T00:00:00Z"),
            )],
            now,
        );
        assert!(fresh.effective_update_threshold > stale.effective_update_threshold);
    }
}
