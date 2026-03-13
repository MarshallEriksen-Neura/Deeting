use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::modules::mcp::risk::classify_scan_runtime_risk;
use crate::modules::mcp::store::LocalSkillInstallSnapshot;

use super::types::{ScanDocument, ScanFinding, ScanFindingAction, ScanRun, ScanSummary};

const MAX_SCAN_DEPTH: usize = 2;
const MAX_SCAN_FILES: usize = 12;
const MAX_TEXT_FILE_BYTES: u64 = 512 * 1024;
const MAX_HASH_FILE_BYTES: u64 = 1024 * 1024;
const EXCERPT_CHARS: usize = 220;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetIndexSnapshot {
    pub id: String,
    pub asset_type: String,
    pub source_type: String,
    pub pkg_name: Option<String>,
}

impl AssetIndexSnapshot {
    pub fn from_catalog_value(value: &Value) -> Option<Self> {
        let obj = value.as_object()?;
        Some(Self {
            id: obj.get("id")?.as_str()?.trim().to_string(),
            asset_type: obj
                .get("asset_type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string(),
            source_type: obj
                .get("source_type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string(),
            pkg_name: obj
                .get("pkg_name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        })
    }
}

#[derive(Debug, Default)]
struct BundleSnapshot {
    bundle_id: String,
    display_name: String,
    version: Option<String>,
    description: Option<String>,
    excerpt: Option<String>,
    doc_paths: Vec<String>,
    script_paths: Vec<String>,
    runtime_script_paths: Vec<String>,
    high_risk_script_paths: Vec<String>,
    file_count: usize,
    skill_doc_present: bool,
    manifest_present: bool,
    manifest_invalid: Option<String>,
    manifest_id: Option<String>,
    manifest_name: Option<String>,
    manifest_runtime: Option<String>,
    package_present: bool,
}

pub fn scan_directory(
    path: &Path,
    installs: &[LocalSkillInstallSnapshot],
    assets: &[AssetIndexSnapshot],
) -> Result<ScanRun, String> {
    ensure_directory(path)?;

    let started_at = now_rfc3339();
    let target_path = normalize_path(path);
    let mut documents = Vec::new();
    let mut findings = Vec::new();
    let mut matched_bundle_ids = HashSet::new();

    if looks_like_skill_bundle_dir(path)? {
        let (document, bundle_findings) = build_bundle_document(path, path, installs, assets)?;
        if let Some(bundle_id) = document.bundle_id.clone() {
            matched_bundle_ids.insert(bundle_id);
        }
        documents.push(document);
        findings.extend(bundle_findings);
    } else {
        let mut entries = std::fs::read_dir(path)
            .map_err(to_string)?
            .filter_map(|entry| entry.ok())
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let entry_path = entry.path();
            let name = entry.file_name();
            if is_hidden_name(&name) {
                continue;
            }
            if entry_path.is_dir() {
                if !looks_like_skill_bundle_dir(&entry_path)? {
                    continue;
                }
                let (document, bundle_findings) =
                    build_bundle_document(&entry_path, path, installs, assets)?;
                if let Some(bundle_id) = document.bundle_id.clone() {
                    matched_bundle_ids.insert(bundle_id);
                }
                documents.push(document);
                findings.extend(bundle_findings);
                continue;
            }
            if entry_path.is_file() {
                let document = build_file_document(&entry_path, path)?;
                findings.extend(build_file_findings(&entry_path, document.bundle_id.clone()));
                documents.push(document);
            }
        }
    }

    for install in installs {
        let install_path = PathBuf::from(&install.install_path);
        if !install_path.starts_with(path) || matched_bundle_ids.contains(&install.skill_id) {
            continue;
        }
        findings.push(orphan_install_finding(install, assets));
        if !has_skill_asset(&install.skill_id, assets) {
            findings.push(asset_missing_finding(
                &install.skill_id,
                &install.install_path,
                Some("install_snapshot".to_string()),
                "reindex_bundle",
            ));
        }
    }

    let summary = summarize(&documents, &findings);
    Ok(ScanRun {
        run_id: Uuid::new_v4().to_string(),
        trigger: "manual".to_string(),
        target_kind: "directory".to_string(),
        target_path,
        started_at,
        finished_at: now_rfc3339(),
        summary,
        documents,
        findings,
    })
}

pub fn scan_file(
    path: &Path,
    installs: &[LocalSkillInstallSnapshot],
    assets: &[AssetIndexSnapshot],
) -> Result<ScanRun, String> {
    if !path.exists() {
        return Err(format!("scan target does not exist: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("scan target is not a file: {}", path.display()));
    }

    let started_at = now_rfc3339();
    let document = build_file_document(path, path.parent().unwrap_or(Path::new("")))?;
    let mut findings = build_file_findings(path, document.bundle_id.clone());

    if let Some(parent) = path.parent() {
        if looks_like_skill_bundle_dir(parent).unwrap_or(false) {
            let snapshot = collect_bundle_snapshot(parent)?;
            if !has_skill_install(&snapshot.bundle_id, installs) {
                findings.push(install_missing_finding(
                    &snapshot.bundle_id,
                    normalize_path(path),
                    normalize_path(parent),
                ));
            }
            if !has_skill_asset(&snapshot.bundle_id, assets) {
                findings.push(asset_missing_finding(
                    &snapshot.bundle_id,
                    &normalize_path(path),
                    Some(normalize_path(parent)),
                    if has_skill_install(&snapshot.bundle_id, installs) {
                        "reindex_bundle"
                    } else {
                        "register_bundle"
                    },
                ));
            }
        }
    }

    let documents = vec![document];
    let summary = summarize(&documents, &findings);
    Ok(ScanRun {
        run_id: Uuid::new_v4().to_string(),
        trigger: "manual".to_string(),
        target_kind: "file".to_string(),
        target_path: normalize_path(path),
        started_at,
        finished_at: now_rfc3339(),
        summary,
        documents,
        findings,
    })
}

fn build_bundle_document(
    path: &Path,
    target_root: &Path,
    installs: &[LocalSkillInstallSnapshot],
    assets: &[AssetIndexSnapshot],
) -> Result<(ScanDocument, Vec<ScanFinding>), String> {
    let snapshot = collect_bundle_snapshot(path)?;
    let normalized_path = normalize_path(path);
    let install = installs
        .iter()
        .find(|install| install.skill_id == snapshot.bundle_id);
    let asset_present = has_skill_asset(&snapshot.bundle_id, assets);
    let mut findings = Vec::new();
    let mut status = "healthy".to_string();

    if let Some(error) = snapshot.manifest_invalid.as_ref() {
        status = "needs_review".to_string();
        findings.push(ScanFinding {
            id: Uuid::new_v4().to_string(),
            severity: "error".to_string(),
            code: "invalid_manifest".to_string(),
            message: format!(
                "Skill bundle {} contains an invalid deeting.json manifest",
                snapshot.bundle_id
            ),
            document_path: Some(normalized_path.clone()),
            bundle_id: Some(snapshot.bundle_id.clone()),
            metadata: Some(json!({ "error": error })),
            action: None,
        });
    }

    if install.is_none() {
        status = "needs_review".to_string();
        findings.push(install_missing_finding(
            &snapshot.bundle_id,
            normalized_path.clone(),
            normalized_path.clone(),
        ));
    }

    if !snapshot.skill_doc_present {
        status = "needs_review".to_string();
        findings.push(ScanFinding {
            id: Uuid::new_v4().to_string(),
            severity: "warn".to_string(),
            code: "skill_doc_missing".to_string(),
            message: format!(
                "Skill bundle {} is missing SKILL.md documentation",
                snapshot.bundle_id
            ),
            document_path: Some(normalized_path.clone()),
            bundle_id: Some(snapshot.bundle_id.clone()),
            metadata: Some(json!({ "expected_path": "SKILL.md" })),
            action: None,
        });
    }

    if snapshot.manifest_present && snapshot.manifest_invalid.is_none() {
        if snapshot.manifest_id.is_none() || snapshot.manifest_name.is_none() {
            status = "needs_review".to_string();
            findings.push(ScanFinding {
                id: Uuid::new_v4().to_string(),
                severity: "warn".to_string(),
                code: "manifest_identity_missing".to_string(),
                message: format!(
                    "Skill bundle {} is missing manifest identity fields (id/name)",
                    snapshot.bundle_id
                ),
                document_path: Some(normalized_path.clone()),
                bundle_id: Some(snapshot.bundle_id.clone()),
                metadata: Some(json!({
                    "manifest_id": snapshot.manifest_id.clone(),
                    "manifest_name": snapshot.manifest_name.clone(),
                })),
                action: None,
            });
        }

        if snapshot.manifest_runtime.is_none() {
            status = "needs_review".to_string();
            findings.push(ScanFinding {
                id: Uuid::new_v4().to_string(),
                severity: "warn".to_string(),
                code: "manifest_runtime_missing".to_string(),
                message: format!(
                    "Skill bundle {} is missing a runtime declaration in deeting.json",
                    snapshot.bundle_id
                ),
                document_path: Some(normalized_path.clone()),
                bundle_id: Some(snapshot.bundle_id.clone()),
                metadata: Some(json!({
                    "manifest_id": snapshot.manifest_id.clone(),
                    "manifest_name": snapshot.manifest_name.clone(),
                })),
                action: None,
            });
        }
    }

    if !asset_present {
        status = "needs_review".to_string();
        findings.push(asset_missing_finding(
            &snapshot.bundle_id,
            &normalized_path,
            Some(normalized_path.clone()),
            if install.is_some() {
                "reindex_bundle"
            } else {
                "register_bundle"
            },
        ));
    }

    if !snapshot.high_risk_script_paths.is_empty() {
        let risk = classify_scan_runtime_risk(Some("bash"), snapshot.high_risk_script_paths.first().map(|s| s.as_str()));
        status = "needs_review".to_string();
        findings.push(ScanFinding {
            id: Uuid::new_v4().to_string(),
            severity: "warn".to_string(),
            code: "high_risk_scripts_detected".to_string(),
            message: format!(
                "Skill bundle {} includes high-risk shell or system scripts that may require review",
                snapshot.bundle_id
            ),
            document_path: Some(normalized_path.clone()),
            bundle_id: Some(snapshot.bundle_id.clone()),
            metadata: Some(json!({
                "risk_level": risk.risk_level.to_lowercase(),
                "operation_class": risk.operation_class.as_str(),
                "target_class": risk.target_class.as_str(),
                "boundary_class": risk.boundary_class.as_str(),
                "script_paths": snapshot.high_risk_script_paths.clone(),
            })),
            action: None,
        });
    }

    if !snapshot.runtime_script_paths.is_empty() {
        let runtime_hint = snapshot.manifest_runtime.as_deref().or(Some("runtime"));
        let risk = classify_scan_runtime_risk(
            runtime_hint,
            snapshot.runtime_script_paths.first().map(|s| s.as_str()),
        );
        findings.push(ScanFinding {
            id: Uuid::new_v4().to_string(),
            severity: "info".to_string(),
            code: "runtime_scripts_detected".to_string(),
            message: format!(
                "Skill bundle {} includes runtime scripts (js/ts/py) that may execute code",
                snapshot.bundle_id
            ),
            document_path: Some(normalized_path.clone()),
            bundle_id: Some(snapshot.bundle_id.clone()),
            metadata: Some(json!({
                "risk_level": "runtime",
                "operation_class": risk.operation_class.as_str(),
                "target_class": risk.target_class.as_str(),
                "boundary_class": risk.boundary_class.as_str(),
                "script_paths": snapshot.runtime_script_paths.clone(),
            })),
            action: None,
        });
    }

    let metadata = json!({
        "doc_count": snapshot.doc_paths.len(),
        "file_count": snapshot.file_count,
        "version": snapshot.version.clone(),
        "description": snapshot.description.clone(),
        "skill_doc_present": snapshot.skill_doc_present,
        "manifest_present": snapshot.manifest_present,
        "manifest_id": snapshot.manifest_id.clone(),
        "manifest_name": snapshot.manifest_name.clone(),
        "manifest_runtime": snapshot.manifest_runtime.clone(),
        "script_count": snapshot.script_paths.len(),
        "runtime_script_count": snapshot.runtime_script_paths.len(),
        "high_risk_script_count": snapshot.high_risk_script_paths.len(),
        "risk_preview": scan_bundle_risk_preview(&snapshot),
        "package_present": snapshot.package_present,
        "install": install.map(|item| json!({
            "is_enabled": item.is_enabled,
            "installed_version": item.installed_version.clone(),
            "runtime": item.runtime.clone(),
            "install_path": item.install_path.clone(),
        })),
        "asset_index_present": asset_present,
    });

    Ok((
        ScanDocument {
            id: Uuid::new_v4().to_string(),
            path: normalized_path,
            relative_path: relative_path(path, target_root),
            document_kind: "skill_bundle".to_string(),
            display_name: snapshot.display_name,
            bundle_id: Some(snapshot.bundle_id),
            status,
            size_bytes: None,
            modified_at: directory_modified_at(path),
            sha256: None,
            excerpt: snapshot.excerpt,
            metadata: Some(metadata),
        },
        findings,
    ))
}

fn build_file_document(path: &Path, target_root: &Path) -> Result<ScanDocument, String> {
    let metadata = std::fs::metadata(path).map_err(to_string)?;
    let bundle_id = path.parent().and_then(|parent| {
        if looks_like_skill_bundle_dir(parent).unwrap_or(false) {
            collect_bundle_snapshot(parent)
                .ok()
                .map(|snapshot| snapshot.bundle_id)
        } else {
            None
        }
    });

    Ok(ScanDocument {
        id: Uuid::new_v4().to_string(),
        path: normalize_path(path),
        relative_path: relative_path(path, target_root),
        document_kind: detect_file_kind(path),
        display_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_string(),
        bundle_id,
        status: "healthy".to_string(),
        size_bytes: Some(metadata.len()),
        modified_at: metadata.modified().ok().and_then(system_time_to_rfc3339),
        sha256: sha256_for_file(path),
        excerpt: read_text_excerpt(path),
        metadata: None,
    })
}

fn build_file_findings(path: &Path, bundle_id: Option<String>) -> Vec<ScanFinding> {
    let mut findings = Vec::new();
    let normalized_path = normalize_path(path);

    if let Some(risk_level) = classify_script_risk_level(path) {
        let runtime_hint = path.extension().and_then(|ext| ext.to_str());
        let risk = classify_scan_runtime_risk(runtime_hint, Some(normalized_path.as_str()));
        findings.push(ScanFinding {
            id: Uuid::new_v4().to_string(),
            severity: if risk_level == "high" { "warn" } else { "info" }.to_string(),
            code: "script_file_detected".to_string(),
            message: format!("Script/executable file detected: {}", normalized_path),
            document_path: Some(normalized_path.clone()),
            bundle_id: bundle_id.clone(),
            metadata: Some(json!({
                "path": normalized_path,
                "risk_level": risk_level,
                "operation_class": risk.operation_class.as_str(),
                "target_class": risk.target_class.as_str(),
                "boundary_class": risk.boundary_class.as_str(),
            })),
            action: None,
        });
    }

    if path.file_name() == Some(OsStr::new("deeting.json")) {
        if let Err(error) = parse_deeting_manifest(path) {
            findings.push(ScanFinding {
                id: Uuid::new_v4().to_string(),
                severity: "error".to_string(),
                code: "invalid_manifest".to_string(),
                message: format!("Invalid deeting.json manifest: {}", error),
                document_path: Some(normalized_path),
                bundle_id,
                metadata: Some(json!({ "error": error })),
                action: None,
            });
        }
    }

    findings
}

fn collect_bundle_snapshot(path: &Path) -> Result<BundleSnapshot, String> {
    let mut snapshot = BundleSnapshot::default();
    let mut visited_files = 0usize;
    walk_bundle(path, path, 0, &mut snapshot, &mut visited_files)?;
    if snapshot.file_count == 0 {
        return Err(format!("empty bundle: {}", path.display()));
    }

    let fallback = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill");
    if snapshot.bundle_id.is_empty() {
        snapshot.bundle_id = normalize_bundle_id(fallback);
    }
    if snapshot.display_name.is_empty() {
        snapshot.display_name = slug_to_title(&snapshot.bundle_id);
    }
    if snapshot.description.is_none() {
        snapshot.description = snapshot.excerpt.clone();
    }

    Ok(snapshot)
}

fn walk_bundle(
    root: &Path,
    current: &Path,
    depth: usize,
    snapshot: &mut BundleSnapshot,
    visited_files: &mut usize,
) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH || *visited_files >= MAX_SCAN_FILES {
        return Ok(());
    }

    let mut entries = std::fs::read_dir(current)
        .map_err(to_string)?
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        if *visited_files >= MAX_SCAN_FILES {
            break;
        }
        let path = entry.path();
        if is_hidden_name(&entry.file_name()) {
            continue;
        }
        if path.is_dir() {
            walk_bundle(root, &path, depth + 1, snapshot, visited_files)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }

        *visited_files += 1;
        snapshot.file_count += 1;
        let relative = relative_path(&path, root).unwrap_or_else(|| normalize_path(&path));

        if path.file_name() == Some(OsStr::new("SKILL.md")) {
            snapshot.skill_doc_present = true;
        }

        if path.file_name() == Some(OsStr::new("deeting.json")) {
            snapshot.manifest_present = true;
            match parse_deeting_manifest(&path) {
                Ok(value) => apply_json_metadata(snapshot, &value),
                Err(error) => snapshot.manifest_invalid = Some(error),
            }
        }
        if path.file_name() == Some(OsStr::new("package.json")) {
            snapshot.package_present = true;
            if let Some(value) = read_json_file(&path) {
                apply_json_metadata(snapshot, &value);
            }
        }
        if is_probably_text_document(&path) {
            snapshot.doc_paths.push(relative.clone());
            if snapshot.excerpt.is_none() {
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                if let Some(frontmatter) = parse_frontmatter(&text) {
                    apply_json_metadata(snapshot, &frontmatter);
                }
                snapshot.excerpt = first_non_empty_line(&trim_excerpt(&text, EXCERPT_CHARS));
            }
        }
        if let Some(risk_level) = classify_script_risk_level(&path) {
            snapshot.script_paths.push(relative);
            if risk_level == "high" {
                snapshot
                    .high_risk_script_paths
                    .push(relative_path(&path, root).unwrap_or_else(|| normalize_path(&path)));
            } else {
                snapshot
                    .runtime_script_paths
                    .push(relative_path(&path, root).unwrap_or_else(|| normalize_path(&path)));
            }
        }
    }

    Ok(())
}

fn looks_like_skill_bundle_dir(path: &Path) -> Result<bool, String> {
    if !path.exists() || !path.is_dir() {
        return Ok(false);
    }
    match collect_bundle_snapshot(path) {
        Ok(snapshot) => Ok(snapshot.manifest_present
            || snapshot.package_present
            || !snapshot.doc_paths.is_empty()
            || !snapshot.script_paths.is_empty()),
        Err(_) => Ok(false),
    }
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("scan target does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!(
            "scan target is not a directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn summarize(documents: &[ScanDocument], findings: &[ScanFinding]) -> ScanSummary {
    ScanSummary {
        document_count: documents.len(),
        finding_count: findings.len(),
        warning_count: findings
            .iter()
            .filter(|item| item.severity == "warn")
            .count(),
        error_count: findings
            .iter()
            .filter(|item| item.severity == "error")
            .count(),
        skill_bundle_count: documents
            .iter()
            .filter(|item| item.document_kind == "skill_bundle")
            .count(),
        index_missing_count: findings
            .iter()
            .filter(|item| item.code == "asset_index_missing")
            .count(),
        install_missing_count: findings
            .iter()
            .filter(|item| {
                item.code == "install_record_missing" || item.code == "installed_path_missing"
            })
            .count(),
        security_warning_count: findings
            .iter()
            .filter(|item| {
                matches!(
                    item.code.as_str(),
                    "invalid_manifest"
                        | "skill_doc_missing"
                        | "manifest_identity_missing"
                        | "manifest_runtime_missing"
                        | "high_risk_scripts_detected"
                        | "runtime_scripts_detected"
                        | "script_file_detected"
                )
            })
            .count(),
        high_risk_script_count: findings
            .iter()
            .filter(|item| {
                item.code == "high_risk_scripts_detected"
                    || (item.code == "script_file_detected"
                        && finding_metadata_equals(item, "risk_level", "high"))
            })
            .count(),
        missing_skill_doc_count: findings
            .iter()
            .filter(|item| item.code == "skill_doc_missing")
            .count(),
    }
}

fn scan_bundle_risk_preview(snapshot: &BundleSnapshot) -> Value {
    let risk = if !snapshot.high_risk_script_paths.is_empty() {
        classify_scan_runtime_risk(
            Some("bash"),
            snapshot.high_risk_script_paths.first().map(|s| s.as_str()),
        )
    } else if !snapshot.runtime_script_paths.is_empty() {
        classify_scan_runtime_risk(
            snapshot.manifest_runtime.as_deref(),
            snapshot.runtime_script_paths.first().map(|s| s.as_str()),
        )
    } else {
        classify_scan_runtime_risk(snapshot.manifest_runtime.as_deref(), None)
    };

    json!({
        "risk_level": risk.risk_level.to_lowercase(),
        "operation_class": risk.operation_class.as_str(),
        "target_class": risk.target_class.as_str(),
        "boundary_class": risk.boundary_class.as_str(),
        "reasons": risk.reasons,
    })
}

fn orphan_install_finding(
    install: &LocalSkillInstallSnapshot,
    assets: &[AssetIndexSnapshot],
) -> ScanFinding {
    let install_exists = PathBuf::from(&install.install_path).exists();
    ScanFinding {
        id: Uuid::new_v4().to_string(),
        severity: if install_exists { "warn" } else { "error" }.to_string(),
        code: if install_exists {
            "installed_bundle_unrecognized"
        } else {
            "installed_path_missing"
        }
        .to_string(),
        message: if install_exists {
            format!(
                "Installed skill {} exists on disk but was not recognized as a valid bundle",
                install.skill_id
            )
        } else {
            format!(
                "Installed skill {} points to a missing path: {}",
                install.skill_id, install.install_path
            )
        },
        document_path: Some(install.install_path.clone()),
        bundle_id: Some(install.skill_id.clone()),
        metadata: Some(json!({
            "is_enabled": install.is_enabled,
            "installed_version": install.installed_version.clone(),
            "runtime": install.runtime.clone(),
            "asset_index_present": has_skill_asset(&install.skill_id, assets),
        })),
        action: (!install_exists).then(|| ScanFindingAction {
            kind: "cleanup_missing_install".to_string(),
            bundle_id: Some(install.skill_id.clone()),
            path: Some(install.install_path.clone()),
            destructive: true,
        }),
    }
}

fn install_missing_finding(
    skill_id: &str,
    document_path: String,
    bundle_path: String,
) -> ScanFinding {
    let metadata_bundle_path = bundle_path.clone();
    ScanFinding {
        id: Uuid::new_v4().to_string(),
        severity: "warn".to_string(),
        code: "install_record_missing".to_string(),
        message: format!(
            "Skill bundle {} exists on disk but has no install record",
            skill_id
        ),
        document_path: Some(document_path),
        bundle_id: Some(skill_id.to_string()),
        metadata: Some(json!({ "bundle_path": metadata_bundle_path })),
        action: Some(ScanFindingAction {
            kind: "register_bundle".to_string(),
            bundle_id: Some(skill_id.to_string()),
            path: Some(bundle_path),
            destructive: false,
        }),
    }
}

fn asset_missing_finding(
    skill_id: &str,
    document_path: &str,
    source: Option<String>,
    action_kind: &str,
) -> ScanFinding {
    let metadata_source = source.clone();
    ScanFinding {
        id: Uuid::new_v4().to_string(),
        severity: "warn".to_string(),
        code: "asset_index_missing".to_string(),
        message: format!("Skill bundle {} has no local asset index", skill_id),
        document_path: Some(document_path.to_string()),
        bundle_id: Some(skill_id.to_string()),
        metadata: Some(json!({ "source": metadata_source })),
        action: Some(ScanFindingAction {
            kind: action_kind.to_string(),
            bundle_id: Some(skill_id.to_string()),
            path: source,
            destructive: false,
        }),
    }
}

fn has_skill_install(skill_id: &str, installs: &[LocalSkillInstallSnapshot]) -> bool {
    installs.iter().any(|install| install.skill_id == skill_id)
}

fn has_skill_asset(skill_id: &str, assets: &[AssetIndexSnapshot]) -> bool {
    assets.iter().any(|asset| {
        asset.asset_type == "skill"
            && (asset.id == skill_id || asset.pkg_name.as_deref() == Some(skill_id))
    })
}

fn apply_json_metadata(snapshot: &mut BundleSnapshot, value: &Value) {
    if snapshot.manifest_id.is_none() {
        snapshot.manifest_id = select_json_string(value, &["id", "name"]);
    }
    if snapshot.manifest_name.is_none() {
        snapshot.manifest_name =
            select_json_string(value, &["display_name", "displayName", "title", "name"]);
    }
    if snapshot.manifest_runtime.is_none() {
        snapshot.manifest_runtime = select_json_string(value, &["runtime"])
            .or_else(|| select_json_string_array(value, &["runtime", "runtimes"]));
    }
    if snapshot.bundle_id.is_empty() {
        if let Some(id) = select_json_string(value, &["id", "name"]) {
            snapshot.bundle_id = normalize_bundle_id(&id);
        }
    }
    if snapshot.display_name.is_empty() {
        if let Some(name) =
            select_json_string(value, &["display_name", "displayName", "title", "name"])
        {
            snapshot.display_name = name;
        }
    }
    if snapshot.version.is_none() {
        snapshot.version = select_json_string(value, &["version"]);
    }
    if snapshot.description.is_none() {
        snapshot.description = select_json_string(value, &["description", "summary"]);
    }
}

fn select_json_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
    })
}

fn select_json_string_array(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_array)
            .and_then(|items| {
                let values = items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToString::to_string)
                    .collect::<Vec<_>>();
                if values.is_empty() {
                    None
                } else {
                    Some(values.join(","))
                }
            })
    })
}

