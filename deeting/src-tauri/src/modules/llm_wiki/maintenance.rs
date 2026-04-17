use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use mcp_storage::helpers::now_rfc3339;

use crate::state::AppState;

use super::config::{
    load_binding, normalize_vault_root, resolve_workspace_path, save_last_lint_report,
};
use super::corpus::reconcile_corpus;
use super::types::{
    IngestLocalLlmWikiSelectionRequest, LocalLlmWikiLintFinding, LocalLlmWikiLintReport,
};

pub(super) async fn ingest_selection(
    app_state: &AppState,
    payload: IngestLocalLlmWikiSelectionRequest,
) -> Result<(Vec<String>, Vec<String>, Vec<String>, Vec<String>), String> {
    let binding = load_binding(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;
    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let now = now_rfc3339().map_err(|err| err.to_string())?;

    let mut ingested_paths = Vec::new();
    let mut skipped_paths = Vec::new();
    let mut source_pages_created = Vec::new();
    let mut raw_files_copied = Vec::new();

    for raw_relative in payload.selected_relative_paths {
        let normalized_relative = raw_relative.trim().replace('\\', "/");
        if normalized_relative.is_empty() {
            continue;
        }
        let absolute = vault_root.join(&normalized_relative);
        if !absolute.exists() {
            skipped_paths.push(normalized_relative);
            continue;
        }
        if absolute.starts_with(&workspace_path) {
            skipped_paths.push(normalized_relative);
            continue;
        }
        if absolute.is_dir() {
            let files = collect_files_recursively(&absolute)?;
            for file in files {
                let relative = file
                    .strip_prefix(&vault_root)
                    .unwrap_or(&file)
                    .to_string_lossy()
                    .replace('\\', "/");
                ingest_one(
                    &file,
                    relative,
                    &workspace_path,
                    &now,
                    &mut ingested_paths,
                    &mut skipped_paths,
                    &mut source_pages_created,
                    &mut raw_files_copied,
                )?;
            }
            continue;
        }

        ingest_one(
            &absolute,
            normalized_relative,
            &workspace_path,
            &now,
            &mut ingested_paths,
            &mut skipped_paths,
            &mut source_pages_created,
            &mut raw_files_copied,
        )?;
    }

    append_log_entries(
        workspace_path.join("log.md"),
        &now,
        &ingested_paths,
        &source_pages_created,
        &raw_files_copied,
    )?;

    let _ = reconcile_corpus(app_state, &vault_root, &workspace_path).await?;
    Ok((
        ingested_paths,
        skipped_paths,
        source_pages_created,
        raw_files_copied,
    ))
}

pub(super) async fn run_lint(app_state: &AppState) -> Result<LocalLlmWikiLintReport, String> {
    let binding = load_binding(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;
    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let report = build_lint_report(&workspace_path)?;
    save_last_lint_report(app_state.mcp.store.as_ref(), &report)
        .await
        .map_err(|err| err.to_string())?;
    Ok(report)
}

fn ingest_one(
    absolute: &Path,
    relative: String,
    workspace_path: &Path,
    now: &str,
    ingested_paths: &mut Vec<String>,
    _skipped_paths: &mut Vec<String>,
    source_pages_created: &mut Vec<String>,
    raw_files_copied: &mut Vec<String>,
) -> Result<(), String> {
    let extension = absolute
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "md" {
        let source_pages_dir = workspace_path.join("wiki").join("sources");
        fs::create_dir_all(&source_pages_dir)
            .map_err(|err| format!("failed to create {}: {}", source_pages_dir.display(), err))?;
        let stem = absolute
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("source");
        let target = source_pages_dir.join(format!("{}.md", slugify(stem)));
        if !target.exists() {
            let content = fs::read_to_string(absolute)
                .map_err(|err| format!("failed to read {}: {}", absolute.display(), err))?;
            let summary = summarize_text(&content, 420);
            fs::write(
                &target,
                format!(
                    "# {}\n\n## Source Path\n\n`{}`\n\n## Ingested At\n\n`{}`\n\n## Summary\n\n{}\n",
                    stem, relative, now, summary
                ),
            )
            .map_err(|err| format!("failed to write {}: {}", target.display(), err))?;
            source_pages_created.push(
                target
                    .strip_prefix(workspace_path)
                    .unwrap_or(&target)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
        ingested_paths.push(relative);
        return Ok(());
    }

    let raw_bucket = if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    ) {
        "images"
    } else {
        "docs"
    };
    let target_dir = workspace_path.join("raw").join(raw_bucket);
    fs::create_dir_all(&target_dir)
        .map_err(|err| format!("failed to create {}: {}", target_dir.display(), err))?;
    let file_name = absolute
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("source.bin");
    let target = unique_copy_target(&target_dir, file_name);
    fs::copy(absolute, &target)
        .map_err(|err| format!("failed to copy {}: {}", absolute.display(), err))?;
    raw_files_copied.push(
        target
            .strip_prefix(workspace_path)
            .unwrap_or(&target)
            .to_string_lossy()
            .replace('\\', "/"),
    );
    ingested_paths.push(relative);
    Ok(())
}

fn build_lint_report(workspace_path: &Path) -> Result<LocalLlmWikiLintReport, String> {
    let generated_at = now_rfc3339().map_err(|err| err.to_string())?;
    let markdown_files = collect_markdown_files(workspace_path)?;
    let mut findings = Vec::new();

    let index_content = read_if_exists(workspace_path.join("index.md"))?;
    let indexed_paths = extract_indexed_paths(index_content.as_deref().unwrap_or_default());

    let mut title_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut incoming_links: HashMap<String, HashSet<String>> = HashMap::new();

    for path in &markdown_files {
        let relative = path
            .strip_prefix(workspace_path)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let content = read_if_exists(path)?.unwrap_or_default();
        let title = extract_title(path, &content);
        title_map
            .entry(normalize_title(&title))
            .or_default()
            .push(relative.clone());

        for linked in extract_local_links(&content) {
            incoming_links
                .entry(linked)
                .or_default()
                .insert(relative.clone());
        }

        if relative.starts_with("wiki/analyses/") && content.trim().len() < 180 {
            findings.push(make_finding(
                "low_value_analysis",
                "medium",
                "medium",
                "Analysis page is still too thin",
                "This analysis page has too little substance to justify a maintained analysis slot yet.",
                Some(relative.clone()),
                Vec::new(),
            ));
        }

        if relative.starts_with("wiki/sources/")
            && !content.to_ascii_lowercase().contains("## source path")
        {
            findings.push(make_finding(
                "source_summary_gap",
                "medium",
                "high",
                "Source summary is missing source attribution",
                "This source page does not include an explicit source-path section.",
                Some(relative.clone()),
                Vec::new(),
            ));
        }

        if content.trim().len() > 220 && extract_local_links(&content).is_empty() {
            findings.push(make_finding(
                "weak_links",
                "low",
                "medium",
                "Page has no local links",
                "This page is long enough to maintain, but it does not link to nearby wiki context yet.",
                Some(relative.clone()),
                Vec::new(),
            ));
        }
    }

    for duplicates in title_map.values().filter(|paths| paths.len() > 1) {
        findings.push(make_finding(
            "duplicate_title",
            "high",
            "high",
            "Duplicate page titles detected",
            "Multiple pages normalize to the same title and are likely competing claims or duplicate pages.",
            None,
            duplicates.clone(),
        ));
    }

    for path in &markdown_files {
        let relative = path
            .strip_prefix(workspace_path)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        if !relative.starts_with("wiki/") {
            continue;
        }
        if relative.starts_with("wiki/analyses/") || relative.starts_with("wiki/sources/") {
            if !indexed_paths.contains(&relative)
                && incoming_links
                    .get(&relative)
                    .map(|v| v.is_empty())
                    .unwrap_or(true)
            {
                findings.push(make_finding(
                    "orphan_page",
                    "medium",
                    "medium",
                    "Wiki page looks orphaned",
                    "This page is neither linked from index.md nor referenced by another wiki page.",
                    Some(relative),
                    Vec::new(),
                ));
            }
        }
    }

    let supersession_candidates = build_supersession_candidates(&markdown_files, workspace_path)?;
    findings.extend(supersession_candidates);

    let finding_count = findings.len() as i64;
    Ok(LocalLlmWikiLintReport {
        generated_at,
        finding_count,
        findings,
    })
}

fn build_supersession_candidates(
    markdown_files: &[PathBuf],
    workspace_path: &Path,
) -> Result<Vec<LocalLlmWikiLintFinding>, String> {
    let mut by_signature: HashMap<String, Vec<String>> = HashMap::new();
    for path in markdown_files {
        let relative = path
            .strip_prefix(workspace_path)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let signature = normalize_title(stem)
            .chars()
            .filter(|ch| !ch.is_ascii_digit())
            .collect::<String>();
        if signature.len() < 5 {
            continue;
        }
        by_signature.entry(signature).or_default().push(relative);
    }

    Ok(by_signature
        .into_values()
        .filter(|paths| paths.len() > 1)
        .map(|paths| {
            make_finding(
                "candidate_supersession",
                "medium",
                "low",
                "Pages may need supersession review",
                "These pages have very similar normalized names and may need merge/supersession review.",
                None,
                paths,
            )
        })
        .collect())
}

fn append_log_entries(
    log_path: PathBuf,
    now: &str,
    ingested_paths: &[String],
    source_pages_created: &[String],
    raw_files_copied: &[String],
) -> Result<(), String> {
    let mut lines = Vec::new();
    lines.push(format!("## [{}] ingest | Selection ingested", now));
    if !ingested_paths.is_empty() {
        lines.push(format!("- Selected paths: {}", ingested_paths.join(", ")));
    }
    if !source_pages_created.is_empty() {
        lines.push(format!(
            "- Source pages created: {}",
            source_pages_created.join(", ")
        ));
    }
    if !raw_files_copied.is_empty() {
        lines.push(format!(
            "- Raw files copied: {}",
            raw_files_copied.join(", ")
        ));
    }
    lines.push(String::new());

    let existing = read_if_exists(&log_path)?.unwrap_or_else(|| "# Log\n\n".to_string());
    fs::write(&log_path, format!("{}{}\n", existing, lines.join("\n")))
        .map_err(|err| format!("failed to write {}: {}", log_path.display(), err))
}

fn collect_files_recursively(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)
            .map_err(|err| format!("failed to read {}: {}", dir.display(), err))?
        {
            let entry =
                entry.map_err(|err| format!("failed to inspect {}: {}", dir.display(), err))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn collect_markdown_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    Ok(collect_files_recursively(root)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .collect())
}

fn read_if_exists(path: impl AsRef<Path>) -> Result<Option<String>, String> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|err| format!("failed to read {}: {}", path.display(), err))
}

fn summarize_text(value: &str, limit: usize) -> String {
    let compact = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join(" ");
    if compact.len() <= limit {
        compact
    } else {
        format!("{}...", &compact[..limit])
    }
}

fn slugify(value: &str) -> String {
    let lowered = value.to_ascii_lowercase();
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn unique_copy_target(dir: &Path, file_name: &str) -> PathBuf {
    let mut target = dir.join(file_name);
    if !target.exists() {
        return target;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    for index in 1..1000 {
        target = dir.join(format!("{}-{}{}", stem, index, ext));
        if !target.exists() {
            return target;
        }
    }
    target
}

fn extract_title(path: &Path, content: &str) -> String {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled")
                .to_string()
        })
}

fn normalize_title(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_local_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    for segment in content.match_indices("[[") {
        if let Some(end) = content[segment.0 + 2..].find("]]") {
            let raw = &content[segment.0 + 2..segment.0 + 2 + end];
            let target = raw.split('|').next().unwrap_or("").trim();
            if !target.is_empty() {
                let path = if target.ends_with(".md") {
                    target.to_string()
                } else {
                    format!("{}.md", target)
                };
                links.push(path.replace('\\', "/"));
            }
        }
    }
    links
}

fn extract_indexed_paths(index_content: &str) -> HashSet<String> {
    let mut paths = HashSet::new();
    for line in index_content.lines() {
        if let Some(start) = line.find('(') {
            if let Some(end) = line[start + 1..].find(')') {
                let target = line[start + 1..start + 1 + end].trim();
                if target.ends_with(".md") {
                    paths.insert(target.replace('\\', "/"));
                }
            }
        }
    }
    paths
}

fn make_finding(
    category: &str,
    severity: &str,
    confidence: &str,
    title: &str,
    detail: &str,
    relative_path: Option<String>,
    related_paths: Vec<String>,
) -> LocalLlmWikiLintFinding {
    LocalLlmWikiLintFinding {
        id: uuid::Uuid::new_v4().to_string(),
        category: category.to_string(),
        severity: severity.to_string(),
        confidence: confidence.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        relative_path,
        related_paths,
    }
}

#[cfg(test)]
mod tests {
    use super::build_lint_report;
    use std::fs;

    fn temp_workspace(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "deeting-llm-wiki-maintenance-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("wiki").join("analyses")).expect("create analyses");
        root
    }

    #[test]
    fn lint_report_detects_duplicate_titles_and_thin_analyses() {
        let root = temp_workspace("lint");
        fs::write(
            root.join("index.md"),
            "# Index\n- [Page A](wiki/page-a.md)\n",
        )
        .expect("write index");
        fs::write(
            root.join("wiki").join("page-a.md"),
            "# Topic\n\n[[wiki/page-b.md]]\n",
        )
        .expect("write page a");
        fs::write(root.join("wiki").join("page-b.md"), "# Topic\n\ncontent\n")
            .expect("write page b");
        fs::write(
            root.join("wiki").join("analyses").join("thin.md"),
            "# Thin\n\nshort\n",
        )
        .expect("write thin analysis");

        let report = build_lint_report(&root).expect("build lint report");

        assert!(report
            .findings
            .iter()
            .any(|item| item.category == "duplicate_title"));
        assert!(report
            .findings
            .iter()
            .any(|item| item.category == "low_value_analysis"));
    }
}
