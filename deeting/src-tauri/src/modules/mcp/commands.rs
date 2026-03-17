mod support;

#[path = "commands_parts/admin_conversations.rs"]
pub(crate) mod admin_conversations_impl;
#[path = "commands_parts/admin_logs.rs"]
pub(crate) mod admin_logs_impl;
#[path = "commands_parts/admin_summary_jobs.rs"]
pub(crate) mod admin_summary_jobs_impl;
#[path = "commands_parts/assistant_management.rs"]
pub(crate) mod assistant_management_impl;
#[path = "commands_parts/assistants_knowledge_admin.rs"]
pub(crate) mod assistants_knowledge_admin_impl;
#[path = "commands_parts/common.rs"]
pub(crate) mod common_impl;
#[path = "commands_parts/config_and_skills.rs"]
pub(crate) mod config_and_skills_impl;
#[path = "commands_parts/conversation_management.rs"]
pub(crate) mod conversation_management_impl;
#[path = "commands_parts/maintenance.rs"]
pub(crate) mod maintenance_impl;
#[path = "commands_parts/skill_registry_impl.rs"]
pub(crate) mod skill_registry_impl;
#[path = "commands_parts/skill_registry_refresh.rs"]
pub(crate) mod skill_registry_refresh_impl;
#[path = "commands_parts/skill_registry_scan.rs"]
pub(crate) mod skill_registry_scan_impl;
#[path = "commands_parts/source_management.rs"]
pub(crate) mod source_management_impl;
#[path = "commands_parts/sources_tools_and_chat.rs"]
pub(crate) mod sources_tools_and_chat_impl;

pub mod runtime;

pub use admin_conversations_impl::{
    get_local_admin_conversation, list_local_admin_conversation_messages,
    list_local_admin_conversation_summaries, list_local_admin_conversations,
};
pub use admin_logs_impl::{
    create_local_gateway_log, create_local_trace_feedback, get_local_gateway_log_stats,
    list_local_gateway_logs,
};
pub use admin_summary_jobs_impl::{
    enqueue_local_conversation_summary, get_local_conversation_summary_queue_stats,
    list_local_conversation_summary_idle_tasks, list_local_conversation_summary_jobs,
    retry_local_conversation_summary_batch, retry_local_conversation_summary_job,
    retry_local_conversation_summary_jobs, trigger_local_conversation_summary_job,
};
pub use assistant_management_impl::{
    append_assistant_message, create_assistant_message, create_local_assistant,
    delete_assistant_messages, delete_local_assistant, get_local_assistant_preview,
    get_local_assistant_routing_report, install_local_assistant, list_assistant_messages,
    list_local_assistant_entities, list_local_assistant_installations,
    list_local_assistant_installs, list_local_assistant_tags, list_local_assistant_versions,
    list_local_assistants, preview_local_assistant, rate_local_assistant,
    record_local_assistant_rating, record_local_assistant_routing_feedback,
    record_local_assistant_routing_trial, uninstall_local_assistant, update_local_assistant,
    update_local_assistant_install,
};
pub use assistants_knowledge_admin_impl::{
    approve_mcp_tool, reject_mcp_tool, sync_cloud_subscriptions_v2,
};
pub use config_and_skills_impl::{
    disable_local_skill, enable_local_skill, get_desktop_config,
    get_effective_desktop_scout_base_url, get_local_gateway_url, set_cloud_base_url,
    set_desktop_config, sync_official_skills_index,
};
pub use conversation_management_impl::{
    append_local_conversation_message, archive_local_conversation, clear_local_conversation,
    close_local_conversation, create_local_conversation, delete_local_conversation_message,
    list_local_conversations, rename_local_conversation, unarchive_local_conversation,
};
pub use maintenance_impl::{
    get_local_capability_registry_diagnostics, list_local_maintenance_logs,
    run_local_maintenance_action,
};
pub use skill_registry_impl::{
    install_local_skill_runtime, install_skill_from_repo, list_local_installed_skill_ids,
    list_local_skill_runtime_statuses, uninstall_skill, update_local_skill_runtime_settings,
};
pub use skill_registry_refresh_impl::register_local_skills;
pub use source_management_impl::{
    create_mcp_source, list_mcp_sources, list_mcp_tools, sync_cloud_subscriptions, sync_mcp_source,
};
pub use sources_tools_and_chat_impl::{
    apply_pending_config, archive_local_conversation_session, clear_local_conversation_session,
    clear_mcp_logs, create_local_conversation_session, delete_assistant_message,
    delete_local_conversation_session, delete_local_mcp_tool, execute_mcp_tool_raw,
    get_desktop_config_value, get_local_conversation_window, get_mcp_logs, import_mcp_config,
    list_local_conversation_history, list_local_conversation_sessions,
    rename_local_conversation_session, resolve_mcp_conflict, set_desktop_config_value,
    start_mcp_tool, stop_mcp_tool, update_assistant_message, update_mcp_tool_env,
};

pub(crate) use assistant_management_impl::index_local_assistants;
pub(crate) use assistants_knowledge_admin_impl::index_mcp_tools;
pub(crate) use runtime::{
    generate_local_conversation_title_with_model, rebuild_local_knowledge_vector_index,
    request_local_auxiliary_text, resolve_local_model_connection,
    start_local_conversation_summary_worker, start_local_periodic_worker, sync_source_inner,
};
pub(crate) use skill_registry_impl::{
    auto_install_official_skill_runtimes, collect_local_skill_tool_bindings,
    install_skill_to_local, is_hidden_name, normalize_skill_dir_name,
    purge_legacy_skill_tool_state, reindex_local_skill_bundle_asset,
    resolve_local_skill_definition, resolve_skill_backend_entry_path, LocalSkillDefinition,
    LocalSkillToolBindingDefinition,
};
pub(crate) use skill_registry_refresh_impl::register_local_skills_inner;
pub(crate) use skill_registry_scan_impl::{
    register_local_skills_from_scan_targets_inner, resolve_local_skill_scan_targets,
};
#[cfg(test)]
pub(crate) use support::*;
pub(crate) use support::{resolve_effective_desktop_scout_base_url, SCOUT_SERVICE_URL_ENV_KEY};

#[cfg(test)]
pub(crate) use runtime::{
    build_auto_code_mode_tool_feedback, build_local_consult_expert_network_result_with_runtime,
    build_local_tool_call_install_gate_error_meta, build_local_tool_trace_blocks,
    derive_skill_name_from_repo_url, extract_chat_tool_calls, hash_config,
    parse_skill_onboarding_payload, read_local_mcp_config,
    LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
#[cfg(test)]
pub(crate) use runtime::{
    normalize_chat_completion_response, process_next_local_conversation_summary_job_with_store,
    reject_mcp_tool_inner, resolve_skill_env,
};
#[cfg(test)]
pub(crate) use source_management_impl::{
    local_skill_registration_self_heal_needed, reset_local_asset_catalog_then_sync_inner,
    sync_local_system_assets_inner,
};
#[cfg(test)]
pub(crate) use sources_tools_and_chat_impl::{
    build_remote_transport_log_entries, start_remote_transport_tool, stop_remote_transport_tool,
};

#[cfg(test)]
pub(crate) use runtime::{
    build_local_code_mode_entry_tools, build_local_sdk_search_result_with_runtime,
};

#[cfg(test)]
include!("commands_parts/tests.rs");
