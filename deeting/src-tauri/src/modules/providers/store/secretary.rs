use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{
    now_rfc3339, row_to_user_embedding_config, row_to_user_secretary,
};
use crate::modules::providers::store::{ProviderStore, LOCAL_DESKTOP_USER_ID};
use crate::modules::providers::types::{
    UserEmbeddingConfig, UserEmbeddingConfigUpdateRequest, UserSecretary,
    UserSecretaryUpdateRequest,
};
use uuid::Uuid;

impl ProviderStore {
    pub async fn get_or_create_user_secretary(&self) -> Result<UserSecretary, ProviderError> {
        if let Some(secretary) = self
            .get_user_secretary_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
        {
            return Ok(secretary);
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        sqlx::query(
            "INSERT INTO user_secretary (
                id, user_id, name, model_name, provider_model_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind("Default Secretary")
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(UserSecretary {
            id,
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            name: "Default Secretary".to_string(),
            model_name: None,
            provider_model_id: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn update_user_secretary(
        &self,
        payload: UserSecretaryUpdateRequest,
    ) -> Result<UserSecretary, ProviderError> {
        let current = self.get_or_create_user_secretary().await?;
        let model_name = payload.model_name.unwrap_or(current.model_name);
        let provider_model_id = payload
            .provider_model_id
            .unwrap_or(current.provider_model_id);
        let now = now_rfc3339()?;
        sqlx::query(
            "UPDATE user_secretary
             SET model_name = ?, provider_model_id = ?, updated_at = ?
             WHERE user_id = ?",
        )
        .bind(&model_name)
        .bind(&provider_model_id)
        .bind(&now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await?;

        self.get_user_secretary_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
            .ok_or_else(|| ProviderError::NotFound("User secretary not found after update".into()))
    }

    pub async fn get_user_secretary_by_user_id(
        &self,
        user_id: &str,
    ) -> Result<Option<UserSecretary>, ProviderError> {
        let row = sqlx::query("SELECT * FROM user_secretary WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(row_to_user_secretary(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn get_or_create_user_embedding_config(
        &self,
    ) -> Result<UserEmbeddingConfig, ProviderError> {
        if let Some(config) = self
            .get_user_embedding_config_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
        {
            return Ok(config);
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        sqlx::query(
            "INSERT INTO user_embedding_config (id, user_id, provider_model_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(None::<String>)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(UserEmbeddingConfig {
            id,
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            provider_model_id: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn update_user_embedding_config(
        &self,
        payload: UserEmbeddingConfigUpdateRequest,
    ) -> Result<UserEmbeddingConfig, ProviderError> {
        let now = now_rfc3339()?;
        sqlx::query(
            "UPDATE user_embedding_config
             SET provider_model_id = ?, updated_at = ?
             WHERE user_id = ?",
        )
        .bind(&payload.provider_model_id)
        .bind(&now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await?;

        self.get_user_embedding_config_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound("User embedding config not found after update".into())
            })
    }

    pub async fn get_user_embedding_config_by_user_id(
        &self,
        user_id: &str,
    ) -> Result<Option<UserEmbeddingConfig>, ProviderError> {
        let row = sqlx::query("SELECT * FROM user_embedding_config WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(row_to_user_embedding_config(&row)?)),
            None => Ok(None),
        }
    }
}
