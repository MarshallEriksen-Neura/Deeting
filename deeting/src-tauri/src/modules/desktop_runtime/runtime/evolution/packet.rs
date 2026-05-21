//! Cold-start evolution packet builder.
//!
//! Composes a compact `ColdStartPacket` from priors + cases for a given task
//! fingerprint. Slice 3 fills all three sections:
//!   - `priors_summary` — top 3 actions across decision points for this
//!     fingerprint, formatted as a short prior-direction line. Read-only:
//!     `task_learning` remains the sole writer of `task_policy_priors`.
//!   - `reference_cases` — up to 2 successful exemplars.
//!   - `negative_cases` — up to 2 framings to avoid.
//!
//! Token budget (see plan Pre-work Decision 3):
//!   - 800 token total.
//!   - 200 token for priors (clamped at the source by character cap).
//!   - 600 token for cases — enforced by `enforce_case_budget` which drops the
//!     lowest-scoring case (by `confidence × recency_decay`) across both
//!     reference and negative lists until the budget is met. Drops are
//!     observable via `log::info!`.

use crate::modules::mcp::store::McpStore;

use super::store as evolution_store;
use super::types::{ColdStartCaseEntry, ColdStartPacket, EvolutionCase, EvolutionCaseType};

const CASE_FETCH_LIMIT: usize = 6;
const CASE_PACKET_PER_TYPE_LIMIT: usize = 2;

/// ~4 chars per token. Used as a cheap proxy for token counting without
/// pulling in a tokenizer dependency.
const CHARS_PER_TOKEN: usize = 4;

/// 200 token cap on `priors_summary`. Applied during summary construction.
const PRIORS_SUMMARY_TOKEN_BUDGET: usize = 200;
const PRIORS_SUMMARY_CHAR_BUDGET: usize = PRIORS_SUMMARY_TOKEN_BUDGET * CHARS_PER_TOKEN;

/// 600 token cap on the combined reference + negative case section. Enforced
/// by `enforce_case_budget` after both lists are populated.
const CASES_TOKEN_BUDGET: usize = 600;
const CASES_CHAR_BUDGET: usize = CASES_TOKEN_BUDGET * CHARS_PER_TOKEN;

/// Half-life used for case recency decay. Matches the value the Slice 1
/// `select_top_cases` already implements (~14 days; `exp(-age_days / 20)` is
/// half-life ≈ 13.9 days).
const CASE_HALFLIFE_DAYS: f64 = 20.0;

/// Half-life used for prior weight decay. Mirrors `task_learning::policy`'s
/// 21-day half-life so the rendered prior weights match what the bandit
/// would see at the same moment.
const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// How many prior rows to fetch from the store before ranking. Generous
/// upper bound; we keep the top `PRIORS_SUMMARY_LIMIT` after sorting.
const PRIOR_FETCH_LIMIT: usize = 32;
const PRIORS_SUMMARY_LIMIT: usize = 3;

/// Threshold for the `favor` / `avoid` disposition labels. Matches the
/// ±0.15 thresholds used by `sovereign::Advisory::gate_meta`.
const DISPOSITION_THRESHOLD: f64 = 0.15;

pub(crate) async fn build_cold_start_packet(
    store: &McpStore,
    fingerprint_key: &str,
) -> Result<ColdStartPacket, String> {
    let fp = fingerprint_key.trim();
    if fp.is_empty() {
        return Ok(ColdStartPacket::default());
    }

    let raw_negatives = evolution_store::list_cases_for_fingerprint(
        store,
        fp,
        EvolutionCaseType::Negative,
        CASE_FETCH_LIMIT,
    )
    .await?;
    let raw_references = evolution_store::list_cases_for_fingerprint(
        store,
        fp,
        EvolutionCaseType::Reference,
        CASE_FETCH_LIMIT,
    )
    .await?;

    let negative_cases = select_top_cases(raw_negatives, CASE_PACKET_PER_TYPE_LIMIT);
    let reference_cases = select_top_cases(raw_references, CASE_PACKET_PER_TYPE_LIMIT);
    let priors_summary = load_priors_summary(store, fp).await;

    let mut packet = ColdStartPacket {
        fingerprint_key: fp.to_string(),
        priors_summary,
        reference_cases,
        negative_cases,
    };

    enforce_case_budget(&mut packet);

    Ok(packet)
}

