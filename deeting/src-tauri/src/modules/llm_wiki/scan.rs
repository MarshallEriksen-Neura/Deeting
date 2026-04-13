use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::types::{
    LocalLlmWikiCandidateFolder, LocalLlmWikiVaultScanSummary, LocalLlmWikiWorkspaceStatus,
};

const MARKER_FILES: &[&str] = &[
    "readme-llm-wiki.md",
    "agents.md",
    "home.md",
    "index.md",
    "log.md",
];

const ATTACHMENT_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "docx", "xlsx", "pptx", "csv", "mp3", "wav",
    "m4a", "mp4", "mov",
];

#[derive(Debug, Clone)]
struct CandidateFolder {
    relative_path: String,
    reason: String,
    score: i64,
}

#[derive(Debug, Default)]
struct ScanAccumulator {
    total_markdown_files: i64,
    total_attachment_files: i64,
    total_directories: i64,
    candidate_folders: Vec<CandidateFolder>,
}

pub(super) fn scan_vault(root: &Path) -> Result<LocalLlmWikiVaultScanSummary, String> {
    let mut accumulator = ScanAccumulator::default();
    let mut stack = vec![root.to_path_buf()];
    let has_obsidian_config = root.join(".obsidian").is_dir();

    while let Some(current_dir) = stack.pop() {
        accumulator.total_directories += 1;
        let entries = fs::read_dir(&current_dir)
            .map_err(|err| format!("failed to read {}: {}", current_dir.display(), err))?;

        let mut immediate_files = HashSet::new();
        let mut child_dirs = Vec::new();

        for entry in entries {
            let entry = entry
                .map_err(|err| format!("failed to inspect {}: {}", current_dir.display(), err))?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let lower_name = file_name.to_ascii_lowercase();
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;

            if file_type.is_dir() {
                if should_skip_dir(&lower_name) {
                    continue;
                }
                child_dirs.push(path);
            } else if file_type.is_file() {
                immediate_files.insert(lower_name.clone());
                match path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_ascii_lowercase())
                {
                    Some(ext) if ext == "md" => accumulator.total_markdown_files += 1,
                    Some(ext) if ATTACHMENT_EXTENSIONS.contains(&ext.as_str()) => {
                        accumulator.total_attachment_files += 1
                    }
                    _ => {}
                }
            }
        }

        maybe_record_candidate(root, &current_dir, &immediate_files, &mut accumulator);
        stack.extend(child_dirs);
    }

    accumulator.candidate_folders.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    accumulator.candidate_folders.truncate(6);

    Ok(LocalLlmWikiVaultScanSummary {
        detected_obsidian_config: has_obsidian_config,
        total_markdown_files: accumulator.total_markdown_files,
        total_attachment_files: accumulator.total_attachment_files,
        total_directories: accumulator.total_directories,
        candidate_folders: accumulator
            .candidate_folders
            .into_iter()
            .map(|candidate| LocalLlmWikiCandidateFolder {
                relative_path: candidate.relative_path,
                reason: candidate.reason,
                score: candidate.score,
            })
            .collect(),
    })
}

pub(super) fn inspect_workspace(
    workspace_path: &Path,
    last_bootstrapped_at: Option<String>,
) -> LocalLlmWikiWorkspaceStatus {
    let workspace_exists = workspace_path.is_dir();
    let has_readme = workspace_path.join("README-LLM-Wiki.md").is_file();
    let has_agents = workspace_path.join("AGENTS.md").is_file();
    let has_home = workspace_path.join("Home.md").is_file();
    let has_index = workspace_path.join("index.md").is_file();
    let has_log = workspace_path.join("log.md").is_file();
    let has_raw = workspace_path.join("raw").is_dir();
    let has_wiki = workspace_path.join("wiki").is_dir();
    let ready_file_count = [
        has_readme, has_agents, has_home, has_index, has_log, has_raw, has_wiki,
    ]
    .into_iter()
    .filter(|value| *value)
    .count() as i64;

    LocalLlmWikiWorkspaceStatus {
        resolved_workspace_path: workspace_path.to_string_lossy().to_string(),
        workspace_exists,
        has_readme,
        has_agents,
        has_home,
        has_index,
        has_log,
        has_raw,
        has_wiki,
        ready_file_count,
        last_bootstrapped_at,
    }
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".trash" | "node_modules" | ".next" | ".obsidian" | ".deeting"
    )
}

