use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum ProviderError {
    #[error("database error: {0}")]
    Database(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("network error: {0}")]
    Network(String),
}

impl From<sqlx::Error> for ProviderError {
    fn from(err: sqlx::Error) -> Self {
        ProviderError::Database(err.to_string())
    }
}
