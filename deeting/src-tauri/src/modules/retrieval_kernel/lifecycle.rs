use serde_json::Value;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteGuardDecision {
    Add,
    Update,
    Noop,
}

#[allow(dead_code)]
pub(crate) const DEFAULT_WRITE_GUARD_NOOP_THRESHOLD: f32 = 0.95;
#[allow(dead_code)]
pub(crate) const DEFAULT_WRITE_GUARD_UPDATE_THRESHOLD: f32 = 0.85;

pub(crate) const DEFAULT_VITALITY_TOUCH_INCREMENT: f32 = 0.08;
pub(crate) const DEFAULT_VITALITY_RERANK_OVERFETCH_FACTOR: usize = 3;
const LN_2: f32 = 0.6931472;

const MEMORY_PROFILE_STABLE_HALF_LIFE_DAYS: f32 = 120.0;
const MEMORY_PROFILE_STABLE_FLOOR: f32 = 0.60;
const MEMORY_PROFILE_WIKI_HALF_LIFE_DAYS: f32 = 90.0;
const MEMORY_PROFILE_WIKI_FLOOR: f32 = 0.55;
const MEMORY_PROFILE_CURRENT_FACT_HALF_LIFE_DAYS: f32 = 14.0;
const MEMORY_PROFILE_CURRENT_FACT_FLOOR: f32 = 0.20;
const MEMORY_PROFILE_EPISODIC_HALF_LIFE_DAYS: f32 = 7.0;
const MEMORY_PROFILE_EPISODIC_FLOOR: f32 = 0.10;
const MEMORY_PROFILE_GENERAL_HALF_LIFE_DAYS: f32 = 30.0;
const MEMORY_PROFILE_GENERAL_FLOOR: f32 = 0.25;

const WIKI_FRESHNESS_PIVOT_DAYS: f32 = 180.0;
const WIKI_FRESHNESS_EXPONENT: f32 = 0.15;
const WIKI_FRESHNESS_FLOOR: f32 = 0.85;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemoryDecayProfile {
    Protected,
    StablePreference,
    DurableWikiConclusion,
    CurrentFact,
    SessionEpisodic,
    General,
}

#[allow(dead_code)]
pub(crate) fn decide_write_guard_action(score: Option<f32>) -> WriteGuardDecision {
    match score {
        Some(value) if value >= DEFAULT_WRITE_GUARD_NOOP_THRESHOLD => WriteGuardDecision::Noop,
        Some(value) if value >= DEFAULT_WRITE_GUARD_UPDATE_THRESHOLD => WriteGuardDecision::Update,
        _ => WriteGuardDecision::Add,
    }
}

pub(crate) fn parse_days_since(timestamp: &str, now: time::OffsetDateTime) -> f32 {
    time::OffsetDateTime::parse(timestamp, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|t| {
            let duration = now - t;
            (duration.whole_seconds() as f32 / 86400.0).max(0.0)
        })
        .unwrap_or(0.0)
}

fn metadata_value<'a>(meta: Option<&'a Value>, path: &str) -> Option<&'a Value> {
    let mut current = meta?;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn metadata_bool(meta: Option<&Value>, paths: &[&str]) -> bool {
    paths.iter().any(|path| {
        metadata_value(meta, path)
            .and_then(Value::as_bool)
            .unwrap_or(false)
    })
}

fn normalized_ascii(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn exponential_half_life_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
    floor: f32,
    half_life_days: f32,
) -> f32 {
    let vitality = vitality.unwrap_or(1.0).clamp(0.0, 1.0);
    let days_since = parse_days_since(reference_timestamp, now);
    let decay = (-LN_2 * days_since / half_life_days.max(0.5)).exp();
    (floor + (1.0 - floor) * vitality * decay).clamp(floor, 1.0)
}

fn power_law_freshness_multiplier(
    reference_timestamp: &str,
    now: time::OffsetDateTime,
    floor: f32,
    pivot_days: f32,
    exponent: f32,
) -> f32 {
    let days_since = parse_days_since(reference_timestamp, now);
    let freshness = (1.0 + (days_since / pivot_days.max(1.0))).powf(-exponent.max(0.0));
    (floor + (1.0 - floor) * freshness).clamp(floor, 1.0)
}

fn classify_memory_decay_profile(
    category: Option<&str>,
    source: Option<&str>,
    session_id: Option<&str>,
    meta_info: Option<&Value>,
) -> MemoryDecayProfile {
    if metadata_bool(
        meta_info,
        &[
            "pinned",
            "manual_override",
            "manualOverride",
            "lifecycle.pinned",
            "lifecycle.manualOverride",
        ],
    ) {
        return MemoryDecayProfile::Protected;
    }

    let category = normalized_ascii(category);
    let source = normalized_ascii(source);

    if category.contains("llm_wiki") || source.contains("llm_wiki") {
        return MemoryDecayProfile::DurableWikiConclusion;
    }

    if category.contains("identity")
        || category.contains("persona")
        || category.contains("profile")
        || category.contains("preference")
    {
        return MemoryDecayProfile::StablePreference;
    }

    if category == "fact"
        || category.contains("current")
        || source.contains("auto_extract")
        || source.contains("auto-extract")
        || source.contains("auto_extraction")
        || source.contains("fact")
    {
        return MemoryDecayProfile::CurrentFact;
    }

    if session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return MemoryDecayProfile::SessionEpisodic;
    }

    MemoryDecayProfile::General
}

