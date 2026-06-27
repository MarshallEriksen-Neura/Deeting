//! Multi-armed bandit selection algorithms for the provider routing layer.
//!
//! The desktop runtime owns this local implementation so provider selection
//! remains deterministic without a cloud service dependency.
use log::warn;
use rand::Rng;
use rand_distr::{Beta, Distribution};
use std::collections::{HashMap, HashSet};

use crate::modules::providers::types::BanditArmState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BanditStrategy {
    Thompson,
    Ucb,
    EpsilonGreedy,
}

impl BanditStrategy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "thompson" | "thompson_sampling" => Some(Self::Thompson),
            "ucb" | "ucb1" => Some(Self::Ucb),
            "epsilon_greedy" | "epsilon-greedy" | "eps_greedy" => Some(Self::EpsilonGreedy),
            _ => None,
        }
    }

    pub fn parse_or(raw: &str, fallback: Self) -> Self {
        match Self::parse(raw) {
            Some(value) => value,
            None => {
                warn!(
                    "bandit_selector: unknown strategy '{}', falling back to {:?}",
                    raw, fallback
                );
                fallback
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct BanditConfig {
    pub epsilon: f64,
    pub ucb_c: f64,
    pub ucb_min_trials: u64,
    pub thompson_prior_alpha: f64,
    pub thompson_prior_beta: f64,
}

impl Default for BanditConfig {
    fn default() -> Self {
        Self {
            epsilon: 0.1,
            ucb_c: 1.5,
            ucb_min_trials: 5,
            thompson_prior_alpha: 1.0,
            thompson_prior_beta: 1.0,
        }
    }
}

pub fn score_thompson<R: Rng + ?Sized>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    let (alpha, beta) = match state {
        None => (cfg.thompson_prior_alpha, cfg.thompson_prior_beta),
        Some(s) => {
            let a = if s.alpha > 0.0 {
                s.alpha
            } else {
                cfg.thompson_prior_alpha
            };
            let b = if s.beta > 0.0 {
                s.beta
            } else {
                cfg.thompson_prior_beta
            };
            (a, b)
        }
    };
    match Beta::new(alpha.max(f64::EPSILON), beta.max(f64::EPSILON)) {
        Ok(dist) => dist.sample(rng),
        Err(_) => 0.5,
    }
}

pub fn score_ucb(state: Option<&BanditArmState>, cfg: &BanditConfig) -> f64 {
    let state = match state {
        Some(s) => s,
        None => return 1.0,
    };
    let total = state.total_trials.max(0) as u64;
    if total == 0 || total < cfg.ucb_min_trials {
        return 1.0;
    }
    let total_f = total as f64;
    let rate = state.successes.max(0) as f64 / total_f;
    rate + cfg.ucb_c * ((total_f + 1.0).ln() / total_f).sqrt()
}

pub fn score_epsilon_greedy<R: Rng + ?Sized>(
    state: Option<&BanditArmState>,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    if cfg.epsilon <= 0.0 {
        return score_success_rate(state);
    }
    if rng.gen::<f64>() < cfg.epsilon {
        return rng.gen::<f64>();
    }
    score_success_rate(state)
}

pub fn score_success_rate(state: Option<&BanditArmState>) -> f64 {
    let state = match state {
        Some(s) => s,
        None => return 0.0,
    };
    let total = state.total_trials.max(0);
    if total == 0 {
        return 0.0;
    }
    state.successes.max(0) as f64 / total as f64
}

pub fn score_arm<R: Rng + ?Sized>(
    state: Option<&BanditArmState>,
    strategy: BanditStrategy,
    cfg: &BanditConfig,
    rng: &mut R,
) -> f64 {
    match strategy {
        BanditStrategy::Thompson => score_thompson(state, cfg, rng),
        BanditStrategy::Ucb => score_ucb(state, cfg),
        BanditStrategy::EpsilonGreedy => score_epsilon_greedy(state, cfg, rng),
    }
}

pub fn is_in_cooldown(state: &BanditArmState, now_rfc3339: &str) -> bool {
    match &state.cooldown_until {
        Some(until) => until.as_str() > now_rfc3339,
        None => false,
    }
}

pub fn select_arm<'a, T, F>(
    candidates: &'a [T],
    arm_id_of: F,
    arm_map: &HashMap<String, &BanditArmState>,
    strategy: BanditStrategy,
    cfg: &BanditConfig,
    now_rfc3339: &str,
) -> Option<&'a T>
where
    F: Fn(&T) -> String,
{
    let excluded_arm_ids = HashSet::new();
    select_arm_excluding(
        candidates,
        arm_id_of,
        arm_map,
        strategy,
        cfg,
        now_rfc3339,
        &excluded_arm_ids,
    )
}

pub fn select_arm_excluding<'a, T, F>(
    candidates: &'a [T],
    arm_id_of: F,
    arm_map: &HashMap<String, &BanditArmState>,
    strategy: BanditStrategy,
    cfg: &BanditConfig,
    now_rfc3339: &str,
    excluded_arm_ids: &HashSet<String>,
) -> Option<&'a T>
where
    F: Fn(&T) -> String,
{
    if candidates.is_empty() {
        return None;
    }
    let mut rng = rand::thread_rng();
    let mut best_idx: Option<usize> = None;
    let mut best_score = f64::NEG_INFINITY;
    let mut first_eligible: Option<usize> = None;
    let mut first_not_excluded: Option<usize> = None;
    for (idx, candidate) in candidates.iter().enumerate() {
        let arm_id = arm_id_of(candidate);
        if excluded_arm_ids.contains(arm_id.as_str()) {
            continue;
        }
        first_not_excluded.get_or_insert(idx);
        let state = arm_map.get(arm_id.as_str()).copied();
        if let Some(s) = state {
            if is_in_cooldown(s, now_rfc3339) {
                continue;
            }
        }
        first_eligible.get_or_insert(idx);
        let score = score_arm(state, strategy, cfg, &mut rng);
        if score > best_score {
            best_score = score;
            best_idx = Some(idx);
        }
    }
    let pick = best_idx.or(first_eligible).or(first_not_excluded)?;
    Some(&candidates[pick])
}
