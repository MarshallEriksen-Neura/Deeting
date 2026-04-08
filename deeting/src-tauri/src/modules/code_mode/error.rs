use thiserror::Error;

#[derive(Debug, Error)]
pub enum CodemodeToolError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("bridge error: {0}")]
    Bridge(String),
    #[error("sandbox error: {0}")]
    Sandbox(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl CodemodeToolError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }
}
