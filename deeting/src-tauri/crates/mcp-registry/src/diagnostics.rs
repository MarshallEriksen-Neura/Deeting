use std::collections::BTreeMap;

use serde_json::Value;

use crate::assets::{capability_asset_match_key, is_legacy_control_plane_asset};
use crate::types::{LocalCapabilityRegistryDiagnosticsBucket, LocalCapabilityRegistryParityItem};

pub fn build_control_plane_asset_map(assets: Vec<Value>) -> BTreeMap<String, Value> {
    assets
        .into_iter()
        .filter(is_legacy_control_plane_asset)
        .filter_map(|asset| capability_asset_match_key(&asset).map(|key| (key, asset)))
        .collect()
}

pub fn build_parity_item(key: &str, asset: &Value) -> Option<LocalCapabilityRegistryParityItem> {
    let source_type = asset.get("source_type").and_then(Value::as_str)?.trim();
    let asset_type = asset.get("asset_type").and_then(Value::as_str)?.trim();
    if source_type.is_empty() || asset_type.is_empty() {
        return None;
    }
    let asset_id = asset
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = asset
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let package_id = asset
        .get("pkg_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            asset
                .get("metadata")
                .and_then(|metadata| metadata.get("skill_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });

    Some(LocalCapabilityRegistryParityItem {
        key: key.to_string(),
        asset_id,
        name,
        source_type: source_type.to_string(),
        asset_type: asset_type.to_string(),
        package_id,
    })
}

pub fn build_registry_buckets<'a>(
    values: impl Iterator<Item = &'a str>,
) -> Vec<LocalCapabilityRegistryDiagnosticsBucket> {
    let mut counts = BTreeMap::<String, i64>::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        *counts.entry(normalized.to_string()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(key, count)| LocalCapabilityRegistryDiagnosticsBucket { key, count })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_registry_buckets_counts_sorted_values() {
        let buckets =
            build_registry_buckets(["pending", "registered", "pending", "ready"].into_iter());
        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0].key, "pending");
        assert_eq!(buckets[0].count, 2);
        assert_eq!(buckets[1].key, "ready");
        assert_eq!(buckets[1].count, 1);
        assert_eq!(buckets[2].key, "registered");
        assert_eq!(buckets[2].count, 1);
    }

    #[test]
    fn build_control_plane_asset_map_filters_to_cutover_assets() {
        let map = build_control_plane_asset_map(vec![
            json!({
                "id": "skill.alpha",
                "asset_type": "skill",
                "source_type": "user",
                "pkg_name": "skill.alpha",
            }),
            json!({
                "id": "cloud.skill.alpha",
                "asset_type": "skill",
                "source_type": "cloud_mirror",
            }),
        ]);

        assert_eq!(map.len(), 1);
        assert!(map.contains_key("skill_bundle:skill.alpha"));
    }
}
