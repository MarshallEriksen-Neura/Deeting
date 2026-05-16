use serde::{Deserialize, Serialize};

use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;
use crate::modules::desktop_runtime::context_orchestrator::policy::ContextRoutingPolicy;
use crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace;

pub const CONTEXT_TOOL_NAMES: &[&str] = &[
    "context_search",
    "context_open",
    "context_expand",
    "context_summarize_evidence",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextOrchestratorState {
    BuildManifest,
    ClassifyNeed,
    PlanSources,
    Retrieve,
    EvaluateCoverage,
    ExpandIfNeeded,
    CompressIfNeeded,
    EmitBundle,
    RecordTrace,
}

#[derive(Debug, Clone)]
pub struct ContextOrchestrator {
    pub policy: ContextRoutingPolicy,
}

impl Default for ContextOrchestrator {
    fn default() -> Self {
        Self {
            policy: ContextRoutingPolicy::default(),
        }
    }
}

impl ContextOrchestrator {
    pub fn trace_for_manifest(
        &self,
        trace_id: Option<String>,
        manifest: &ContextManifest,
    ) -> ContextTrace {
        ContextTrace::new(trace_id).record(
            "build_manifest",
            serde_json::json!({
                "core_memory_count": manifest.core_memories.len(),
                "selected_knowledge_count": manifest.selected_knowledge.len(),
                "available_sources": manifest
                    .available_sources
                    .iter()
                    .map(|source| source.as_str())
                    .collect::<Vec<_>>(),
                "available_tools": manifest.available_tools,
            }),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectedKnowledgeManifestItem {
    pub file_id: String,
    pub file_name: String,
    pub status: String,
    pub chunk_count: Option<i64>,
    pub folder_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextManifest {
    pub core_memories: Vec<String>,
    pub selected_knowledge: Vec<SelectedKnowledgeManifestItem>,
    pub available_sources: Vec<ContextSourceType>,
    pub available_tools: Vec<String>,
}

impl ContextManifest {
    pub fn new(
        core_memories: Vec<String>,
        selected_knowledge: Vec<SelectedKnowledgeManifestItem>,
    ) -> Self {
        Self {
            core_memories,
            selected_knowledge,
            available_sources: vec![
                ContextSourceType::Memory,
                ContextSourceType::LlmWiki,
                ContextSourceType::Knowledge,
            ],
            available_tools: CONTEXT_TOOL_NAMES
                .iter()
                .map(|tool| (*tool).to_string())
                .collect(),
        }
    }
}

pub fn render_context_manifest_prompt(manifest: &ContextManifest) -> Option<String> {
    if manifest.core_memories.is_empty()
        && manifest.selected_knowledge.is_empty()
        && manifest.available_tools.is_empty()
    {
        return None;
    }

    let mut lines = vec![
        "## Context Manifest".to_string(),
        "Use this manifest to decide whether to call context tools. It lists available sources but does not include retrieved knowledge chunks.".to_string(),
    ];

    if !manifest.core_memories.is_empty() {
        lines.push("### Core Memories".to_string());
        for memory in &manifest.core_memories {
            let trimmed = memory.trim();
            if !trimmed.is_empty() {
                lines.push(format!("- {trimmed}"));
            }
        }
    }

    if !manifest.selected_knowledge.is_empty() {
        lines.push("### Selected Knowledge Files".to_string());
        for item in &manifest.selected_knowledge {
            let chunk_count = item
                .chunk_count
                .map(|count| count.max(0).to_string())
                .unwrap_or_else(|| "unknown".to_string());
            lines.push(format!(
                "- {} (file_id: {}, status: {}, chunks: {})",
                item.file_name, item.file_id, item.status, chunk_count
            ));
        }
        lines.push("Open or search selected knowledge through context tools before using document evidence.".to_string());
        let selected_file_ids_inline = manifest
            .selected_knowledge
            .iter()
            .map(|item| format!("\"{}\"", item.file_id))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "To search inside these selected files, call `context_search` with `scope: \"selected\"` and `filters.selected_file_ids: [{selected_file_ids_inline}]`. If `selected_file_ids` is omitted in selected scope, the runtime falls back to the files listed here."
        ));
        lines.push(
            "To open a specific chunk, call `context_open` with `source_type: \"knowledge\"`, `file_id`, and optional `chunk_index`.".to_string(),
        );
    }

    if !manifest.available_sources.is_empty() {
        let sources = manifest
            .available_sources
            .iter()
            .map(|source| source.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Available context sources: {sources}."));
    }

    if !manifest.available_tools.is_empty() {
        lines.push(format!(
            "Available context tools: {}.",
            manifest.available_tools.join(", ")
        ));
    }

    Some(lines.join("\n"))
}
