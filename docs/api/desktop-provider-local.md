# Desktop Local Provider API (SQLite)
Updated: 2026-03-03

## Scope
- This document describes desktop (Tauri) local provider commands in `modules/providers`.
- Goal: keep key fields aligned with cloud `provider_instance` and `provider_model` semantics.

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
- `credentials_ref`
- `created_at`
- `updated_at`

### Request fields
Supported by `create_local_provider_instance` and `update_local_provider_instance`:
- `name`, `base_url`, `description`, `icon`, `priority`
- `protocol`, `model_prefix`, `auto_append_v1`, `resource_name`, `deployment_name`, `api_version`, `project_id`, `region`
- `is_enabled` (update only)
- `secret_key` (optional, stored in keychain)

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

## Compatibility notes
- Missing legacy columns are added during init and backfilled with defaults.
- Legacy unique index `idx_provider_models_instance_model` is replaced by `(instance_id, model_id, upstream_path)`.
