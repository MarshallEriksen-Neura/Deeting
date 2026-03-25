use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CapabilityExecutionContract {
    pub(crate) allowed_tools: Vec<String>,
    pub(crate) capability_snapshot: Value,
}

impl CapabilityExecutionContract {
    pub(crate) fn from_search_result(search_result: Option<&Value>) -> Result<Self, String> {
        let Some(search_result) = search_result else {
            return Err(
                "execute_code_plan requires a prior search_sdk result with callable direct capabilities"
                    .to_string(),
            );
        };
        let allowed_tools =
            crate::modules::capability_control_plane::extract_direct_callable_capability_names(
                search_result,
            )?;
        Ok(Self {
            allowed_tools,
            capability_snapshot: search_result.clone(),
        })
    }

    pub(crate) fn from_runtime_inputs(
        request_allowed_tools: Option<&[String]>,
        capability_snapshot: Option<&Value>,
    ) -> Self {
        let mut names = BTreeSet::new();
        if let Some(items) = request_allowed_tools {
            for item in items {
                let normalized = item.trim().to_lowercase();
                if !normalized.is_empty() {
                    names.insert(normalized);
                }
            }
        }
        if let Some(snapshot) = capability_snapshot {
            if let Ok(capability_names) =
                crate::modules::capability_control_plane::extract_direct_callable_capability_names(
                    snapshot,
                )
            {
                for name in capability_names {
                    if !name.is_empty() {
                        names.insert(name);
                    }
                }
            }
        }

        Self {
            allowed_tools: names.into_iter().collect(),
            capability_snapshot: capability_snapshot.cloned().unwrap_or(Value::Null),
        }
    }

    pub(crate) fn allowed_tools_option(&self) -> Option<Vec<String>> {
        (!self.allowed_tools.is_empty()).then(|| self.allowed_tools.clone())
    }

    pub(crate) fn embed_into_context(&self, mut context: Value) -> Value {
        let contract = json!({
            "allowed_tools": self.allowed_tools,
            "capability_snapshot": self.capability_snapshot,
        });
        if let Some(object) = context.as_object_mut() {
            object.insert("capability_contract".to_string(), contract);
            context
        } else {
            json!({
                "request_context": context,
                "capability_contract": contract,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_search_result_extracts_allowed_tools() {
        let contract = CapabilityExecutionContract::from_search_result(Some(&json!({
            "capabilities": [
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "disabled_tool", "invocation_mode": "direct", "status": {"callable": false}},
                {"name": "execute_code_plan", "invocation_mode": "code_mode", "status": {"callable": true}}
            ]
        })))
        .expect("contract");

        assert_eq!(
            contract.allowed_tools,
            vec!["fetch_page".to_string(), "search_web".to_string()]
        );
        assert!(contract.capability_snapshot.is_object());
    }

    #[test]
    fn from_runtime_inputs_merges_request_and_snapshot() {
        let request_allowed = vec!["search_web".to_string(), "search_web".to_string()];
        let snapshot = json!({
            "capabilities": [
                { "name": "fetch_page", "invocation_mode": "direct", "status": { "callable": true } },
                { "name": "search_web", "invocation_mode": "direct", "status": { "callable": true } },
                { "name": "execute_code_plan", "invocation_mode": "code_mode", "status": { "callable": true } }
            ]
        });

        let contract = CapabilityExecutionContract::from_runtime_inputs(
            Some(&request_allowed),
            Some(&snapshot),
        );

        assert_eq!(
            contract.allowed_tools,
            vec!["fetch_page".to_string(), "search_web".to_string()]
        );
        assert_eq!(contract.capability_snapshot, snapshot);
    }

    #[test]
    fn embed_into_context_embeds_contract_into_context() {
        let contract = CapabilityExecutionContract::from_runtime_inputs(
            Some(&["search_web".to_string()]),
            Some(&json!({
                "capabilities": [{
                    "name": "search_web",
                    "invocation_mode": "direct",
                    "status": {"callable": true}
                }]
            })),
        );
        let context = json!({"request": {"channel": "desktop"}});

        let result = contract.embed_into_context(context);

        assert_eq!(
            result["capability_contract"]["allowed_tools"],
            json!(["search_web"])
        );
    }
}
