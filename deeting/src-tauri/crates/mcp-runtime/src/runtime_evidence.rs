use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::capability_snapshot::extract_callable_direct_capability_names;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeCapabilityEvidence {
    pub direct_callable_capability_count: usize,
    pub has_programmatic_executor: bool,
    pub any_mutating_capability: bool,
    pub any_high_risk_capability: bool,
    pub direct_capability_names: Vec<String>,
    pub callable_direct_capability_names: Vec<String>,
}

impl RuntimeCapabilityEvidence {
    pub fn from_search_result(search_result: &Value) -> Self {
        let callable_direct_capability_names =
            extract_callable_direct_capability_names(search_result)
                .unwrap_or_default()
                .into_iter()
                .filter(|name| name != "execute_code_plan")
                .collect::<Vec<_>>();
        let direct_callable_capability_count = search_result
            .pointer("/routing_hint/direct_callable_capability_count")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(callable_direct_capability_names.len());
        let capabilities = search_result
            .get("capabilities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let any_mutating_capability = capabilities.iter().any(|item| {
            if is_runtime_orchestration_capability(item) {
                return false;
            }
            item.get("mutating")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        });
        let any_high_risk_capability = capabilities.iter().any(|item| {
            if is_runtime_orchestration_capability(item) {
                return false;
            }
            item.get("risk_level")
                .and_then(Value::as_str)
                .is_some_and(|value| matches!(value, "high" | "critical"))
        });
        let direct_capability_names = callable_direct_capability_names
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>();
        let has_programmatic_executor = search_result
            .get("orchestration_primitives")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("name").and_then(Value::as_str) == Some("execute_code_plan")
                })
            })
            || search_result
                .pointer("/routing_hint/programmatic_path")
                .and_then(Value::as_str)
                == Some("execute_code_plan");

        Self {
            direct_callable_capability_count,
            has_programmatic_executor,
            any_mutating_capability,
            any_high_risk_capability,
            direct_capability_names,
            callable_direct_capability_names,
        }
    }
}

fn is_runtime_orchestration_capability(item: &Value) -> bool {
    item.get("name").and_then(Value::as_str) == Some("execute_code_plan")
}
