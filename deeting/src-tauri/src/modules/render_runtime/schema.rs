use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(crate) fn schema_fingerprint(value: &Value) -> String {
    let descriptor = describe_schema(value);
    let mut hasher = Sha256::new();
    hasher.update(descriptor.as_bytes());
    hex::encode(hasher.finalize())
}

pub(crate) fn describe_schema(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(_) => "boolean".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Array(items) => {
            if items.is_empty() {
                return "array<>".to_string();
            }

            let variants = items
                .iter()
                .map(describe_schema)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            format!("array<{}>", variants.join("|"))
        }
        Value::Object(map) => {
            let fields = map
                .iter()
                .map(|(key, value)| format!("{key}:{}", describe_schema(value)))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            format!("object{{{}}}", fields.join(","))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schema_fingerprint_is_stable_for_object_key_order() {
        let left = json!({
            "location": "Beijing",
            "current": {
                "temp_c": 22,
                "condition": "Cloudy"
            }
        });
        let right = json!({
            "current": {
                "condition": "Cloudy",
                "temp_c": 22
            },
            "location": "Beijing"
        });

        assert_eq!(schema_fingerprint(&left), schema_fingerprint(&right));
    }

    #[test]
    fn schema_fingerprint_changes_when_structure_changes() {
        let first = json!({
            "temp_c": 22,
            "condition": "Cloudy"
        });
        let second = json!({
            "temperature": {
                "celsius": 22
            },
            "condition": "Cloudy"
        });

        assert_ne!(schema_fingerprint(&first), schema_fingerprint(&second));
    }
}
