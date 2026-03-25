---
name: provider_registry
description: "Expert plugin for discovering and registering AI Providers."
---

# Provider Registry

## Overview

Expert plugin for discovering AI Providers and uploading provider presets to the cloud registry from the desktop runtime.

- Runtime: `local`
- Access: `all`
- Permissions: `network.outbound`

## Available Tools

- `get_unified_schema` — Get the desktop runtime's canonical request/response schema and protocol profile expectations for a capability. Required: `capability`.
- `verify_provider_template` — Dry-run a desktop-local provider protocol profile or request template against a real provider API. Required: `base_url`, `test_api_key`, `request_template`. Optional: `capability`, `protocol_family`, `upstream_path`, `template_engine`, `header_template`, `query_template`, `request_builder`, `response_template`, `output_mapping`, `default_headers`, `default_params`, `test_payload`.
- `save_provider_to_marketplace` — Create or update a cloud provider preset so it appears in the cloud preset registry. Required: `slug`, `name`, `provider`, `base_url`. Optional: `category`, `url_template`, `theme_color`, `icon`, `auth_type`, `auth_config`, `protocol_schema_version`, `protocol_profiles`, `version`, `is_active`. Full chat endpoints such as `/v1/chat/completions` are normalized into `base_url + protocol_profiles.chat.transport.path`.

## Usage Notes

- Keep requests within the tools listed above.
- This package is currently unrestricted in the desktop-local runtime.
