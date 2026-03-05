use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{now_rfc3339, row_to_bandit_arm_state};
use crate::modules::providers::store::{ProviderStore, BANDIT_DEFAULT_SCENE};
use crate::modules::providers::types::{BanditArmState, BanditFeedbackRequest};

impl ProviderStore {
    pub async fn get_bandit_arm_state(
        &self,
        scene: &str,
        arm_id: &str,
    ) -> Result<Option<BanditArmState>, ProviderError> {
        let row = sqlx::query("SELECT * FROM bandit_arm_state WHERE scene = ? AND arm_id = ?")
            .bind(scene)
            .bind(arm_id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(row_to_bandit_arm_state(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn list_bandit_arm_states(
        &self,
        scene: Option<String>,
    ) -> Result<Vec<BanditArmState>, ProviderError> {
        let scene = scene.unwrap_or_else(|| BANDIT_DEFAULT_SCENE.to_string());
        let rows = sqlx::query("SELECT * FROM bandit_arm_state WHERE scene = ?")
            .bind(scene)
            .fetch_all(&self.pool)
            .await?;

        let mut states = Vec::with_capacity(rows.len());
        for row in rows {
            states.push(row_to_bandit_arm_state(&row)?);
        }
        Ok(states)
    }

    pub async fn record_bandit_feedback(
        &self,
        payload: BanditFeedbackRequest,
    ) -> Result<BanditArmState, ProviderError> {
        let scene = payload.scene.clone().unwrap_or_else(|| BANDIT_DEFAULT_SCENE.to_string());
        
        let mut tx = self.pool.begin().await?;

        let now = now_rfc3339()?;
        let row = sqlx::query("SELECT * FROM bandit_arm_state WHERE scene = ? AND arm_id = ?")
            .bind(&scene)
            .bind(&payload.arm_id)
            .fetch_optional(&mut *tx)
            .await?;

        let mut state = match row {
            Some(row) => row_to_bandit_arm_state(&row)?,
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                BanditArmState {
                    id: id.clone(),
                    provider_model_id: None,
                    scene: scene.clone(),
                    arm_id: Some(payload.arm_id.clone()),
                    reward_metric_type: None,
                    strategy: "epsilon_greedy".to_string(), // Default
                    epsilon: 0.1,
                    alpha: 1.0,
                    beta: 1.0,
                    total_trials: 0,
                    successes: 0,
                    failures: 0,
                    total_latency_ms: 0,
                    latency_p95_ms: None,
                    total_cost: 0.0,
                    last_reward: 0.0,
                    cooldown_until: None,
                    version: 1,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                }
            }
        };

        state.total_trials += 1;
        if payload.reward.unwrap_or(0.0) > 0.5 {
            state.successes += 1;
        } else {
            state.failures += 1;
        }
        state.total_latency_ms += payload.latency_ms.unwrap_or(0.0) as i64;
        state.total_cost += payload.cost.unwrap_or(0.0);
        state.last_reward = payload.reward.unwrap_or(0.0);
        state.updated_at = now;

        sqlx::query(
            "INSERT INTO bandit_arm_state (
                id, provider_model_id, scene, arm_id, reward_metric_type, strategy,
                epsilon, alpha, beta, total_trials, successes, failures,
                total_latency_ms, latency_p95_ms, total_cost, last_reward,
                cooldown_until, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scene, arm_id) DO UPDATE SET
                successes = excluded.successes,
                failures = excluded.failures,
                total_trials = excluded.total_trials,
                total_latency_ms = excluded.total_latency_ms,
                total_cost = excluded.total_cost,
                last_reward = excluded.last_reward,
                updated_at = excluded.updated_at",
        )
        .bind(&state.id)
        .bind(&state.provider_model_id)
        .bind(&state.scene)
        .bind(&state.arm_id)
        .bind(&state.reward_metric_type)
        .bind(&state.strategy)
        .bind(state.epsilon)
        .bind(state.alpha)
        .bind(state.beta)
        .bind(state.total_trials)
        .bind(state.successes)
        .bind(state.failures)
        .bind(state.total_latency_ms)
        .bind(state.latency_p95_ms)
        .bind(state.total_cost)
        .bind(state.last_reward)
        .bind(&state.cooldown_until)
        .bind(state.version)
        .bind(&state.created_at)
        .bind(&state.updated_at)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(state)
    }
}
