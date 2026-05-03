use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAiAccessKeyRecord {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub status: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAiAccessKeyCreated {
    pub key: LocalAiAccessKeyRecord,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalAiAccessKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAiAccessGatewayConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalAiAccessGatewayConfigRequest {
    pub enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone)]
pub struct VerifiedLocalAiAccessKey {
    pub id: String,
    pub scopes: Vec<String>,
}
