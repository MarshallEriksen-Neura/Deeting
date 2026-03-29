use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct CustomTaskAgentTtsConfig {
    pub(crate) voice: Option<String>,
    pub(crate) response_format: Option<String>,
    pub(crate) speed: Option<f64>,
    pub(crate) extra_params: Option<Value>,
}

#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct CustomTaskAgentSttConfig {
    pub(crate) language: Option<String>,
    pub(crate) response_format: Option<String>,
    pub(crate) timestamp_granularities: Vec<String>,
    pub(crate) temperature: Option<f64>,
    pub(crate) extra_params: Option<Value>,
}

fn read_string(object: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<String> {
    object
        .and_then(|map| map.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_f64(object: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<f64> {
    object.and_then(|map| map.get(key)).and_then(Value::as_f64)
}

pub(crate) fn resolve_custom_task_agent_tts_config(
    model_config: Option<&Value>,
) -> CustomTaskAgentTtsConfig {
    let tts = model_config
        .and_then(|value| value.get("text_to_speech"))
        .and_then(Value::as_object);

    CustomTaskAgentTtsConfig {
        voice: read_string(tts, "voice"),
        response_format: read_string(tts, "response_format"),
        speed: read_f64(tts, "speed"),
        extra_params: tts
            .and_then(|map| map.get("extra_params"))
            .and_then(|value| value.as_object().cloned().map(Value::Object)),
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn resolve_custom_task_agent_stt_config(
    model_config: Option<&Value>,
) -> CustomTaskAgentSttConfig {
    let stt = model_config
        .and_then(|value| value.get("speech_to_text"))
        .and_then(Value::as_object);

    CustomTaskAgentSttConfig {
        language: read_string(stt, "language"),
        response_format: read_string(stt, "response_format"),
        timestamp_granularities: stt
            .and_then(|map| map.get("timestamp_granularities"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        temperature: read_f64(stt, "temperature"),
        extra_params: stt
            .and_then(|map| map.get("extra_params"))
            .and_then(|value| value.as_object().cloned().map(Value::Object)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_custom_task_agent_stt_config, resolve_custom_task_agent_tts_config,
        CustomTaskAgentSttConfig, CustomTaskAgentTtsConfig,
    };
    use serde_json::json;

    #[test]
    fn resolve_custom_task_agent_tts_config_reads_nested_values() {
        let result = resolve_custom_task_agent_tts_config(Some(&json!({
            "text_to_speech": {
                "voice": "alloy",
                "response_format": "mp3",
                "speed": 1.1,
                "extra_params": {
                    "style": "warm"
                }
            }
        })));

        assert_eq!(
            result,
            CustomTaskAgentTtsConfig {
                voice: Some("alloy".to_string()),
                response_format: Some("mp3".to_string()),
                speed: Some(1.1),
                extra_params: Some(json!({ "style": "warm" })),
            }
        );
    }

    #[test]
    fn resolve_custom_task_agent_stt_config_reads_nested_values() {
        let result = resolve_custom_task_agent_stt_config(Some(&json!({
            "speech_to_text": {
                "language": "zh",
                "response_format": "json",
                "timestamp_granularities": ["segment", "word"],
                "temperature": 0.2
            }
        })));

        assert_eq!(
            result,
            CustomTaskAgentSttConfig {
                language: Some("zh".to_string()),
                response_format: Some("json".to_string()),
                timestamp_granularities: vec!["segment".to_string(), "word".to_string()],
                temperature: Some(0.2),
                extra_params: None,
            }
        );
    }
}
