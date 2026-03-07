# Desktop Local Provider API (SQLite)
Updated: 2026-03-06

## Scope
- This document describes desktop (Tauri) local provider commands in `modules/providers`.
- Goal: keep key fields and request execution behavior aligned with cloud `provider_preset`, `provider_instance`, and `provider_model` semantics.

## provider_presets
### Response fields
- `slug`
- `name`
- `provider`
- `base_url`
- `icon`
- `theme_color`
- `category`
- `url_template`
- `template_engine`
- `response_transform`
- `auth_type`
- `auth_config`
- `default_headers`
- `default_params`
- `capability_configs`
- `version`
- `is_active`

### Sync behavior
- Desktop preset metadata is synced from cloud `/api/v1/admin/provider-presets` into local SQLite.
- Desktop market/list/detail views read local synced presets after refresh.
- Inactive presets remain in local storage for compatibility, but desktop UI only exposes active presets.

## provider_instances
### Response fields
- `id`
- `preset_slug`
- `name`
- `base_url`
- `description`
- `icon`
- `priority`
- `meta` (JSON object, includes keys like `protocol`, `auto_append_v1`, `model_prefix`, `resource_name`, `deployment_name`, `api_version`, `project_id`, `region`)
- `is_enabled`
- `is_local`
- `credential_source` (`local` or `platform`)
- `credentials_ref`
- `created_at`
- `updated_at`

### Request fields
Supported by `create_local_provider_instance` and `update_local_provider_instance`:
- `name`, `base_url`, `description`, `icon`, `priority`
- `protocol`, `model_prefix`, `auto_append_v1`, `resource_name`, `deployment_name`, `api_version`, `project_id`, `region`
- `credential_source`
- `is_enabled` (update only)
- `secret_key` (optional, stored in keychain)

### Execution notes
- Desktop request execution now resolves request behavior primarily from synced preset `capability_configs` and model-level overrides.
- Instance `meta` remains the source of runtime connection hints such as `protocol`, `auto_append_v1`, `resource_name`, `deployment_name`, `api_version`, `project_id`, and `region`.
- Desktop no longer relies on instance-level `template_engine` / `response_transform` fallbacks for request execution.

## provider_models
### Response fields
- `id`
- `instance_id`
- `capabilities`
- `model_id`
- `unified_model_id`
- `display_name`
- `upstream_path`
- `pricing_config`
- `limit_config`
- `tokenizer_config`
- `routing_config`
- `config_override`
- `source`
- `extra_meta`
- `weight`
- `priority`
- `is_active`
- `synced_at`
- `created_at`
- `updated_at`

### Request fields
Supported by `update_local_provider_model`:
- `display_name`, `is_active`, `capabilities`
- `unified_model_id`, `upstream_path`
- `weight`, `priority`
- `pricing_config`, `limit_config`, `tokenizer_config`, `routing_config`, `config_override`
- `source`, `extra_meta`

## user_embedding_config
### Response fields
- `id`
- `user_id`
- `provider_model_id` (nullable, references `provider_models.id`)
- `created_at`
- `updated_at`

### Request fields
Supported by `update_local_user_embedding_config`:
- `provider_model_id` (nullable)

### Behavior
- If `provider_model_id` is set, desktop embedding routing uses this exact `provider_model_id` first.
- If configured model is unavailable or lacks `embedding` capability, runtime falls back to first active model with `embedding` capability.
- `provider_model_id` must reference an active model that includes `embedding` in `capabilities`.

## Request execution behavior
- Desktop chat, model test, and embedding requests use the shared Tauri provider request runtime.
- The runtime resolves:
  - protocol-aware upstream URL + query params
  - preset auth and default headers
  - capability-specific request template
  - optional `request_builder`
  - preset/model response transform
- Supported request builders currently include `ark_content_array`.
- Supported response-transform engines include `openai_compat`, `anthropic_messages`, `google_gemini`, and template-based transforms (`jinja2` / `handlebars`).

## Conversation context behavior
- Desktop local chat keeps full conversation history in local SQLite, while runtime prompt assembly uses a bounded active window plus the latest persisted summary.
- Runtime window loading now follows cloud-style context assembly semantics:
  - load latest summary metadata from `conversation_summary`
  - load latest active-window messages from `conversation_message`
  - assemble prompt as `system scaffolding + summary system message + active window messages`
- The desktop runtime no longer treats the UI history endpoint as the prompt source of truth.
- Local summary workers and runtime prompt loading share the same active-window definition so persisted `covered_from_turn` / `covered_to_turn` matches the messages actually summarized.
- Message append now also updates summary idle scheduling and threshold-triggered flush checks automatically.

## Capability behavior
- Desktop local capability filtering now mirrors cloud behavior:
  - normalize aliases such as `video -> video_generation`
  - merge `capabilities`, `routing_config.capabilities`, and `extra_meta.upstream_capabilities`
- On startup, desktop backfills legacy provider model capability data into canonical values.
- Updating `routing_config.capabilities` also mirrors normalized values back into the dedicated `capabilities` column.

## Compatibility notes
- Missing legacy columns are added during init and backfilled with defaults.
- Legacy unique index `idx_provider_models_instance_model` is replaced by `(instance_id, model_id, upstream_path)`.
- Legacy `provider_instances.template_engine` / `response_transform` columns may still exist in older local databases, but desktop execution no longer depends on them.

## Tauri Commands (Embedding Config)
- `get_local_user_embedding_config`
- `update_local_user_embedding_config`