/// Read top priors for this fingerprint across all decision points and render
/// them as a short summary line. Returns `None` when there are no priors at
/// all.
///
/// Read-only: never writes back to `task_policy_priors`. Decay matches
/// `task_learning::policy::decay_weight` so the displayed weight equals what
/// the bandit currently sees.
async fn load_priors_summary(store: &McpStore, fingerprint_key: &str) -> Option<String> {
    let rows = match store
        .list_task_policy_priors(Some(fingerprint_key), None, 0, PRIOR_FETCH_LIMIT)
        .await
    {
        Ok(rows) => rows,
        Err(err) => {
            log::warn!(
                "evolution packet priors fetch failed fingerprint_key={} err={}",
                fingerprint_key,
                err
            );
            return None;
        }
    };
    if rows.is_empty() {
        return None;
    }

    let now = current_unix_ms();
    let mut scored: Vec<(f64, f64, f64, String, String)> = rows
        .into_iter()
        .map(|row| {
            let age_ms = (now - row.updated_at_unix_ms).max(0) as f64;
            let decay = 0.5_f64.powf(age_ms / PRIOR_HALF_LIFE_MS);
            let effective = row.weight * decay;
            (
                effective.abs(),
                effective,
                row.confidence,
                row.decision_point,
                row.action_key,
            )
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut lines = Vec::with_capacity(PRIORS_SUMMARY_LIMIT + 1);
    lines.push("Prior direction (from prior task runs):".to_string());
    for (_, effective, confidence, decision_point, action_key) in
        scored.into_iter().take(PRIORS_SUMMARY_LIMIT)
    {
        let disposition = disposition_label(effective);
        lines.push(format!(
            "- {}:{} ({}, weight {:+.2}, confidence {:.2})",
            decision_point, action_key, disposition, effective, confidence
        ));
    }
    if lines.len() <= 1 {
        return None;
    }
    Some(truncate_chars(
        &lines.join("\n"),
        PRIORS_SUMMARY_CHAR_BUDGET,
    ))
}

fn disposition_label(effective_weight: f64) -> &'static str {
    if effective_weight >= DISPOSITION_THRESHOLD {
        "favor"
    } else if effective_weight <= -DISPOSITION_THRESHOLD {
        "avoid"
    } else {
        "neutral"
    }
}

/// Char-based truncation that preserves multibyte boundaries.
fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", truncated)
}

/// Rank cases by `confidence × recency_decay`, drop lowest. Returns up to
/// `limit` entries shaped for the packet.
fn select_top_cases(cases: Vec<EvolutionCase>, limit: usize) -> Vec<ColdStartCaseEntry> {
    if cases.is_empty() || limit == 0 {
        return Vec::new();
    }
    let now = current_unix_ms();
    let mut scored: Vec<(f64, ColdStartCaseEntry)> = cases
        .into_iter()
        .map(|case| {
            let entry = ColdStartCaseEntry {
                summary: case.summary,
                confidence: case.confidence,
                created_at_unix_ms: case.created_at_unix_ms,
            };
            let score = entry.confidence * recency_decay(entry.created_at_unix_ms, now);
            (score, entry)
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, entry)| entry)
        .collect()
}

fn recency_decay(created_at_unix_ms: i64, now_unix_ms: i64) -> f64 {
    let age_ms = (now_unix_ms - created_at_unix_ms).max(0) as f64;
    let age_days = age_ms / (1000.0 * 60.0 * 60.0 * 24.0);
    (-age_days / CASE_HALFLIFE_DAYS).exp()
}

fn entry_score(entry: &ColdStartCaseEntry, now: i64) -> f64 {
    entry.confidence * recency_decay(entry.created_at_unix_ms, now)
}

fn cases_char_total(packet: &ColdStartPacket) -> usize {
    let ref_chars: usize = packet
        .reference_cases
        .iter()
        .map(|c| c.summary.chars().count())
        .sum();
    let neg_chars: usize = packet
        .negative_cases
        .iter()
        .map(|c| c.summary.chars().count())
        .sum();
    ref_chars + neg_chars
}

