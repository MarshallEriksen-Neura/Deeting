use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{now_rfc3339, row_to_bandit_arm_state};
use crate::modules::providers::store::{ProviderStore, BANDIT_DEFAULT_SCENE};
use crate::modules::providers::types::{BanditArmState, BanditFeedbackRequest};
use time::Duration;

const SQLITE_BUSY_RETRY_DELAYS_MS: [u64; 4] = [100, 250, 500, 1000];
const BANDIT_FAILURE_COOLDOWN_SECONDS: i64 = 120;

fn is_sqlite_busy_error(err: &ProviderError) -> bool {
    let text = err.to_string().to_ascii_lowercase();
    text.contains("database is locked")
        || text.contains("sqlite_busy")
        || text.contains("busy_snapshot")
        || text.contains("(code: 5)")
        || text.contains("(code: 517)")
}

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
        let scene = payload
            .scene
            .clone()
            .unwrap_or_else(|| BANDIT_DEFAULT_SCENE.to_string());
        let arm_id = payload.arm_id.clone();
        let mut attempt = 0_usize;

        loop {
            match self.record_bandit_feedback_once(payload.clone()).await {
                Ok(state) => return Ok(state),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "record_bandit_feedback busy retry scene={} arm_id={} attempt={} delay_ms={}",
                        scene,
                        arm_id,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn record_bandit_feedback_once(
        &self,
        payload: BanditFeedbackRequest,
    ) -> Result<BanditArmState, ProviderError> {
        let scene = payload
            .scene
            .clone()
            .unwrap_or_else(|| BANDIT_DEFAULT_SCENE.to_string());

        let mut tx = self.begin_write().await?;

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
        let is_success = payload.reward.unwrap_or(0.0) > 0.5;
        if is_success {
            state.successes += 1;
            state.alpha += 1.0;
            state.cooldown_until = None;
        } else {
            state.failures += 1;
            state.beta += 1.0;
            state.cooldown_until = Some(
                (time::OffsetDateTime::now_utc()
                    + Duration::seconds(BANDIT_FAILURE_COOLDOWN_SECONDS))
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|e| ProviderError::Database(e.to_string()))?,
            );
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
                alpha = excluded.alpha,
                beta = excluded.beta,
                successes = excluded.successes,
                failures = excluded.failures,
                total_trials = excluded.total_trials,
                total_latency_ms = excluded.total_latency_ms,
                total_cost = excluded.total_cost,
                last_reward = excluded.last_reward,
                cooldown_until = excluded.cooldown_until,
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

    /// Convenience wrapper: compute a reward from a boolean success flag and
    /// optional latency, then delegate to [`record_bandit_feedback`].
    ///
    /// `reward = if success { 1.0 } else { 0.0 }`
    /// When `latency_ms` is provided the reward is scaled down proportionally
    /// (capped so that latency >= 30 000 ms still yields 10 % of the base reward).
    pub async fn record_feedback_simple(
        &self,
        scene: &str,
        arm_id: &str,
        success: bool,
        latency_ms: Option<f64>,
    ) -> Result<BanditArmState, ProviderError> {
        let mut reward = if success { 1.0 } else { 0.0 };
        if let Some(ms) = latency_ms {
            reward *= 1.0 - (ms / 30000.0).min(0.9);
        }
        let payload = BanditFeedbackRequest {
            scene: Some(scene.to_string()),
            arm_id: arm_id.to_string(),
            success,
            latency_ms,
            cost: None,
            reward: Some(reward),
            routing_config: None,
            reward_metric_type: None,
        };
        self.record_bandit_feedback(payload).await
    }
}

#[cfg(test)]
mod bandit_tests {
    use super::is_sqlite_busy_error;
    use crate::modules::providers::error::ProviderError;

    #[test]
    fn sqlite_busy_classifier_catches_extended_busy_codes() {
        assert!(is_sqlite_busy_error(&ProviderError::Database(
            "error returned from database: (code: 5) database is locked".to_string(),
        )));
        assert!(is_sqlite_busy_error(&ProviderError::Database(
            "error returned from database: (code: 517) database is locked".to_string(),
        )));
    }
}
