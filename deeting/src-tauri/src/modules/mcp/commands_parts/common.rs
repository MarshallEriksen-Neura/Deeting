#[derive(Debug, Clone)]
pub(crate) struct LocalModelConnection {
    pub(crate) provider_model_id: String,
    pub(crate) model_id: String,
}

pub(crate) fn to_string<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}
