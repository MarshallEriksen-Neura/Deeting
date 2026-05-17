use super::*;

fn case(id: &str, expected: &[&str]) -> EvalCase {
    EvalCase {
        id: id.to_string(),
        query: format!("query for {id}"),
        expected_chunk_ids: expected.iter().map(|s| (*s).to_string()).collect(),
        expected_source: None,
        notes: None,
    }
}

fn item(chunk_id: &str, score: f64) -> RetrievedItem {
    RetrievedItem {
        chunk_id: chunk_id.to_string(),
        source: "knowledge".to_string(),
        score,
    }
}

fn metric_value(metrics: &[KMetric], k: usize) -> f64 {
    metrics
        .iter()
        .find(|m| m.k == k)
        .map(|m| m.value)
        .expect("k value should be present in metrics")
}

#[test]
fn evaluate_case_marks_hit_at_first_rank_when_top_result_matches() {
    let c = case("q1", &["chunk-a"]);
    let retrieved = vec![item("chunk-a", 0.9), item("chunk-b", 0.4)];

    let result = evaluate_case(&c, &retrieved, &[1, 5]);

    assert_eq!(result.first_hit_rank, Some(1));
    assert_eq!(metric_value(&result.hit_at_k, 1), 1.0);
    assert_eq!(metric_value(&result.hit_at_k, 5), 1.0);
}

#[test]
fn evaluate_case_misses_at_k1_when_expected_chunk_is_not_top_result() {
    let c = case("q2", &["chunk-x"]);
    let retrieved = vec![
        item("chunk-a", 0.9),
        item("chunk-b", 0.4),
        item("chunk-x", 0.3),
    ];

    let result = evaluate_case(&c, &retrieved, &[1, 5]);

    assert_eq!(result.first_hit_rank, Some(3));
    assert_eq!(metric_value(&result.hit_at_k, 1), 0.0);
    assert_eq!(metric_value(&result.hit_at_k, 5), 1.0);
}

#[test]
fn evaluate_case_reports_no_hit_when_retrieval_is_empty() {
    let c = case("q3", &["chunk-y"]);
    let retrieved: Vec<RetrievedItem> = vec![];

    let result = evaluate_case(&c, &retrieved, &[1, 5]);

    assert!(result.first_hit_rank.is_none());
    assert_eq!(metric_value(&result.hit_at_k, 1), 0.0);
    assert_eq!(metric_value(&result.hit_at_k, 5), 0.0);
    assert_eq!(result.retrieved_count, 0);
}

#[test]
fn evaluate_case_uses_any_hit_semantics_for_multi_expected() {
    let c = case("q4", &["chunk-a", "chunk-b"]);
    let retrieved = vec![item("chunk-b", 0.7)];

    let result = evaluate_case(&c, &retrieved, &[1]);

    assert_eq!(result.first_hit_rank, Some(1));
    assert_eq!(metric_value(&result.hit_at_k, 1), 1.0);
}

#[test]
fn aggregate_computes_mean_recall_and_mrr() {
    let c1 = case("q1", &["c1"]);
    let c2 = case("q2", &["c2"]);
    let r1 = evaluate_case(&c1, &[item("c1", 0.9)], &[1, 5]);
    let r2 = evaluate_case(
        &c2,
        &[item("other", 0.5), item("c2", 0.4)],
        &[1, 5],
    );

    let report = aggregate(vec![r1, r2], &[1, 5]);

    // recall@1 = (1 + 0) / 2 = 0.5
    // recall@5 = (1 + 1) / 2 = 1.0
    // mrr = (1/1 + 1/2) / 2 = 0.75
    assert_eq!(report.case_count, 2);
    assert!((metric_value(&report.recall_at_k, 1) - 0.5).abs() < 1e-9);
    assert!((metric_value(&report.recall_at_k, 5) - 1.0).abs() < 1e-9);
    assert!((report.mrr - 0.75).abs() < 1e-9);
}

#[test]
fn aggregate_handles_empty_input() {
    let report = aggregate(vec![], &[1, 5]);

    assert_eq!(report.case_count, 0);
    assert_eq!(report.mrr, 0.0);
    assert!(report.recall_at_k.iter().all(|m| m.value == 0.0));
}

#[test]
fn aggregate_treats_missing_first_hit_as_zero_reciprocal_rank() {
    let c1 = case("q1", &["c1"]);
    let c2 = case("q2", &["unreachable"]);
    let r1 = evaluate_case(&c1, &[item("c1", 0.9)], &[1]);
    let r2 = evaluate_case(&c2, &[item("other", 0.4)], &[1]);

    let report = aggregate(vec![r1, r2], &[1]);

    // mrr = (1/1 + 0) / 2 = 0.5
    assert!((report.mrr - 0.5).abs() < 1e-9);
}

#[test]
fn case_id_is_preserved_in_result() {
    let c = case("specific-id-42", &["c"]);

    let result = evaluate_case(&c, &[], &[1]);

    assert_eq!(result.case_id, "specific-id-42");
}

#[tokio::test]
async fn run_eval_invokes_retriever_once_per_case_and_aggregates() {
    let cases = vec![case("q1", &["c1"]), case("q2", &["c2"])];
    let calls = std::cell::RefCell::new(0u32);
    let lookup = |c: &EvalCase| {
        *calls.borrow_mut() += 1;
        let retrieved = match c.id.as_str() {
            "q1" => vec![item("c1", 0.9)],
            "q2" => vec![item("nope", 0.5), item("c2", 0.3)],
            _ => vec![],
        };
        async move { retrieved }
    };

    let report = run_eval(&cases, &[1, 5], lookup).await;

    assert_eq!(*calls.borrow(), 2);
    assert_eq!(report.case_count, 2);
    assert!((metric_value(&report.recall_at_k, 5) - 1.0).abs() < 1e-9);
}
