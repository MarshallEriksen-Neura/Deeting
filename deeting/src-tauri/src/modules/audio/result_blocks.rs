use serde_json::json;

use super::types::AudioResultPayload;

pub(crate) fn build_audio_result_block(
    id_seed: &str,
    title: Option<&str>,
    payload: &AudioResultPayload,
    metadata: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut block = json!({
        "id": format!("{id_seed}-audio-result"),
        "type": "ui",
        "viewType": "audio.result",
        "displayMode": "widget",
        "payload": payload,
    });

    if let Some(object) = block.as_object_mut() {
        if let Some(title) = title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        {
            object.insert("title".to_string(), serde_json::Value::String(title));
        }
        if let Some(metadata) = metadata {
            if !metadata.is_null() {
                object.insert("metadata".to_string(), metadata);
            }
        }
    }

    block
}

#[cfg(test)]
mod tests {
    use super::build_audio_result_block;
    use crate::modules::audio::types::{AudioAssetRef, AudioAssetSourceKind, AudioResultPayload};
    use serde_json::json;

    #[test]
    fn build_audio_result_block_uses_audio_view_contract() {
        let payload = AudioResultPayload {
            asset: AudioAssetRef {
                url: "local-asset://abc".to_string(),
                source_kind: AudioAssetSourceKind::LocalAsset,
                content_type: Some("audio/mpeg".to_string()),
                size_bytes: Some(1234),
                duration_ms: Some(5600),
            },
            model: Some("tts-1".to_string()),
            voice: Some("alloy".to_string()),
            transcript: None,
            prompt_text: Some("hello".to_string()),
        };

        let block = build_audio_result_block(
            "call-1",
            Some("Voice Result"),
            &payload,
            Some(json!({ "capability": "text_to_speech" })),
        );

        assert_eq!(block["type"], json!("ui"));
        assert_eq!(block["viewType"], json!("audio.result"));
        assert_eq!(block["title"], json!("Voice Result"));
        assert_eq!(block["payload"]["asset"]["url"], json!("local-asset://abc"));
        assert_eq!(block["metadata"]["capability"], json!("text_to_speech"));
    }
}
