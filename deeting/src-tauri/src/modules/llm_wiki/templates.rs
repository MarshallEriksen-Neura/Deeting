use std::path::Path;

use super::config::{READ_SCOPE_WHOLE_VAULT, WRITE_SCOPE_MANAGED_WORKSPACE};
use super::types::{LocalLlmWikiBinding, LocalLlmWikiVaultScanSummary};

pub(super) struct BootstrapFile {
    pub(super) relative_path: &'static str,
    pub(super) content: String,
}

pub(super) fn build_bootstrap_files(
    binding: &LocalLlmWikiBinding,
    summary: &LocalLlmWikiVaultScanSummary,
    now: &str,
) -> Vec<BootstrapFile> {
    vec![
        BootstrapFile {
            relative_path: "README-LLM-Wiki.md",
            content: render_readme(binding, summary),
        },
        BootstrapFile {
            relative_path: "AGENTS.md",
            content: render_agents(binding),
        },
        BootstrapFile {
            relative_path: "Home.md",
            content: render_home(binding, summary),
        },
        BootstrapFile {
            relative_path: "index.md",
            content: render_index(),
        },
        BootstrapFile {
            relative_path: "log.md",
            content: render_log(binding, summary, now),
        },
        BootstrapFile {
            relative_path: "wiki/analyses/initial-map.md",
            content: render_initial_map(binding, summary),
        },
        BootstrapFile {
            relative_path: "wiki/analyses/open-questions.md",
            content: render_open_questions(summary),
        },
    ]
}

