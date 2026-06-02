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
        .execute(&self.write_pool)
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
        // Handle Option<Option<T>> correctly:
        // - None means "don't update this field"
        // - Some(None) means "clear this field"
        // - Some(Some(value)) means "update to new value"
        let model_name = match payload.model_name {
            Some(new_value) => new_value,
            None => current.model_name,
        };
        let provider_model_id = match payload.provider_model_id {
            Some(new_value) => new_value,
            None => current.provider_model_id,
        };
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
        .execute(&self.write_pool)
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
            "INSERT INTO user_embedding_config (
                id, user_id, provider_model_id, multimodal_provider_model_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await?;

        Ok(UserEmbeddingConfig {
            id,
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            provider_model_id: None,
            multimodal_provider_model_id: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn update_user_embedding_config(
        &self,
        payload: UserEmbeddingConfigUpdateRequest,
    ) -> Result<UserEmbeddingConfig, ProviderError> {
        let current = self.get_or_create_user_embedding_config().await?;
        // Handle Option<Option<T>> correctly:
        // - None means "don't update this field"
        // - Some(None) means "clear this field"
        // - Some(Some(value)) means "update to new value"
        let provider_model_id = match payload.provider_model_id {
            Some(new_value) => new_value,
            None => current.provider_model_id,
        };
        let multimodal_provider_model_id = match payload.multimodal_provider_model_id {
            Some(new_value) => new_value,
            None => current.multimodal_provider_model_id,
        };
        let now = now_rfc3339()?;
        sqlx::query(
            "UPDATE user_embedding_config
             SET provider_model_id = ?, multimodal_provider_model_id = ?, updated_at = ?
             WHERE user_id = ?",
        )
        .bind(&provider_model_id)
        .bind(&multimodal_provider_model_id)
        .bind(&now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.write_pool)
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
