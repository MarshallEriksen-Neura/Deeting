use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextTraceEvent {
    pub state: String,
    pub detail: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContextTrace {
    pub trace_id: Option<String>,
    pub events: Vec<ContextTraceEvent>,
}

impl ContextTrace {
    pub fn new(trace_id: Option<String>) -> Self {
        Self {
            trace_id,
            events: Vec::new(),
        }
    }

    pub fn record(mut self, state: impl Into<String>, detail: Value) -> Self {
        self.events.push(ContextTraceEvent {
            state: state.into(),
            detail,
        });
        self
    }
}