pub(crate) fn memory_recency_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
    category: Option<&str>,
    source: Option<&str>,
    session_id: Option<&str>,
    meta_info: Option<&Value>,
) -> f32 {
    match classify_memory_decay_profile(category, source, session_id, meta_info) {
        MemoryDecayProfile::Protected => 1.0,
        MemoryDecayProfile::StablePreference => exponential_half_life_multiplier(
            vitality,
            reference_timestamp,
            now,
            MEMORY_PROFILE_STABLE_FLOOR,
            MEMORY_PROFILE_STABLE_HALF_LIFE_DAYS,
        ),
        MemoryDecayProfile::DurableWikiConclusion => exponential_half_life_multiplier(
            vitality,
            reference_timestamp,
            now,
            MEMORY_PROFILE_WIKI_FLOOR,
            MEMORY_PROFILE_WIKI_HALF_LIFE_DAYS,
        ),
        MemoryDecayProfile::CurrentFact => exponential_half_life_multiplier(
            vitality,
            reference_timestamp,
            now,
            MEMORY_PROFILE_CURRENT_FACT_FLOOR,
            MEMORY_PROFILE_CURRENT_FACT_HALF_LIFE_DAYS,
        ),
        MemoryDecayProfile::SessionEpisodic => exponential_half_life_multiplier(
            vitality,
            reference_timestamp,
            now,
            MEMORY_PROFILE_EPISODIC_FLOOR,
            MEMORY_PROFILE_EPISODIC_HALF_LIFE_DAYS,
        ),
        MemoryDecayProfile::General => exponential_half_life_multiplier(
            vitality,
            reference_timestamp,
            now,
            MEMORY_PROFILE_GENERAL_FLOOR,
            MEMORY_PROFILE_GENERAL_HALF_LIFE_DAYS,
        ),
    }
}

pub(crate) fn wiki_freshness_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
) -> f32 {
    let vitality = vitality.unwrap_or(1.0).clamp(0.0, 1.0);
    let freshness = power_law_freshness_multiplier(
        reference_timestamp,
        now,
        WIKI_FRESHNESS_FLOOR,
        WIKI_FRESHNESS_PIVOT_DAYS,
        WIKI_FRESHNESS_EXPONENT,
    );
    let vitality_bonus = 0.97 + 0.03 * vitality;
    (freshness * vitality_bonus).clamp(WIKI_FRESHNESS_FLOOR * 0.97, 1.0)
}

pub(crate) fn touched_vitality(current: Option<f32>) -> f32 {
    (current.unwrap_or(1.0) + DEFAULT_VITALITY_TOUCH_INCREMENT).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::{
        decide_write_guard_action, memory_recency_multiplier, parse_days_since, touched_vitality,
        wiki_freshness_multiplier, WriteGuardDecision,
    };
    use serde_json::json;

    #[test]
    fn write_guard_decision_uses_shared_thresholds() {
        assert_eq!(decide_write_guard_action(None), WriteGuardDecision::Add);
        assert_eq!(
            decide_write_guard_action(Some(0.2)),
            WriteGuardDecision::Add
        );
        assert_eq!(
            decide_write_guard_action(Some(0.85)),
            WriteGuardDecision::Update
        );
        assert_eq!(
            decide_write_guard_action(Some(0.95)),
            WriteGuardDecision::Noop
        );
    }

    #[test]
    fn memory_recency_prefers_stable_profiles_over_session_ephemera() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let stable = memory_recency_multiplier(
            Some(1.0),
            "2026-01-01T00:00:00Z",
            now,
            Some("preference"),
            Some("manual"),
            None,
            None,
        );
        let episodic = memory_recency_multiplier(
            Some(1.0),
            "2026-01-01T00:00:00Z",
            now,
            None,
            None,
            Some("session-1"),
            None,
        );

        assert!(stable > episodic);
    }

    #[test]
    fn memory_recency_protects_pinned_items_from_time_decay() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let multiplier = memory_recency_multiplier(
            Some(0.2),
            "2025-01-01T00:00:00Z",
            now,
            Some("fact"),
            Some("auto_extraction"),
            Some("session-1"),
            Some(&json!({ "lifecycle": { "pinned": true } })),
        );

        assert_eq!(multiplier, 1.0);
    }

    #[test]
    fn wiki_freshness_is_gentler_than_memory_decay_for_old_entries() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let wiki = wiki_freshness_multiplier(Some(1.0), "2025-01-01T00:00:00Z", now);
        let memory = memory_recency_multiplier(
            Some(1.0),
            "2025-01-01T00:00:00Z",
            now,
            None,
            None,
            Some("session-1"),
            None,
        );

        assert!(wiki > memory);
    }

    #[test]
    fn touched_vitality_increments_and_caps() {
        assert!((touched_vitality(Some(0.5)) - 0.58).abs() < f32::EPSILON);
        assert_eq!(touched_vitality(Some(0.97)), 1.0);
        assert_eq!(touched_vitality(None), 1.0);
    }

    #[test]
    fn parse_days_since_handles_invalid_timestamp() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        assert_eq!(parse_days_since("invalid", now), 0.0);
    }
}
