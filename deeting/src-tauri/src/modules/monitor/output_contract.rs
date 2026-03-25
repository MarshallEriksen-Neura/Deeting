use serde_json::{json, Value};

const MODEL_RESPONSE_MAX_CHARS: usize = 40_000;
const SUMMARY_MAX_CHARS: usize = 4_000;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MonitorStructuredOutput {
    pub(crate) is_significant_change: bool,
    pub(crate) change_summary: String,
    pub(crate) new_snapshot: Value,
    pub(crate) strategy_tag: Option<String>,
    pub(crate) observations: Option<Value>,
}

pub(crate) fn normalize_monitor_output(content: &str) -> MonitorStructuredOutput {
    let mut text = content.trim().to_string();
    if text.len() > MODEL_RESPONSE_MAX_CHARS {
        text = text.chars().take(MODEL_RESPONSE_MAX_CHARS).collect();
    }

    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) {
        if end > start {
            if let Ok(value) = serde_json::from_str::<Value>(&text[start..=end]) {
                let is_change = value
                    .get("is_significant_change")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let summary = value
                    .get("change_summary")
                    .and_then(Value::as_str)
                    .map(|v| truncate(v, SUMMARY_MAX_CHARS))
                    .unwrap_or_default();
                let snapshot = value
                    .get("new_snapshot")
                    .cloned()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({}));
                let final_summary = if summary.trim().is_empty() {
                    build_snapshot_summary(&snapshot, is_change)
                } else {
                    summary
                };
                return MonitorStructuredOutput {
                    is_significant_change: is_change,
                    change_summary: final_summary,
                    new_snapshot: snapshot,
                    strategy_tag: value
                        .get("strategy_tag")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    observations: value.get("observations").cloned(),
                };
            }
        }
    }

    let fallback = truncate(&text, SUMMARY_MAX_CHARS);
    MonitorStructuredOutput {
        is_significant_change: false,
        change_summary: if fallback.trim().is_empty() {
            "### 例行简报\n本次本地执行未返回可解析结果。".to_string()
        } else {
            fallback
        },
        new_snapshot: json!({}),
        strategy_tag: None,
        observations: None,
    }
}

fn build_snapshot_summary(snapshot: &Value, is_significant_change: bool) -> String {
    if !snapshot.is_object() {
        return if is_significant_change {
            "### 研判结论\n检测到显著变化。".to_string()
        } else {
            "### 例行简报\n当前未检测到显著变化。".to_string()
        };
    }
    let title = if is_significant_change {
        "### 研判结论"
    } else {
        "### 例行简报"
    };
    format!(
        "{}\n{}",
        title,
        truncate(&snapshot.to_string(), SUMMARY_MAX_CHARS)
    )
}

fn truncate(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    raw.chars().take(max_chars).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_monitor_output_reads_structured_fields() {
        let result = normalize_monitor_output(
            r#"{
                "is_significant_change": true,
                "change_summary": "summary",
                "new_snapshot": {"foo": "bar"},
                "strategy_tag": "alert_first",
                "observations": {"risk": "high"}
            }"#,
        );

        assert!(result.is_significant_change);
        assert_eq!(result.change_summary, "summary");
        assert_eq!(result.new_snapshot, json!({"foo": "bar"}));
        assert_eq!(result.strategy_tag.as_deref(), Some("alert_first"));
        assert_eq!(result.observations, Some(json!({"risk": "high"})));
    }

    #[test]
    fn normalize_monitor_output_falls_back_to_plain_text() {
        let result = normalize_monitor_output("plain summary");

        assert!(!result.is_significant_change);
        assert_eq!(result.change_summary, "plain summary");
        assert_eq!(result.new_snapshot, json!({}));
        assert_eq!(result.strategy_tag, None);
        assert_eq!(result.observations, None);
    }
}
