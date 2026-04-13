#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteGuardDecision {
    Add,
    Update,
    Noop,
}

pub(crate) const DEFAULT_WRITE_GUARD_NOOP_THRESHOLD: f32 = 0.95;
pub(crate) const DEFAULT_WRITE_GUARD_UPDATE_THRESHOLD: f32 = 0.85;

pub(crate) const DEFAULT_VITALITY_BASE_WEIGHT: f32 = 0.7;
pub(crate) const DEFAULT_VITALITY_DECAY_WEIGHT: f32 = 0.3;
pub(crate) const DEFAULT_VITALITY_DECAY_RATE: f32 = 0.05;
pub(crate) const DEFAULT_VITALITY_TOUCH_INCREMENT: f32 = 0.08;
pub(crate) const DEFAULT_VITALITY_RERANK_OVERFETCH_FACTOR: usize = 3;

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

pub(crate) fn vitality_multiplier(
    vitality: Option<f32>,
    reference_timestamp: &str,
    now: time::OffsetDateTime,
) -> f32 {
    let vitality = vitality.unwrap_or(1.0);
    let days_since_access = parse_days_since(reference_timestamp, now);
    let decay = (-DEFAULT_VITALITY_DECAY_RATE * days_since_access).exp();
    DEFAULT_VITALITY_BASE_WEIGHT + DEFAULT_VITALITY_DECAY_WEIGHT * vitality * decay
}

pub(crate) fn touched_vitality(current: Option<f32>) -> f32 {
    (current.unwrap_or(1.0) + DEFAULT_VITALITY_TOUCH_INCREMENT).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::{
        decide_write_guard_action, parse_days_since, touched_vitality, vitality_multiplier,
        WriteGuardDecision,
    };

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
    fn vitality_multiplier_decays_with_older_timestamps() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let recent = vitality_multiplier(Some(1.0), "2026-03-07T23:00:00Z", now);
        let stale = vitality_multiplier(Some(1.0), "2026-02-01T00:00:00Z", now);
        assert!(recent > stale);
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
