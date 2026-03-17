pub(crate) use crate::modules::assistants::commands::index_local_assistants;
pub use crate::modules::assistants::commands::{
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
