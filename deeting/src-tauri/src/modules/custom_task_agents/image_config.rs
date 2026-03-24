use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct CustomTaskAgentImageConfig {
    pub(crate) negative_prompt: Option<String>,
    pub(crate) width: Option<i64>,
    pub(crate) height: Option<i64>,
    pub(crate) aspect_ratio: Option<String>,
    pub(crate) num_outputs: Option<i64>,
    pub(crate) steps: Option<i64>,
    pub(crate) cfg_scale: Option<f64>,
    pub(crate) seed: Option<i64>,
    pub(crate) sampler_name: Option<String>,
    pub(crate) quality: Option<String>,
    pub(crate) style: Option<String>,
    pub(crate) response_format: Option<String>,
    pub(crate) image_url: Option<String>,
    pub(crate) extra_params: Option<Value>,
}

pub(crate) fn resolve_custom_task_agent_image_config(
    model_config: Option<&Value>,
) -> CustomTaskAgentImageConfig {
    let image_config = model_config
        .and_then(|value| value.get("image_generation"))
        .and_then(Value::as_object);

    let read_string = |key: &str| {
        image_config
            .and_then(|map| map.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let read_i64 = |key: &str| {
        image_config
            .and_then(|map| map.get(key))
            .and_then(Value::as_i64)
    };
    let read_f64 = |key: &str| {
        image_config
            .and_then(|map| map.get(key))
            .and_then(Value::as_f64)
    };

    CustomTaskAgentImageConfig {
        negative_prompt: read_string("negative_prompt"),
        width: read_i64("width"),
        height: read_i64("height"),
        aspect_ratio: read_string("aspect_ratio"),
        num_outputs: read_i64("num_outputs"),
        steps: read_i64("steps"),
        cfg_scale: read_f64("cfg_scale"),
        seed: read_i64("seed"),
        sampler_name: read_string("sampler_name"),
        quality: read_string("quality"),
        style: read_string("style"),
        response_format: read_string("response_format"),
        image_url: read_string("image_url"),
        extra_params: image_config
            .and_then(|map| map.get("extra_params"))
            .and_then(|value| value.as_object().cloned().map(Value::Object)),
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_custom_task_agent_image_config, CustomTaskAgentImageConfig};
    use serde_json::json;

    #[test]
    fn resolve_custom_task_agent_image_config_reads_nested_image_generation_values() {
        let result = resolve_custom_task_agent_image_config(Some(&json!({
            "model": "Qwen-Image",
            "image_generation": {
                "negative_prompt": "blurry",
                "width": 1024,
                "height": 768,
                "aspect_ratio": "4:3",
                "num_outputs": 2,
                "steps": 30,
                "cfg_scale": 7.5,
                "seed": 42,
                "sampler_name": "euler",
                "quality": "high",
                "style": "photorealistic",
                "response_format": "url",
                "image_url": "https://example.com/reference.png",
                "extra_params": {
                    "prompt_optimizer": true
                }
            }
        })));

        assert_eq!(
            result,
            CustomTaskAgentImageConfig {
                negative_prompt: Some("blurry".to_string()),
                width: Some(1024),
                height: Some(768),
                aspect_ratio: Some("4:3".to_string()),
                num_outputs: Some(2),
                steps: Some(30),
                cfg_scale: Some(7.5),
                seed: Some(42),
                sampler_name: Some("euler".to_string()),
                quality: Some("high".to_string()),
                style: Some("photorealistic".to_string()),
                response_format: Some("url".to_string()),
                image_url: Some("https://example.com/reference.png".to_string()),
                extra_params: Some(json!({
                    "prompt_optimizer": true
                })),
            }
        );
    }

    #[test]
    fn resolve_custom_task_agent_image_config_ignores_missing_or_invalid_values() {
        let result = resolve_custom_task_agent_image_config(Some(&json!({
            "image_generation": {
                "negative_prompt": "",
                "num_outputs": "3",
                "extra_params": []
            }
        })));

        assert_eq!(result, CustomTaskAgentImageConfig::default());
    }
}