pub(super) fn build_recommended_agent_prompt(binding: &LocalLlmWikiBinding) -> String {
    let workspace = Path::new(&binding.workspace_relative_path)
        .to_string_lossy()
        .replace('\\', "/");
    format!(
        r#"You maintain an LLM Wiki inside an Obsidian vault.

Read scope:
- Read the whole vault when needed for context.

Write scope:
- Default write scope is the managed workspace only: `{workspace}`.
- Do not rewrite unrelated legacy notes outside that workspace unless the user explicitly asks.

Operational rules:
- Treat retrieval lifecycle as internal runtime behavior: broad read, indexing, scoped retrieval, and candidate dedup stay outside page bodies.
- Treat markdown maintenance as a separate lifecycle: page structure and page-body merges remain the maintainer agent's responsibility.
- Treat `raw/` as immutable source material.
- Update `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, and `wiki/analyses/` incrementally.
- Update `index.md` whenever new maintained pages are added.
- Append meaningful maintenance events to `log.md`.
- When an answer has long-term value, crystallize it into `wiki/analyses/`.
- Promote to local memory only after a stronger repeated-stability filter than ordinary wiki writes.
- Prefer updating existing pages over creating duplicate pages.
- Flag contradictions and stale conclusions instead of silently hiding them.
- Do not treat generic write-guard merge behavior as page merge policy.

Goal:
- Keep the managed workspace current, structured, and useful over time."#
    )
}

fn render_readme(binding: &LocalLlmWikiBinding, summary: &LocalLlmWikiVaultScanSummary) -> String {
    format!(
        r#"# README-LLM-Wiki

This workspace is maintained by Deeting as a local LLM Wiki inside the Obsidian vault **{vault_name}**.

## What Deeting Does Here

- scans the vault locally for context
- keeps a managed wiki workspace up to date
- writes new maintained knowledge inside this workspace
- leaves legacy notes outside this workspace untouched by default

## Ownership Boundary

- Read scope: `{read_scope}`
- Write scope: `{write_scope}`

## Structure

- `raw/` stores source material and imported references
- `wiki/` stores maintained summaries, entities, concepts, and analyses
- `index.md` is the workspace catalog
- `log.md` records maintenance events
- `AGENTS.md` defines how Deeting and delegated agents should maintain this workspace

## Initial Snapshot

- Markdown notes scanned: {markdown_count}
- Attachments detected: {attachment_count}
- Candidate existing wiki folders: {candidate_count}

## Recommended Next Step

Open `Home.md`, then connect a custom task agent in Deeting so the workspace can be maintained through normal work."#,
        vault_name = binding.vault_name,
        read_scope = READ_SCOPE_WHOLE_VAULT,
        write_scope = WRITE_SCOPE_MANAGED_WORKSPACE,
        markdown_count = summary.total_markdown_files,
        attachment_count = summary.total_attachment_files,
        candidate_count = summary.candidate_folders.len(),
    )
}

fn render_agents(binding: &LocalLlmWikiBinding) -> String {
    format!(
        r#"# LLM Wiki Maintenance Contract

This workspace is maintained by Deeting inside the connected Obsidian vault.

## Read Boundary

- Read broadly across the connected vault for context and source discovery.

## Write Boundary

- Write by default only inside `{workspace}`.
- Do not rewrite unrelated legacy notes outside this workspace unless explicitly instructed.

## Source of Truth

- `raw/` contains source material and should be treated as immutable.
- `wiki/` contains maintained markdown knowledge that may be updated over time.
- lifecycle metadata, embeddings, retrieval state, and promotion ledgers stay in Deeting internals rather than in noisy page bodies.

## Maintenance Rules

- Retrieval lifecycle and markdown maintenance lifecycle are different layers. Use internal retrieval state to find candidates; do not confuse that with page truth.
- Prefer updating existing pages over creating duplicate pages.
- Keep `index.md` in sync with maintained pages.
- Append meaningful ingest, crystallization, lint, and supersession events to `log.md`.
- When an answer has long-term value, write it back into `wiki/analyses/`.
- Promote to local memory only after stronger repeated-stability filtering than ordinary wiki writes.
- When new evidence weakens an existing conclusion, mark the older conclusion as stale or superseded instead of silently dropping it.
- Keep page merge decisions inside the maintainer workflow; do not treat generic dedup merge behavior as page-body policy.
- Keep pages concise, linked, and readable in Obsidian.
"#,
        workspace = binding.workspace_relative_path.replace('\\', "/")
    )
}

fn render_home(binding: &LocalLlmWikiBinding, summary: &LocalLlmWikiVaultScanSummary) -> String {
    format!(
        r#"# Home

Welcome to the Deeting-managed LLM Wiki for **{vault_name}**.

## Current Boundaries

- Deeting reads the whole vault for context.
- Deeting writes only inside this managed workspace by default.

## What Was Detected

- {markdown_count} markdown notes
- {attachment_count} attachments
- {candidate_count} folders that look wiki-like

## Start Here

- [Index](index.md)
- [Initial Map](wiki/analyses/initial-map.md)
- [Open Questions](wiki/analyses/open-questions.md)
- [Log](log.md)

## Intent

This workspace is designed to compound over time:

- source material goes into `raw/`
- maintained knowledge grows in `wiki/`
- useful answers can be crystallized back into the workspace"#,
        vault_name = binding.vault_name,
        markdown_count = summary.total_markdown_files,
        attachment_count = summary.total_attachment_files,
        candidate_count = summary.candidate_folders.len(),
    )
}

fn render_index() -> String {
    r#"# Index

## Home

- [Home](Home.md) - Entry point for this managed workspace
- [Log](log.md) - Maintenance timeline

## Analyses

- [Initial Map](wiki/analyses/initial-map.md) - First local scan snapshot
- [Open Questions](wiki/analyses/open-questions.md) - Suggested follow-up exploration

## Concepts

No concept pages yet.

## Entities

No entity pages yet.

## Sources

No source summaries yet."#
        .to_string()
}

fn render_log(
    binding: &LocalLlmWikiBinding,
    summary: &LocalLlmWikiVaultScanSummary,
    now: &str,
) -> String {
    format!(
        r#"# Log

## [{timestamp}] bootstrap | Deeting Wiki initialized

- Vault: `{vault_name}`
- Managed workspace: `{workspace}`
- Markdown notes scanned: {markdown_count}
- Attachments detected: {attachment_count}
- Candidate wiki folders: {candidate_count}
"#,
        timestamp = now,
        vault_name = binding.vault_name,
        workspace = binding.workspace_relative_path.replace('\\', "/"),
        markdown_count = summary.total_markdown_files,
        attachment_count = summary.total_attachment_files,
        candidate_count = summary.candidate_folders.len(),
    )
}

fn render_initial_map(
    binding: &LocalLlmWikiBinding,
    summary: &LocalLlmWikiVaultScanSummary,
) -> String {
    let candidate_lines = if summary.candidate_folders.is_empty() {
        "- No obvious existing wiki folders were detected.".to_string()
    } else {
        summary
            .candidate_folders
            .iter()
            .map(|folder| format!("- `{}` ({})", folder.relative_path, folder.reason))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"# Initial Map

This page captures the first local scan snapshot for the connected vault **{vault_name}**.

## Scan Summary

- Markdown notes: {markdown_count}
- Attachments: {attachment_count}
- Directories scanned: {directory_count}
- Obsidian config detected: {obsidian_detected}

## Candidate Existing Knowledge Areas

{candidate_lines}

## Managed Workspace

This Deeting-managed workspace lives at `{workspace}`.

It should become the maintained synthesis layer, while older notes remain available as read-only context by default."#,
        vault_name = binding.vault_name,
        markdown_count = summary.total_markdown_files,
        attachment_count = summary.total_attachment_files,
        directory_count = summary.total_directories,
        obsidian_detected = if summary.detected_obsidian_config {
            "yes"
        } else {
            "no"
        },
        candidate_lines = candidate_lines,
        workspace = binding.workspace_relative_path.replace('\\', "/"),
    )
}

fn render_open_questions(summary: &LocalLlmWikiVaultScanSummary) -> String {
    let candidate_prompt = if summary.candidate_folders.is_empty() {
        "Should Deeting continue with only the managed workspace, or is there an existing notes area worth adopting later?"
            .to_string()
    } else {
        format!(
            "Which existing folder, if any, should later be adopted as a maintained area? Candidates detected: {}.",
            summary
                .candidate_folders
                .iter()
                .map(|folder| folder.relative_path.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    format!(
        r#"# Open Questions

Use these as the first prompts for Deeting or a delegated wiki-maintainer agent.

1. Which topics in the vault appear often enough to deserve first concept pages?
2. Which files are the best source material to summarize into the first `wiki/sources/` pages?
3. Which repeated entities should become explicit `wiki/entities/` pages?
4. {candidate_prompt}
5. Which recent conversations or analyses would be valuable to crystallize back into this workspace?
"#,
        candidate_prompt = candidate_prompt
    )
}
