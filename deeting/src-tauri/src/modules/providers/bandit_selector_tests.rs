#![cfg(test)]

use super::bandit_selector::{
    is_in_cooldown, score_arm, score_epsilon_greedy, score_success_rate, score_thompson, score_ucb,
    select_arm, BanditConfig, BanditStrategy,
};
use crate::modules::providers::types::BanditArmState;
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::collections::HashMap;

fn arm(arm_id: &str, alpha: f64, beta: f64, successes: i64, failures: i64) -> BanditArmState {
    BanditArmState {
        id: arm_id.to_string(),
        provider_model_id: None,
        scene: "test".to_string(),
        arm_id: Some(arm_id.to_string()),
        reward_metric_type: None,
        strategy: "thompson".to_string(),
        epsilon: 0.1,
        alpha,
        beta,
        total_trials: successes + failures,
        successes,
        failures,
        total_latency_ms: 0,
        latency_p95_ms: None,
        total_cost: 0.0,
        last_reward: 0.0,
        cooldown_until: None,
        version: 1,
        created_at: "1970-01-01T00:00:00Z".to_string(),
        updated_at: "1970-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn strategy_parse_accepts_known_values() {
    assert_eq!(BanditStrategy::parse("thompson"), Some(BanditStrategy::Thompson));
    assert_eq!(BanditStrategy::parse("UCB1"), Some(BanditStrategy::Ucb));
    assert_eq!(
        BanditStrategy::parse("epsilon_greedy"),
        Some(BanditStrategy::EpsilonGreedy)
    );
    assert_eq!(BanditStrategy::parse("unknown"), None);
}

#[test]
fn strategy_parse_or_falls_back() {
    assert_eq!(
        BanditStrategy::parse_or("garbage", BanditStrategy::EpsilonGreedy),
        BanditStrategy::EpsilonGreedy
    );
}

#[test]
fn thompson_cold_start_is_bounded_and_stochastic() {
    let cfg = BanditConfig::default();
    let mut rng = StdRng::seed_from_u64(42);
    let samples: Vec<f64> = (0..32).map(|_| score_thompson(None, &cfg, &mut rng)).collect();
    for s in &samples {
        assert!((0.0..=1.0).contains(s), "sample {} out of [0,1]", s);
    }
    let mean: f64 = samples.iter().sum::<f64>() / samples.len() as f64;
    assert!(mean > 0.2 && mean < 0.8, "Beta(1,1) mean should be ~0.5, got {}", mean);
}

#[test]
fn thompson_prefers_confidently_successful_arm_on_average() {
    let cfg = BanditConfig::default();
    let mut rng = StdRng::seed_from_u64(7);
    let winner = arm("winner", 50.0, 5.0, 49, 4);
    let loser = arm("loser", 5.0, 50.0, 4, 49);
    let mut winner_wins = 0;
    for _ in 0..200 {
        let w = score_thompson(Some(&winner), &cfg, &mut rng);
        let l = score_thompson(Some(&loser), &cfg, &mut rng);
        if w > l {
            winner_wins += 1;
        }
    }
    assert!(winner_wins > 180, "winner should dominate, got {}/200", winner_wins);
}

#[test]
fn ucb_cold_start_maximises_exploration() {
    let cfg = BanditConfig::default();
    assert_eq!(score_ucb(None, &cfg), 1.0);
    let undertrained = arm("x", 1.0, 1.0, 1, 0);
    assert_eq!(score_ucb(Some(&undertrained), &cfg), 1.0);
}

#[test]
fn ucb_formula_matches_reference() {
    let cfg = BanditConfig { ucb_c: 2.0, ucb_min_trials: 1, ..BanditConfig::default() };
    let state = arm("x", 1.0, 1.0, 3, 1);
    let score = score_ucb(Some(&state), &cfg);
    let expected = 0.75 + 2.0 * ((5.0_f64.ln()) / 4.0).sqrt();
    assert!((score - expected).abs() < 1e-9, "{} vs {}", score, expected);
}

#[test]
fn epsilon_greedy_pure_exploitation_when_epsilon_zero() {
    let cfg = BanditConfig { epsilon: 0.0, ..BanditConfig::default() };
    let mut rng = StdRng::seed_from_u64(1);
    let state = arm("x", 1.0, 1.0, 7, 3);
    assert!((score_epsilon_greedy(Some(&state), &cfg, &mut rng) - 0.7).abs() < 1e-9);
}

#[test]
fn success_rate_handles_edges() {
    assert_eq!(score_success_rate(None), 0.0);
    let empty = arm("x", 1.0, 1.0, 0, 0);
    assert_eq!(score_success_rate(Some(&empty)), 0.0);
    let state = arm("x", 1.0, 1.0, 3, 1);
    assert!((score_success_rate(Some(&state)) - 0.75).abs() < 1e-9);
}

#[test]
fn cooldown_filters_out_candidate() {
    let mut frozen = arm("frozen", 1.0, 1.0, 5, 5);
    frozen.cooldown_until = Some("9999-12-31T23:59:59Z".to_string());
    assert!(is_in_cooldown(&frozen, "2025-01-01T00:00:00Z"));
    let free = arm("free", 1.0, 1.0, 5, 5);
    assert!(!is_in_cooldown(&free, "2025-01-01T00:00:00Z"));
}

#[test]
fn select_arm_skips_cooldown_arms() {
    let mut a = arm("a", 1.0, 1.0, 100, 0);
    a.cooldown_until = Some("9999-12-31T23:59:59Z".to_string());
    let b = arm("b", 1.0, 1.0, 1, 99);
    let mut map: HashMap<String, &BanditArmState> = HashMap::new();
    map.insert("a".to_string(), &a);
    map.insert("b".to_string(), &b);
    let candidates = vec!["a".to_string(), "b".to_string()];
    let cfg = BanditConfig::default();
    let picked = select_arm(
        &candidates,
        |id| id.clone(),
        &map,
        BanditStrategy::EpsilonGreedy,
        &cfg,
        "2025-01-01T00:00:00Z",
    );
    assert_eq!(picked, Some(&"b".to_string()));
}

#[test]
fn score_arm_dispatches_by_strategy() {
    let cfg = BanditConfig::default();
    let mut rng = StdRng::seed_from_u64(0);
    let state = arm("x", 1.0, 1.0, 4, 4);
    let s = score_arm(Some(&state), BanditStrategy::Ucb, &cfg, &mut rng);
    assert_eq!(s, score_ucb(Some(&state), &cfg));
}
