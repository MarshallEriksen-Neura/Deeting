use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            let mut ordered = serde_json::Map::new();
            for key in keys {
                if let Some(v) = map.get(key) {
                    ordered.insert(key.clone(), canonicalize_json(v));
                }
            }
            Value::Object(ordered)
        }
        Value::Array(values) => {
            Value::Array(values.iter().map(canonicalize_json).collect())
        }
        _ => value.clone(),
    }
}

pub fn hash_json(value: &Value) -> Result<String, serde_json::Error> {
    let canonical = canonicalize_json(value);
    let serialized = serde_json::to_string(&canonical)?;
    let digest = Sha256::digest(serialized.as_bytes());
    Ok(hex::encode(digest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hash_is_stable_for_key_order() {
        let first = json!({"b": 1, "a": {"x": 2, "y": 3}});
        let second = json!({"a": {"y": 3, "x": 2}, "b": 1});
        let first_hash = hash_json(&first).unwrap();
        let second_hash = hash_json(&second).unwrap();
        assert_eq!(first_hash, second_hash);
    }
}
