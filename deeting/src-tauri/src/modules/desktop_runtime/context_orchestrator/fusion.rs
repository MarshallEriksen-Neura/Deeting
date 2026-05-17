//! Reciprocal Rank Fusion (RRF) for multi-query retrieval inside a single source.
//!
//! RRF is a parameter-free, source-agnostic merge for multiple ranked lists.
//! Given lists `L1..Ln` (each ranked top-to-bottom), for every item:
//!
//! ```text
//! fused_score(item) = Σ over Li containing item: 1 / (k_constant + rank_in_Li)
//! ```
//!
//! Items present in multiple lists naturally rise; absent items contribute 0.
//! The constant `k = 60` is the value reported by Cormack et al. (2009) and
//! is the de-facto default in the literature.
//!
//! # No Double Lifecycle Rule
//!
//! This module is **allowed** to fuse multiple result lists that came from
//! the *same source's* native retrieval under *different queries*. It does
//! NOT re-judge any single item — it only **combines existing rankings**.
//! The fused output preserves each item's original source-native `score`;
//! the RRF aggregate score is written to `score_breakdown.fused_rrf_score`,
//! never to `item.score`.
//!
//! It is **forbidden** to use RRF across different sources (memory + wiki +
//! knowledge). That would force a cross-source comparison of source-native
//! scores, which is precisely what the No Double Lifecycle Rule prohibits.
//! The `auto` mode of `context_search` keeps each source's envelope separate
//! for exactly this reason. Multi-query fanout is *intra-source* fusion.

use std::collections::HashMap;

use crate::modules::desktop_runtime::context_orchestrator::envelope::{
    ContextEvidenceEnvelope, ContextEvidenceItem,
};

/// Standard RRF constant from Cormack et al. (2009). Larger values flatten
/// the contribution of top ranks; smaller values amplify them.
pub const DEFAULT_RRF_K: usize = 60;

/// Where a particular item appeared in a particular query's results.
#[derive(Debug, Clone, PartialEq)]
pub struct RrfQueryAppearance {
    pub query_index: usize,
    /// 1-based rank within that query's list.
    pub rank: usize,
    /// The source-native score the item carried in that query's envelope.
    /// Recorded only for diagnostics — never used in the fusion formula.
    pub source_score: f64,
}

/// Output of `rrf_fuse`: the original (deduplicated) item plus the fused
/// RRF score and the per-query rank trace.
#[derive(Debug, Clone)]
pub struct RrfFusedItem {
    pub item: ContextEvidenceItem,
    pub fused_rrf_score: f64,
    pub appearances: Vec<RrfQueryAppearance>,
}

/// Fuse multiple envelopes from the **same source** via RRF.
///
/// Items are deduplicated by `ContextEvidenceItem.id`. Output is sorted by
/// fused RRF score descending and truncated to `limit`.
///
/// # Caller contract
///
/// All `envelopes` must come from the same `source_type`. Callers must
/// enforce this; this function does not check (and cannot, since fusion is
/// a numerical operation that does not need to introspect the source).
pub fn rrf_fuse(
    envelopes: &[ContextEvidenceEnvelope],
    k_constant: usize,
    limit: usize,
) -> Vec<RrfFusedItem> {
    let mut acc: HashMap<String, (ContextEvidenceItem, f64, Vec<RrfQueryAppearance>)> =
        HashMap::new();

    for (query_index, env) in envelopes.iter().enumerate() {
        for (rank0, item) in env.items.iter().enumerate() {
            let rank = rank0 + 1;
            let contrib = 1.0 / (k_constant as f64 + rank as f64);
            let entry = acc
                .entry(item.id.clone())
                .or_insert_with(|| (item.clone(), 0.0, Vec::new()));
            entry.1 += contrib;
            entry.2.push(RrfQueryAppearance {
                query_index,
                rank,
                source_score: item.score,
            });
        }
    }

    let mut fused: Vec<RrfFusedItem> = acc
        .into_values()
        .map(|(item, fused_score, mut appearances)| {
            appearances.sort_by_key(|a| a.query_index);
            RrfFusedItem {
                item,
                fused_rrf_score: fused_score,
                appearances,
            }
        })
        .collect();

    fused.sort_by(|a, b| {
        b.fused_rrf_score
            .partial_cmp(&a.fused_rrf_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                // Stable secondary order: prefer items that appeared in more
                // queries (broader consensus); then by best (lowest) rank.
                b.appearances.len().cmp(&a.appearances.len()).then_with(|| {
                    a.appearances
                        .iter()
                        .map(|x| x.rank)
                        .min()
                        .unwrap_or(usize::MAX)
                        .cmp(
                            &b.appearances
                                .iter()
                                .map(|x| x.rank)
                                .min()
                                .unwrap_or(usize::MAX),
                        )
                })
            })
    });
    fused.truncate(limit);
    fused
}