/// Drop the lowest-scored case (across reference + negative) until the
/// combined case section fits within `CASES_CHAR_BUDGET`. Each drop is logged
/// at info level so the budget pressure is observable in traces.
fn enforce_case_budget(packet: &mut ColdStartPacket) {
    let now = current_unix_ms();
    while cases_char_total(packet) > CASES_CHAR_BUDGET {
        let ref_min = packet
            .reference_cases
            .iter()
            .enumerate()
            .map(|(idx, entry)| (idx, entry_score(entry, now)))
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        let neg_min = packet
            .negative_cases
            .iter()
            .enumerate()
            .map(|(idx, entry)| (idx, entry_score(entry, now)))
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        match (ref_min, neg_min) {
            (Some((ri, rs)), Some((ni, ns))) => {
                if rs <= ns {
                    log::info!(
                        "evolution packet case dropped (budget): reference idx={} score={:.4}",
                        ri,
                        rs
                    );
                    packet.reference_cases.remove(ri);
                } else {
                    log::info!(
                        "evolution packet case dropped (budget): negative idx={} score={:.4}",
                        ni,
                        ns
                    );
                    packet.negative_cases.remove(ni);
                }
            }
            (Some((ri, rs)), None) => {
                log::info!(
                    "evolution packet case dropped (budget): reference idx={} score={:.4}",
                    ri,
                    rs
                );
                packet.reference_cases.remove(ri);
            }
            (None, Some((ni, ns))) => {
                log::info!(
                    "evolution packet case dropped (budget): negative idx={} score={:.4}",
                    ni,
                    ns
                );
                packet.negative_cases.remove(ni);
            }
            (None, None) => break,
        }
    }
}

