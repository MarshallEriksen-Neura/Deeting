use serde_json::{json, Value};

use super::runtime_transition::projection::{
    project_capability_contract_decision_block, CapabilityContractProjectionInput,
};

fn sanitize_contract_allowed_tools(allowed_tools: Vec<String>) -> Vec<String> {
    allowed_tools
        .into_iter()
        .filter(|tool_name| tool_name != "execute_code_plan")
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CapabilityExecutionContract {
    pub(crate) allowed_tools: Vec<String>,
    pub(crate) capability_snapshot: Value,
}

impl CapabilityExecutionContract {
    pub(crate) fn from_search_result(search_result: Option<&Value>) -> Result<Self, String> {
        let Some(search_result) = search_result else {
            return Err(
                "codemode execution requires a prior search_sdk result with callable host capabilities"
                    .to_string(),
            );
        };
        mcp_runtime::capability_snapshot::extract_callable_direct_capability_names(search_result)?;
        let allowed_tools = sanitize_contract_allowed_tools(
            mcp_runtime::capability_snapshot::merge_allowed_tool_names(&[], Some(search_result)),
        );
        Ok(Self {
            allowed_tools,
            capability_snapshot: search_result.clone(),
        })
    }

    pub(crate) fn from_runtime_inputs(
        request_allowed_tools: Option<&[String]>,
        capability_snapshot: Option<&Value>,
    ) -> Self {
        Self {
            allowed_tools: sanitize_contract_allowed_tools(
                mcp_runtime::capability_snapshot::merge_allowed_tool_names(
                    request_allowed_tools.unwrap_or(&[]),
                    capability_snapshot,
                ),
            ),
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

    pub(crate) fn project_runtime_transition_block(
        &self,
        trace_id: &str,
        request_id: Option<&str>,
        session_id: &str,
        call_id: &str,
    ) -> Value {
        project_capability_contract_decision_block(CapabilityContractProjectionInput {
            trace_id,
            request_id,
            session_id,
            call_id,
            allowed_tools: &self.allowed_tools,
            capability_snapshot: &self.capability_snapshot,
        })
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
                {"name": "execute_code_plan", "invocation_mode": "direct", "status": {"callable": true}}
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
                { "name": "execute_code_plan", "invocation_mode": "direct", "status": { "callable": true } }
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
    fn runtime_transition_projection_does_not_change_allowed_tools() {
        let contract = CapabilityExecutionContract::from_runtime_inputs(
            Some(&["search_web".to_string(), "execute_code_plan".to_string()]),
            Some(&json!({
                "capabilities": [{
                    "name": "search_web",
                    "invocation_mode": "direct",
                    "status": {"callable": true}
                }]
            })),
        );
        let allowed_before = contract.allowed_tools.clone();

        let block = contract.project_runtime_transition_block(
            "trace-1",
            Some("request-1"),
            "session-1",
            "execute-call-1",
        );

        assert_eq!(contract.allowed_tools, allowed_before);
        assert_eq!(contract.allowed_tools, vec!["search_web"]);
        assert_eq!(block["payload"]["source"], json!("capability_contract"));
        assert_eq!(
            block["payload"]["required_artifact"],
            json!("capability_lease")
        );
        assert_eq!(
            block["payload"]["transition"]["metadata_json"]["allowed_tools"],
            json!(allowed_before)
        );
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
