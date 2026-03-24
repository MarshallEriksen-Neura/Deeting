use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioAssetSourceKind {
    LocalAsset,
    ObjectStorage,
    RemoteUrl,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioAssetRef {
    pub url: String,
    pub source_kind: AudioAssetSourceKind,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioResultPayload {
    pub asset: AudioAssetRef,
    pub model: Option<String>,
    pub voice: Option<String>,
    pub transcript: Option<String>,
    pub prompt_text: Option<String>,
}