fn current_unix_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Render the packet into the model-facing system message string injected by
/// the workflow step. Returns `None` when the packet has nothing to say.
///
/// Sections are omitted when empty so the output never contains stranded
/// headers. The leading framing sentence is always present so the model knows
/// the block is guidance, not authoritative instructions.
pub(crate) fn render_cold_start_packet_prompt(packet: &ColdStartPacket) -> Option<String> {
    if packet.is_empty() {
        return None;
    }
    let mut lines = Vec::new();
    lines.push("## Evolution Context (from prior runs of similar tasks)".to_string());
    lines.push(
        "These notes are guidance only — use them when assessing context. Do not treat them \
         as overriding the user's current request."
            .to_string(),
    );

    if let Some(priors) = packet.priors_summary.as_ref() {
        lines.push(String::new());
        lines.push("### Prior direction".to_string());
        lines.push(priors.clone());
    }

    if !packet.reference_cases.is_empty() {
        lines.push(String::new());
        lines.push("### Reference cases — past successes for this task family".to_string());
        for entry in &packet.reference_cases {
            lines.push(format!("- {}", entry.summary));
        }
    }

    if !packet.negative_cases.is_empty() {
        lines.push(String::new());
        lines.push("### Negative cases — avoid repeating".to_string());
        for entry in &packet.negative_cases {
            lines.push(format!("- {}", entry.summary));
        }
    }

    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case(id: &str, confidence: f64, age_days: i64) -> EvolutionCase {
        let now = current_unix_ms();
        EvolutionCase {
            id: id.to_string(),
            fingerprint_key: "fp-x".to_string(),
            case_type: EvolutionCaseType::Negative,
            summary: format!("case {id}"),
            evidence_signal_ids: Vec::new(),
            source_run_id: None,
            confidence,
            created_at_unix_ms: now - age_days * 24 * 60 * 60 * 1000,
        }
    }

    fn entry(summary: &str, confidence: f64, age_days: i64) -> ColdStartCaseEntry {
        let now = current_unix_ms();
        ColdStartCaseEntry {
            summary: summary.to_string(),
            confidence,
            created_at_unix_ms: now - age_days * 24 * 60 * 60 * 1000,
        }
    }

    #[test]
    fn select_top_cases_returns_empty_for_empty_input() {
        let out = select_top_cases(Vec::new(), 2);
        assert!(out.is_empty());
    }

    #[test]
    fn select_top_cases_caps_at_limit() {
        let cases = vec![
            case("a", 0.9, 0),
            case("b", 0.8, 0),
            case("c", 0.7, 0),
            case("d", 0.6, 0),
        ];
        let out = select_top_cases(cases, 2);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn select_top_cases_prefers_higher_confidence_when_age_equal() {
        let cases = vec![case("low", 0.3, 0), case("high", 0.95, 0)];
        let out = select_top_cases(cases, 1);
        assert_eq!(out.len(), 1);
        assert!(out[0].summary.contains("high"));
    }

    #[test]
    fn select_top_cases_prefers_recent_when_confidence_equal() {
        let cases = vec![case("old", 0.8, 60), case("fresh", 0.8, 0)];
        let out = select_top_cases(cases, 1);
        assert_eq!(out.len(), 1);
        assert!(out[0].summary.contains("fresh"));
    }

    #[test]
    fn render_returns_none_for_empty_packet() {
        let packet = ColdStartPacket::default();
        assert!(render_cold_start_packet_prompt(&packet).is_none());
    }

    #[test]
    fn render_includes_negative_section_when_negative_cases_present() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            negative_cases: vec![ColdStartCaseEntry {
                summary: "avoid X".to_string(),
                confidence: 0.9,
                created_at_unix_ms: 0,
            }],
            ..Default::default()
        };
        let rendered = render_cold_start_packet_prompt(&packet).expect("prompt");
        assert!(rendered.contains("Negative cases"));
        assert!(rendered.contains("avoid X"));
    }

    // ----- Slice 3: three-section rendering -----

    #[test]
    fn render_includes_all_three_sections_when_packet_full() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: Some(
                "Prior direction (from prior task runs):\n- route:direct (favor, weight +0.42, confidence 0.71)"
                    .to_string(),
            ),
            reference_cases: vec![entry("succeeded by trimming the answer", 0.85, 0)],
            negative_cases: vec![entry("avoid dumping the full transcript", 0.9, 0)],
        };
        let rendered = render_cold_start_packet_prompt(&packet).expect("prompt");
        assert!(rendered.contains("Prior direction"));
        assert!(rendered.contains("route:direct"));
        assert!(rendered.contains("Reference cases"));
        assert!(rendered.contains("trimming the answer"));
        assert!(rendered.contains("Negative cases"));
        assert!(rendered.contains("full transcript"));
    }

    #[test]
    fn render_with_priors_only_omits_case_sections() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: Some(
                "Prior direction (from prior task runs):\n- route:direct (favor, weight +0.30, confidence 0.60)"
                    .to_string(),
            ),
            reference_cases: Vec::new(),
            negative_cases: Vec::new(),
        };
        let rendered = render_cold_start_packet_prompt(&packet).expect("prompt");
        assert!(rendered.contains("Prior direction"));
        assert!(!rendered.contains("Reference cases"));
        assert!(!rendered.contains("Negative cases"));
    }

    #[test]
    fn render_with_reference_only_omits_priors_and_negative_sections() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: None,
            reference_cases: vec![entry("worked well", 0.8, 0)],
            negative_cases: Vec::new(),
        };
        let rendered = render_cold_start_packet_prompt(&packet).expect("prompt");
        assert!(!rendered.contains("Prior direction"));
        assert!(rendered.contains("Reference cases"));
        assert!(rendered.contains("worked well"));
        assert!(!rendered.contains("Negative cases"));
    }

    #[test]
    fn is_empty_returns_true_for_fully_empty_packet() {
        let packet = ColdStartPacket::default();
        assert!(packet.is_empty());
        assert!(render_cold_start_packet_prompt(&packet).is_none());
    }

    #[test]
    fn is_empty_returns_false_when_only_priors_present() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: Some("Prior direction (from prior task runs):\n- a".to_string()),
            reference_cases: Vec::new(),
            negative_cases: Vec::new(),
        };
        assert!(!packet.is_empty());
    }

    // ----- Slice 3: disposition labels -----

    #[test]
    fn disposition_label_thresholds() {
        assert_eq!(disposition_label(0.50), "favor");
        assert_eq!(disposition_label(0.15), "favor");
        assert_eq!(disposition_label(0.14), "neutral");
        assert_eq!(disposition_label(0.0), "neutral");
        assert_eq!(disposition_label(-0.10), "neutral");
        assert_eq!(disposition_label(-0.15), "avoid");
        assert_eq!(disposition_label(-0.80), "avoid");
    }

    // ----- Slice 3: token budget protection -----

    #[test]
    fn enforce_case_budget_no_op_when_under_budget() {
        let mut packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: None,
            reference_cases: vec![entry("short ref", 0.9, 0)],
            negative_cases: vec![entry("short neg", 0.9, 0)],
        };
        enforce_case_budget(&mut packet);
        assert_eq!(packet.reference_cases.len(), 1);
        assert_eq!(packet.negative_cases.len(), 1);
    }

    #[test]
    fn enforce_case_budget_drops_lowest_scored_cases_until_under_budget() {
        // Build a packet that's clearly over the 2400-char budget. Each entry
        // ~600 chars; five entries → 3000 chars total. Highest score should
        // survive, lowest should be dropped first.
        let long_summary = |id: usize| -> String { format!("entry-{}: {}", id, "x".repeat(600)) };
        let mut packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: None,
            reference_cases: vec![
                entry(&long_summary(1), 0.95, 0), // top score
                entry(&long_summary(2), 0.50, 0),
                entry(&long_summary(3), 0.10, 60), // worst score (low conf + old)
            ],
            negative_cases: vec![
                entry(&long_summary(4), 0.80, 0),
                entry(&long_summary(5), 0.20, 30),
            ],
        };
        enforce_case_budget(&mut packet);
        // Under budget after pruning.
        assert!(
            cases_char_total(&packet) <= CASES_CHAR_BUDGET,
            "after enforce total_chars={} budget={}",
            cases_char_total(&packet),
            CASES_CHAR_BUDGET
        );
        // The highest-scored entry (entry-1, 0.95 confidence, age 0) must be
        // preserved.
        let kept_refs: Vec<&str> = packet
            .reference_cases
            .iter()
            .map(|e| e.summary.as_str())
            .collect();
        assert!(
            kept_refs.iter().any(|s| s.contains("entry-1")),
            "highest-scored reference entry should survive; kept={:?}",
            kept_refs
        );
        // The lowest-scored entry (entry-3, low conf + 60d age) must be gone.
        let all_kept: Vec<&str> = packet
            .reference_cases
            .iter()
            .chain(packet.negative_cases.iter())
            .map(|e| e.summary.as_str())
            .collect();
        assert!(
            !all_kept.iter().any(|s| s.contains("entry-3")),
            "lowest-scored entry should be dropped first; kept={:?}",
            all_kept
        );
    }

    #[test]
    fn enforce_case_budget_handles_only_reference_or_only_negative() {
        let long = "x".repeat(2000);
        let mut packet = ColdStartPacket {
            fingerprint_key: "fp-x".to_string(),
            priors_summary: None,
            reference_cases: vec![
                entry(&format!("ref-low {}", long), 0.10, 30),
                entry(&format!("ref-high {}", long), 0.95, 0),
            ],
            negative_cases: Vec::new(),
        };
        enforce_case_budget(&mut packet);
        assert!(cases_char_total(&packet) <= CASES_CHAR_BUDGET);
        let kept: Vec<&str> = packet
            .reference_cases
            .iter()
            .map(|e| e.summary.as_str())
            .collect();
        assert!(
            kept.iter().any(|s| s.contains("ref-high")),
            "high-scored entry should survive; kept={:?}",
            kept
        );
    }

    #[test]
    fn truncate_chars_keeps_short_text_intact() {
        assert_eq!(truncate_chars("hello", 32), "hello");
    }

    #[test]
    fn truncate_chars_clamps_long_text_with_ellipsis() {
        let long = "a".repeat(400);
        let truncated = truncate_chars(&long, 100);
        let char_count = truncated.chars().count();
        assert_eq!(char_count, 100);
        assert!(truncated.ends_with('…'));
    }
}
