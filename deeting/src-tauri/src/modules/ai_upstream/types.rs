#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct LocalModelConnection {
    pub(crate) provider_model_id: String,
    pub(crate) model_id: String,
    pub(crate) logical_model_key: Option<String>,
    pub(crate) protocol_family: String,
    #[serde(default)]
    pub(crate) failover_pool_key: Option<String>,
}
