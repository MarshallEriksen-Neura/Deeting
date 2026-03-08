use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("migration error: {0}")]
    Migration(String),
}

impl MemoryError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }
}

impl From<lancedb::Error> for MemoryError {
    fn from(err: lancedb::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<arrow_schema::ArrowError> for MemoryError {
    fn from(err: arrow_schema::ArrowError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<serde_json::Error> for MemoryError {
    fn from(err: serde_json::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<time::error::Format> for MemoryError {
    fn from(err: time::error::Format) -> Self {
        Self::Storage(err.to_string())
    }
}