fn read_json_file(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

fn parse_deeting_manifest(path: &Path) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path).map_err(to_string)?;
    serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())
}

fn parse_frontmatter(content: &str) -> Option<Value> {
    let stripped = content.strip_prefix("---\n")?;
    let end = stripped.find("\n---\n")?;
    let raw = &stripped[..end];
    serde_yaml::from_str::<serde_yaml::Value>(raw)
        .ok()
        .and_then(|value| serde_json::to_value(value).ok())
}

fn detect_file_kind(path: &Path) -> String {
    if path.file_name() == Some(OsStr::new("deeting.json")) {
        "manifest".to_string()
    } else if is_script_path(path) {
        "script".to_string()
    } else if is_probably_text_document(path) {
        "document".to_string()
    } else {
        "file".to_string()
    }
}

fn is_hidden_name(name: &OsStr) -> bool {
    name.to_str()
        .map(|item| item.starts_with('.'))
        .unwrap_or(false)
}

fn is_probably_text_document(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
        Some(ext)
            if matches!(ext.as_str(), "md" | "mdx" | "txt" | "rst" | "adoc" | "prompt" | "yaml" | "yml" | "json" | "toml")
    )
}

fn is_script_path(path: &Path) -> bool {
    classify_script_risk_level(path).is_some()
}

