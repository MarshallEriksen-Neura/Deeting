use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::config::{normalize_required_relative_path, normalize_vault_root};
use super::types::{
    ConfirmLocalLlmWikiAdoptionRequest, LocalLlmWikiAdoptionBucket, LocalLlmWikiAdoptionPreview,
    PreviewLocalLlmWikiAdoptionRequest,
};

const RAW_PREFIXES: &[&str] = &["raw/", "raw\\"];
const WIKI_PREFIXES: &[&str] = &["wiki/", "wiki\\"];
const MARKER_FILES: &[&str] = &[
    "readme-llm-wiki.md",
    "agents.md",
    "home.md",
    "index.md",
    "log.md",
];

pub(super) fn preview_adoption(
    payload: PreviewLocalLlmWikiAdoptionRequest,
) -> Result<LocalLlmWikiAdoptionPreview, String> {
    let vault_root = normalize_vault_root(&payload.vault_root)?;
    let folder_relative_path = normalize_required_relative_path(&payload.folder_relative_path)?;
    let target = vault_root.join(&folder_relative_path);
    if !target.exists() {
        return Err("adopted folder does not exist".to_string());
    }
    if !target.is_dir() {
        return Err("adopted target must be a directory".to_string());
    }

    let bucket_map = classify_folder(&target, &target)?;
    let bucketed_counts = bucket_map
        .into_iter()
        .map(|(kind, mut examples)| {
            examples.sort();
            let count = examples.len() as i64;
            examples.truncate(6);
            LocalLlmWikiAdoptionBucket {
                kind,
                count,
                examples,
            }
        })
        .collect::<Vec<_>>();

    let has_wiki_material = bucketed_counts.iter().any(|item| {
        matches!(
            item.kind.as_str(),
            "wiki_page" | "source_page" | "workspace_marker"
        ) && item.count > 0
    });

    Ok(LocalLlmWikiAdoptionPreview {
        target_relative_path: folder_relative_path.clone(),
        can_adopt: has_wiki_material,
        summary_message: if has_wiki_material {
            format!(
                "Previewed `{}` and found existing wiki-like material that can be adopted after confirmation.",
                folder_relative_path
            )
        } else {
            format!(
                "Previewed `{}` but did not find enough wiki-like structure to recommend adoption yet.",
                folder_relative_path
            )
        },
        bucketed_counts,
    })
}

pub(super) fn normalize_confirm_adoption_payload(
    payload: ConfirmLocalLlmWikiAdoptionRequest,
) -> Result<(PathBuf, String), String> {
    let vault_root = normalize_vault_root(&payload.vault_root)?;
    let folder_relative_path = normalize_required_relative_path(&payload.folder_relative_path)?;
    let target = vault_root.join(&folder_relative_path);
    if !target.exists() {
        return Err("adopted folder does not exist".to_string());
    }
    if !target.is_dir() {
        return Err("adopted target must be a directory".to_string());
    }
    Ok((vault_root, folder_relative_path))
}

fn classify_folder(root: &Path, current: &Path) -> Result<HashMap<String, Vec<String>>, String> {
    let mut buckets: HashMap<String, Vec<String>> = HashMap::new();
    let mut stack = vec![current.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|err| format!("failed to read {}: {}", dir.display(), err))?;
        for entry in entries {
            let entry =
                entry.map_err(|err| format!("failed to inspect {}: {}", dir.display(), err))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let kind = classify_file(relative.as_str(), file_name.as_str());
            buckets.entry(kind.to_string()).or_default().push(relative);
        }
    }

    Ok(buckets)
}

fn classify_file(relative_path: &str, file_name: &str) -> &'static str {
    let normalized = relative_path.to_ascii_lowercase();
    if MARKER_FILES.contains(&file_name) {
        return "workspace_marker";
    }
    if RAW_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        return "raw_source";
    }
    if WIKI_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        if normalized.contains("/sources/") {
            return "source_page";
        }
        return "wiki_page";
    }
    if normalized.ends_with(".md") {
        return "unmanaged_note";
    }
    "attachment"
}

#[cfg(test)]
mod tests {
    use super::preview_adoption;
    use super::PreviewLocalLlmWikiAdoptionRequest;
    use std::fs;

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "deeting-llm-wiki-adoption-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn preview_adoption_classifies_existing_material() {
        let root = temp_root("preview");
        let target = root.join("Research Wiki");
        fs::create_dir_all(target.join("wiki").join("sources")).expect("create wiki sources");
        fs::create_dir_all(target.join("raw").join("docs")).expect("create raw docs");
        fs::write(target.join("Home.md"), "# Home").expect("write home");
        fs::write(target.join("wiki").join("concepts.md"), "# Concept").expect("write concept");
        fs::write(
            target.join("wiki").join("sources").join("alpha.md"),
            "# Source",
        )
        .expect("write source");
        fs::write(target.join("raw").join("docs").join("alpha.pdf"), "pdf")
            .expect("write raw source");

        let preview = preview_adoption(PreviewLocalLlmWikiAdoptionRequest {
            vault_root: root.to_string_lossy().to_string(),
            folder_relative_path: "Research Wiki".to_string(),
        })
        .expect("preview adoption");

        assert!(preview.can_adopt);
        assert_eq!(preview.target_relative_path, "Research Wiki");
        assert!(preview
            .bucketed_counts
            .iter()
            .any(|bucket| bucket.kind == "workspace_marker"));
        assert!(preview
            .bucketed_counts
            .iter()
            .any(|bucket| bucket.kind == "wiki_page"));
    }
}
