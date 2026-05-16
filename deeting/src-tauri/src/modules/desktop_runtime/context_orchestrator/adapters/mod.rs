pub mod knowledge;
pub mod llm_wiki;
pub mod memory;

use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;

pub trait ContextSourceAdapter {
    fn source_type(&self) -> ContextSourceType;
    fn score_semantics(&self) -> &'static str;
}