fn maybe_record_candidate(
    root: &Path,
    current_dir: &Path,
    immediate_files: &HashSet<String>,
    accumulator: &mut ScanAccumulator,
) {
    if current_dir == root {
        return;
    }

    let relative_path = current_dir
        .strip_prefix(root)
        .unwrap_or(current_dir)
        .to_string_lossy()
        .replace('\\', "/");
    if relative_path.trim().is_empty() {
        return;
    }

    let folder_name = current_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mut score = 0_i64;
    let mut reasons = Vec::new();

    if folder_name.contains("wiki") {
        score += 12;
        reasons.push("folder name mentions wiki");
    }
    if folder_name.contains("knowledge") {
        score += 10;
        reasons.push("folder name mentions knowledge");
    }
    if immediate_files.contains("home.md") {
        score += 8;
        reasons.push("contains Home.md");
    }
    if immediate_files.contains("index.md") {
        score += 8;
        reasons.push("contains index.md");
    }
    if immediate_files.contains("log.md") {
        score += 6;
        reasons.push("contains log.md");
    }
    if immediate_files.contains("agents.md") {
        score += 10;
        reasons.push("contains AGENTS.md");
    }
    if immediate_files.contains("readme-llm-wiki.md") {
        score += 14;
        reasons.push("contains README-LLM-Wiki.md");
    }

    let marker_hits = MARKER_FILES
        .iter()
        .filter(|marker| immediate_files.contains(**marker))
        .count() as i64;
    score += marker_hits * 2;

    if score <= 0 {
        return;
    }

    accumulator.candidate_folders.push(CandidateFolder {
        relative_path,
        reason: reasons.join(", "),
        score,
    });
}

#[cfg(test)]
mod tests {
    use super::{inspect_workspace, scan_vault};
    use std::fs;

    fn temp_path(label: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "deeting-llm-wiki-scan-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).expect("create temp root");
        base
    }

    #[test]
    fn scan_vault_detects_markdown_and_candidate_folders() {
        let root = temp_path("candidate");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian dir");
        fs::create_dir_all(root.join("Research Wiki")).expect("create wiki dir");
        fs::write(root.join("Research Wiki").join("Home.md"), "# Home").expect("write home");
        fs::write(root.join("Research Wiki").join("index.md"), "# Index").expect("write index");
        fs::write(root.join("note.md"), "# Note").expect("write note");
        fs::write(root.join("chart.png"), "png").expect("write attachment");

        let summary = scan_vault(&root).expect("scan vault");

        assert!(summary.detected_obsidian_config);
        assert_eq!(summary.total_markdown_files, 3);
        assert_eq!(summary.total_attachment_files, 1);
        assert!(summary
            .candidate_folders
            .iter()
            .any(|folder| folder.relative_path == "Research Wiki"));
    }

    #[test]
    fn inspect_workspace_counts_core_files() {
        let root = temp_path("workspace");
        fs::create_dir_all(root.join("raw")).expect("create raw");
        fs::create_dir_all(root.join("wiki")).expect("create wiki");
        fs::write(root.join("README-LLM-Wiki.md"), "readme").expect("write readme");
        fs::write(root.join("AGENTS.md"), "agents").expect("write agents");

        let status = inspect_workspace(&root, Some("2026-04-13T00:00:00Z".to_string()));

        assert!(status.workspace_exists);
        assert_eq!(status.ready_file_count, 4);
        assert_eq!(
            status.last_bootstrapped_at.as_deref(),
            Some("2026-04-13T00:00:00Z")
        );
    }
}
