//! Retrieval evaluation harness.
//!
//! Pure-logic metric library for measuring RAG retrieval quality. Knows
//! nothing about `AppState`, database, or any specific source — the caller
//! supplies a retriever closure and the harness computes:
//!
//! - **recall@k** (any-hit semantics): for each k value, the fraction of
//!   cases where at least one expected chunk appeared in the top-k results
//! - **MRR** (mean reciprocal rank): average of `1 / first_hit_rank` across
//!   cases, where cases with no hit contribute 0
//!
//! # Scope
//!
//! This harness only evaluates the **retrieval layer**. Answer faithfulness
//! and citation accuracy require an LLM in the loop and are intentionally
//! out of scope here — keep this module deterministic and offline-runnable.
//!
//! # Wiring example (not shipped — owned by the eval runner)
//!
//! ```ignore
//! let cases: Vec<EvalCase> =
//!     serde_json::from_str(&std::fs::read_to_string("golden_set.json")?)?;
//! let report = run_eval(&cases, &[1, 3, 5, 10], |case| async {
//!     app_state
//!         .knowledge
//!         .store
//!         .search_local_knowledge_chunks(&case.query, Some(10))
//!         .await
//!         .unwrap_or_default()
//!         .into_iter()
//!         .map(|hit| RetrievedItem {
//!             chunk_id: hit.chunk_id,
//!             source: "knowledge".into(),
//!             score: hit.score,
//!         })
//!         .collect()
//! })
//! .await;
//! std::fs::write("eval_report.json", serde_json::to_string_pretty(&report)?)?;
//! ```

use std::collections::HashSet;
use std::future::Future;

use serde::{Deserialize, Serialize};

/// A single evaluation question with the expected correct chunk ids.
///
/// `expected_chunk_ids` uses **any-hit semantics**: as long as *one* of the
/// listed ids appears in the top-k results, the case is counted as a hit.
/// This matches how RAG is usually graded in practice — most questions have
/// a small set of acceptable supporting passages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalCase {
    pub id: String,
    pub query: String,
    pub expected_chunk_ids: Vec<String>,
    #[serde(default)]
    pub expected_source: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// A single chunk returned by the retriever under test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievedItem {
    pub chunk_id: String,
    pub source: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KMetric {
    pub k: usize,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseResult {
    pub case_id: String,
    pub retrieved_count: usize,
    /// 1-based rank of the first expected chunk that appeared in the
    /// retrieved list. `None` if no expected chunk was retrieved at all.
    pub first_hit_rank: Option<usize>,
    /// `value` is 1.0 or 0.0 per `k` (any-hit semantics).
    pub hit_at_k: Vec<KMetric>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalReport {
    pub case_count: usize,
    /// Mean recall@k across all cases.
    pub recall_at_k: Vec<KMetric>,
    /// Mean reciprocal rank across all cases. Cases that retrieved no
    /// expected chunk contribute 0 to the average.
    pub mrr: f64,
    pub cases: Vec<CaseResult>,
}

pub fn evaluate_case(
    case: &EvalCase,
    retrieved: &[RetrievedItem],
    k_values: &[usize],
) -> CaseResult {
    let expected: HashSet<&str> = case
        .expected_chunk_ids
        .iter()
        .map(|id| id.as_str())
        .collect();

    let first_hit_rank = retrieved
        .iter()
        .position(|item| expected.contains(item.chunk_id.as_str()))
        .map(|index| index + 1);

    let hit_at_k = k_values
        .iter()
        .copied()
        .map(|k| {
            let any_hit = retrieved
                .iter()
                .take(k)
                .any(|item| expected.contains(item.chunk_id.as_str()));
            KMetric {
                k,
                value: if any_hit { 1.0 } else { 0.0 },
            }
        })
        .collect();

    CaseResult {
        case_id: case.id.clone(),
        retrieved_count: retrieved.len(),
        first_hit_rank,
        hit_at_k,
    }
}

pub fn aggregate(cases: Vec<CaseResult>, k_values: &[usize]) -> EvalReport {
    let case_count = cases.len();
    if case_count == 0 {
        return EvalReport {
            case_count: 0,
            recall_at_k: k_values
                .iter()
                .copied()
                .map(|k| KMetric { k, value: 0.0 })
                .collect(),
            mrr: 0.0,
            cases,
        };
    }

    let recall_at_k = k_values
        .iter()
        .copied()
        .map(|k| {
            let sum: f64 = cases
                .iter()
                .map(|c| {
                    c.hit_at_k
                        .iter()
                        .find(|metric| metric.k == k)
                        .map(|metric| metric.value)
                        .unwrap_or(0.0)
                })
                .sum();
            KMetric {
                k,
                value: sum / case_count as f64,
            }
        })
        .collect();

    let mrr = cases
        .iter()
        .map(|c| {
            c.first_hit_rank
                .map(|rank| 1.0 / rank as f64)
                .unwrap_or(0.0)
        })
        .sum::<f64>()
        / case_count as f64;

    EvalReport {
        case_count,
        recall_at_k,
        mrr,
        cases,
    }
}

/// Drive a full eval pass. `retriever` is called once per case and returns
/// the items the retrieval engine produced for that query.
pub async fn run_eval<F, Fut>(
    cases: &[EvalCase],
    k_values: &[usize],
    mut retriever: F,
) -> EvalReport
where
    F: FnMut(&EvalCase) -> Fut,
    Fut: Future<Output = Vec<RetrievedItem>>,
{
    let mut case_results = Vec::with_capacity(cases.len());
    for case in cases {
        let retrieved = retriever(case).await;
        case_results.push(evaluate_case(case, &retrieved, k_values));
    }
    aggregate(case_results, k_values)
}

#[cfg(test)]
mod tests;
