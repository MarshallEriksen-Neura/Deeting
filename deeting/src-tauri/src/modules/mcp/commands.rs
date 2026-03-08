mod support;

#[path = "commands_parts/common.rs"]
pub(crate) mod common_impl;
#[path = "commands_parts/sources_tools_and_chat.rs"]
pub(crate) mod sources_tools_and_chat_impl;
#[path = "commands_parts/assistants_knowledge_admin.rs"]
pub(crate) mod assistants_knowledge_admin_impl;
#[path = "commands_parts/admin_logs.rs"]
pub(crate) mod admin_logs_impl;
#[path = "commands_parts/assistant_management.rs"]
pub(crate) mod assistant_management_impl;
#[path = "commands_parts/admin_conversations.rs"]
pub(crate) mod admin_conversations_impl;
#[path = "commands_parts/admin_summary_jobs.rs"]
pub(crate) mod admin_summary_jobs_impl;
#[path = "commands_parts/knowledge_folders.rs"]
pub(crate) mod knowledge_folders_impl;
#[path = "commands_parts/knowledge_documents.rs"]
pub(crate) mod knowledge_documents_impl;
#[path = "commands_parts/config_and_skills.rs"]
pub(crate) mod config_and_skills_impl;
#[path = "commands_parts/conversation_management.rs"]
pub(crate) mod conversation_management_impl;
#[path = "commands_parts/skill_registry.rs"]
pub(crate) mod skill_registry_impl;
#[path = "commands_parts/source_management.rs"]
pub(crate) mod source_management_impl;

pub mod admin;
pub mod assistants;
pub mod config;
pub mod conversations;
pub mod knowledge;
pub mod runtime;
pub mod skills;
pub mod sources;
pub mod tools;

pub use admin::*;
pub use assistants::*;
pub use config::*;
pub use conversations::*;
pub use knowledge::*;
pub use skills::*;
pub use sources::*;
pub use tools::*;

#[cfg(test)]
pub(crate) use support::*;
pub(crate) use assistants_knowledge_admin_impl::index_mcp_tools;
pub(crate) use assistant_management_impl::index_local_assistants;
pub(crate) use runtime::{
    generate_local_conversation_title_with_model, rebuild_local_knowledge_vector_index,
    request_local_auxiliary_text, resolve_local_model_connection,
    run_local_chat_complete_with_auto_code_mode, start_local_conversation_summary_worker,
    start_local_periodic_worker, sync_source_inner,
};
pub(crate) use skill_registry_impl::register_local_skills_inner;

#[cfg(test)]
pub(crate) use skill_registry_impl::{
    normalize_skill_dir_name, sync_local_skill_installs_from_cloud_inner,
};
#[cfg(test)]
pub(crate) use runtime::{
    build_auto_code_mode_tool_feedback,
    build_local_consult_expert_network_result_with_runtime,
    build_local_tool_call_install_gate_error_meta, build_local_tool_trace_blocks,
    derive_skill_name_from_repo_url, extract_chat_tool_calls, hash_config,
    parse_skill_onboarding_payload, read_local_mcp_config,
    LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
#[cfg(test)]
pub(crate) use runtime::{
    approve_mcp_tool_inner,
    execute_or_queue_mcp_tool_call, normalize_chat_completion_response, reject_mcp_tool_inner,
    process_next_local_conversation_summary_job_with_store, resolve_skill_env,
};

#[cfg(test)]
pub(crate) use runtime::{
    build_local_code_mode_entry_tools, build_local_sdk_search_result_with_runtime,
};

#[cfg(test)]
include!("commands_parts/tests.rs");