fn classify_script_risk_level(path: &Path) -> Option<&'static str> {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "sh" | "bash" | "zsh" | "ps1" | "bat" | "cmd")
    )
    .then_some("high")
    .or_else(|| {
        matches!(
            path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
            Some(ext) if matches!(ext.as_str(), "py" | "js" | "ts")
        )
        .then_some("runtime")
    })
}

fn finding_metadata_equals(finding: &ScanFinding, key: &str, expected: &str) -> bool {
    finding
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        == Some(expected)
}

fn trim_excerpt(content: &str, max_chars: usize) -> String {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(max_chars)
        .collect::<String>()
}

fn first_non_empty_line(content: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn read_text_excerpt(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    first_non_empty_line(&trim_excerpt(&raw, EXCERPT_CHARS))
}

fn sha256_for_file(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_HASH_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Some(format!("{:x}", hasher.finalize()))
}

fn normalize_bundle_id(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn slug_to_title(raw: &str) -> String {
    raw.replace(['/', '-', '_', '.'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn relative_path(path: &Path, root: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn directory_modified_at(path: &Path) -> Option<String> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .and_then(system_time_to_rfc3339)
}

fn system_time_to_rfc3339(value: SystemTime) -> Option<String> {
    let date_time = OffsetDateTime::from(value);
    date_time.format(&Rfc3339).ok()
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| String::new())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deeting-scan-{}-{}", name, Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn scan_directory_flags_missing_install_and_index() {
        let root = temp_dir("missing-install");
        let skill_dir = root.join("alpha-skill");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(skill_dir.join("SKILL.md"), "# Alpha Skill\n\nSearch docs")
            .expect("write doc");

        let run = scan_directory(&root, &[], &[]).expect("scan directory");
        assert_eq!(run.summary.skill_bundle_count, 1);
        assert!(run.findings.iter().any(|finding| {
            finding.code == "install_record_missing"
                && finding.action.as_ref().map(|action| action.kind.as_str())
                    == Some("register_bundle")
        }));
        assert!(run.findings.iter().any(|finding| {
            finding.code == "asset_index_missing"
                && finding.action.as_ref().map(|action| action.kind.as_str())
                    == Some("register_bundle")
        }));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn scan_directory_flags_orphaned_install_path() {
        let root = temp_dir("orphan-install");
        let installs = vec![LocalSkillInstallSnapshot {
            skill_id: "ghost-skill".to_string(),
            installed_version: Some("0.1.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: root.join("ghost-skill").to_string_lossy().to_string(),
        }];

        let run = scan_directory(&root, &installs, &[]).expect("scan directory");
        assert!(run.findings.iter().any(|finding| {
            finding.code == "installed_path_missing"
                && finding.action.as_ref().map(|action| action.kind.as_str())
                    == Some("cleanup_missing_install")
        }));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn scan_file_detects_script_file() {
        let root = temp_dir("file-scan");
        let script = root.join("review.sh");
        std::fs::write(&script, "#!/usr/bin/env bash\necho hi\n").expect("write script");

        let run = scan_file(&script, &[], &[]).expect("scan file");
        assert_eq!(run.summary.document_count, 1);
        assert!(run.findings.iter().any(|finding| {
            finding.code == "script_file_detected"
                && finding_metadata_equals(finding, "risk_level", "high")
        }));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn scan_directory_flags_missing_skill_doc_manifest_fields_and_script_risks() {
        let root = temp_dir("skill-review");
        let skill_dir = root.join("beta-skill");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(skill_dir.join("deeting.json"), r#"{"id":"beta-skill"}"#)
            .expect("write manifest");
        std::fs::write(skill_dir.join("run.sh"), "#!/usr/bin/env bash\necho hi\n")
            .expect("write shell script");
        std::fs::write(skill_dir.join("worker.ts"), "export const run = true\n")
            .expect("write runtime script");

        let run = scan_directory(&root, &[], &[]).expect("scan directory");

        assert!(run
            .findings
            .iter()
            .any(|finding| finding.code == "skill_doc_missing"));
        assert!(run
            .findings
            .iter()
            .any(|finding| finding.code == "manifest_identity_missing"));
        assert!(run
            .findings
            .iter()
            .any(|finding| finding.code == "manifest_runtime_missing"));
        assert!(run
            .findings
            .iter()
            .any(|finding| finding.code == "high_risk_scripts_detected"));
        assert!(run
            .findings
            .iter()
            .any(|finding| finding.code == "runtime_scripts_detected"));
        assert_eq!(run.summary.missing_skill_doc_count, 1);
        assert_eq!(run.summary.high_risk_script_count, 1);
        assert!(run.summary.security_warning_count >= 4);

        let _ = std::fs::remove_dir_all(root);
    }
}
