//! Observation-only contract for the E3 phase-resolution cleanup gate.

pub(crate) const FRAME_PHASE_ALIGNMENT_METRIC: &str = "frame_phase_step_alignment";
pub(crate) const CONTRACT_SCHEMA_VERSION: i64 = 2;
pub(crate) const MINIMUM_OVERLAP_RATIO: f64 = 0.95;
pub(crate) const MINIMUM_NON_DIRECT_STRATEGY_RATIO: f64 = 0.01;
pub(crate) const MINIMUM_OBSERVATION_WINDOW_MS: i64 = 7 * 24 * 60 * 60 * 1000;
pub(crate) const OBSERVATION_WINDOW_LABEL: &str = "1-2w";

pub(crate) const FRAME_STRATEGY_STEP_MISSING: &str = "missing_frame_strategy_step";
pub(crate) const PHASE_ALIGNMENT_MATCHED: &str = "matched";
pub(crate) const PHASE_ALIGNMENT_MISMATCHED: &str = "mismatched";
pub(crate) const LEGACY_EFFECTIVE_PHASE_STEP_BASIS: &str = "legacy_effective_phase_step";

pub(crate) const WINDOW_START_NEGATIVE_ERROR: &str = "window_start_unix_ms must be non-negative";
pub(crate) const WINDOW_END_NEGATIVE_ERROR: &str = "window_end_unix_ms must be non-negative";
pub(crate) const WINDOW_REVERSED_ERROR: &str =
    "window_start_unix_ms must be less than or equal to window_end_unix_ms";

pub(crate) fn validate_frame_phase_alignment_readiness_window(
    window_start_unix_ms: Option<i64>,
    window_end_unix_ms: Option<i64>,
) -> Result<(), &'static str> {
    if matches!(window_start_unix_ms, Some(start) if start < 0) {
        return Err(WINDOW_START_NEGATIVE_ERROR);
    }
    if matches!(window_end_unix_ms, Some(end) if end < 0) {
        return Err(WINDOW_END_NEGATIVE_ERROR);
    }
    if matches!((window_start_unix_ms, window_end_unix_ms), (Some(start), Some(end)) if start > end)
    {
        return Err(WINDOW_REVERSED_ERROR);
    }

    Ok(())
}
