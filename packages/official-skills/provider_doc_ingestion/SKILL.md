---
name: provider_doc_ingestion
description: "Provider documentation acquisition and evidence-first candidate drafting for desktop-local provider onboarding."
---

# Provider Doc Ingestion

## Overview

Official skill for collecting provider documentation pages, extracting source-linked protocol evidence, and drafting verify-ready provider preset candidates.

- Runtime: `local`
- Access: `all`
- Permissions: `network.outbound`

This skill is the ingestion lane. It does not publish provider presets by itself.

## Available Tools

- `collect_provider_doc_evidence` — Fetch one or more provider documentation pages and return raw evidence items plus any fetch failures.
- `draft_provider_candidate` — Convert a structured extraction report into a provider preset candidate with verification gaps preserved and a ready-to-use `provider_registry_handoff` payload.
- `score_provider_candidate_readiness` — Report whether the drafted candidate is ready for schema alignment and dry-run verification.
- `build_provider_registry_handoff` — Rebuild the explicit downstream tool payloads from a candidate if AI or UI needs a clean final handoff object.

## Usage Notes

- Use this skill before `provider_registry` when the source of truth is a provider's public documentation.
- Keep `explicit` and `inferred` evidence separate.
- Do not publish directly from this package.
- `collect_provider_doc_evidence` also returns:
  - `protocol_profile_template`
  - `provider_registry_handoff_template`
- `draft_provider_candidate` returns:
  - `protocol_profiles`
  - `provider_registry_handoff`
- `build_provider_registry_handoff` returns:
  - `handoff.get_unified_schema`
  - `handoff.verify_provider_template`
  - `handoff.save_local_provider_preset`
- The intended downstream flow is:
  1. `collect_provider_doc_evidence`
  2. external or model-assisted extraction into `ProviderExtractionReport`
  3. `draft_provider_candidate`
  4. `score_provider_candidate_readiness`
  5. handoff to `provider_registry.get_unified_schema`
  6. handoff to `provider_registry.verify_provider_template`
  7. write to the local provider market file only after verification succeeds
