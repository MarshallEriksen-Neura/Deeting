use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceType {
    Memory,
    LlmWiki,
    Knowledge,
}

impl ContextSourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::LlmWiki => "llm_wiki",
            Self::Knowledge => "knowledge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextCoverage {
    Empty,
    Sparse,
    Focused,
    Broad,
}

impl ContextCoverage {
    pub fn from_item_count(count: usize) -> Self {
        match count {
            0 => Self::Empty,
            1..=2 => Self::Sparse,
            3..=8 => Self::Focused,
            _ => Self::Broad,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextNextAction {
    AnswerWithEvidence,
    SearchAgain,
    OpenSource,
    ExpandContext,
    AskClarifyingQuestion,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextSourceRef {
    pub source_type: ContextSourceType,
    pub id: String,
    pub label: Option<String>,
    pub locator: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextEvidenceItem {
    pub id: String,
    pub source_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub score: f64,
    pub score_breakdown: Value,
    pub source_refs: Vec<ContextSourceRef>,
    pub quality_flags: Vec<String>,
    pub lifecycle: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextEvidenceEnvelope {
    pub source_type: ContextSourceType,
    pub query: String,
    pub items: Vec<ContextEvidenceItem>,
    pub coverage: ContextCoverage,
    pub score_semantics: String,
    pub recommended_next_action: ContextNextAction,
    pub trace: crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace,
}

impl ContextEvidenceEnvelope {
    pub fn new(
        source_type: ContextSourceType,
        query: impl Into<String>,
        items: Vec<ContextEvidenceItem>,
        score_semantics: impl Into<String>,
        recommended_next_action: ContextNextAction,
        trace: crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace,
    ) -> Self {
        let coverage = ContextCoverage::from_item_count(items.len());
        Self {
            source_type,
            query: query.into(),
            items,
            coverage,
            score_semantics: score_semantics.into(),
            recommended_next_action,
            trace,
        }
    }

    pub fn source_scores(&self) -> Vec<f64> {
        self.items.iter().map(|item| item.score).collect()
    }
}
