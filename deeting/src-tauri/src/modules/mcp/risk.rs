use std::net::IpAddr;
use std::str::FromStr;

use mcp_core::types::{McpSourceType, McpTool};
use mcp_storage::types::LocalSkillToolBindingSnapshot;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskOperationClass {
    Unknown,
    NetworkRead,
    FilesystemRead,
    FilesystemWrite,
    ProcessExec,
}

impl RiskOperationClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::NetworkRead => "network_read",
            Self::FilesystemRead => "filesystem_read",
            Self::FilesystemWrite => "filesystem_write",
            Self::ProcessExec => "process_exec",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskTargetClass {
    Unknown,
    Host,
    PublicInternet,
    PrivateNetwork,
    Localhost,
    SensitivePath,
}

impl RiskTargetClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Host => "host",
            Self::PublicInternet => "public_internet",
            Self::PrivateNetwork => "private_network",
            Self::Localhost => "localhost",
            Self::SensitivePath => "sensitive_path",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalBoundaryClass {
    None,
    SoftBoundary,
    HardBoundary,
}

impl ApprovalBoundaryClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::SoftBoundary => "soft_boundary",
            Self::HardBoundary => "hard_boundary",
        }
    }
}

fn normalized_approval_key_tail_segment<'a>(
    parts: &'a [&'a str],
    offset_from_end: usize,
) -> &'a str {
    parts
        .len()
        .checked_sub(offset_from_end)
        .and_then(|index| parts.get(index))
        .copied()
        .filter(|segment| !segment.is_empty())
        .unwrap_or("unknown")
}

pub fn approval_classes_from_key(value: &str) -> (String, String, String) {
    // Older approval rows could prepend human-readable segments before the
    // canonical class tuple. The stable contract is that the final three
    // segments are operation, target, and boundary.
    let parts: Vec<_> = value.split('|').map(str::trim).collect();
    (
        normalized_approval_key_tail_segment(&parts, 3).to_string(),
        normalized_approval_key_tail_segment(&parts, 2).to_string(),
        normalized_approval_key_tail_segment(&parts, 1).to_string(),
    )
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolRiskAssessment {
    pub requires_approval: bool,
    pub risk_level: &'static str,
    pub reasons: Vec<String>,
    pub operation_class: RiskOperationClass,
    pub target_class: RiskTargetClass,
    pub boundary_class: ApprovalBoundaryClass,
}

impl ToolRiskAssessment {
    pub fn grant_eligible(&self) -> bool {
        self.boundary_class == ApprovalBoundaryClass::SoftBoundary
            && !matches!(self.operation_class, RiskOperationClass::ProcessExec)
            && matches!(
                self.target_class,
                RiskTargetClass::PublicInternet | RiskTargetClass::Unknown
            )
    }

    pub fn session_grant_key(&self, tool_fingerprint: &str) -> Option<String> {
        if !self.grant_eligible() {
            return None;
        }
        self.policy_rule_key(tool_fingerprint)
    }

    pub fn policy_rule_key(&self, tool_fingerprint: &str) -> Option<String> {
        let normalized_fingerprint = tool_fingerprint.trim();
        if normalized_fingerprint.is_empty() {
            return None;
        }
        Some(format!(
            "{}|{}|{}|{}",
            normalized_fingerprint,
            self.operation_class.as_str(),
            self.target_class.as_str(),
            self.boundary_class.as_str(),
        ))
    }

    pub fn metadata_json(&self) -> Value {
        json!({
            "risk_level": self.risk_level,
            "requires_approval": self.requires_approval,
            "risk_reasons": self.reasons,
            "operation_class": self.operation_class.as_str(),
            "target_class": self.target_class.as_str(),
            "boundary_class": self.boundary_class.as_str(),
            "grant_eligible": self.grant_eligible(),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionApprovalGrant {
    pub key: String,
    pub tool_fingerprint: String,
    pub operation_class: RiskOperationClass,
    pub target_class: RiskTargetClass,
    pub boundary_class: ApprovalBoundaryClass,
    pub created_at_unix_ms: i128,
}

impl SessionApprovalGrant {
    pub fn from_assessment(
        tool_fingerprint: &str,
        assessment: &ToolRiskAssessment,
        created_at_unix_ms: i128,
    ) -> Option<Self> {
        let key = assessment.session_grant_key(tool_fingerprint)?;
        Some(Self {
            key,
            tool_fingerprint: tool_fingerprint.trim().to_string(),
            operation_class: assessment.operation_class.clone(),
            target_class: assessment.target_class.clone(),
            boundary_class: assessment.boundary_class.clone(),
            created_at_unix_ms,
        })
    }

    pub fn from_key(key: &str, created_at_unix_ms: i128) -> Option<Self> {
        let mut parts = key.split('|');
        let tool_fingerprint = parts.next()?.trim().to_string();
        let operation_class = parse_operation_class(parts.next()?);
        let target_class = parse_target_class(parts.next()?);
        let boundary_class = parse_boundary_class(parts.next()?);
        if parts.next().is_some() || tool_fingerprint.is_empty() {
            return None;
        }
        Some(Self {
            key: key.trim().to_string(),
            tool_fingerprint,
            operation_class,
            target_class,
            boundary_class,
            created_at_unix_ms,
        })
    }
}

pub fn is_high_risk_tool_name(tool_name: &str) -> bool {
    let name = tool_name.to_lowercase();
    name.contains("delete")
        || name.contains("remove")
        || name.contains("write")
        || name.contains("shell")
        || name.contains("execute")
        || name.contains("update")
        || name.contains("terminal")
}

pub fn assess_core_tool_risk(tool_name: &str, arguments: &Value) -> ToolRiskAssessment {
    match tool_name.trim() {
        "browser_agent_status" => ToolRiskAssessment {
            requires_approval: false,
            risk_level: "LOW",
            reasons: vec!["status probe has no side effects".to_string()],
            operation_class: RiskOperationClass::Unknown,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::None,
        },
        "browser_open_tab" => {
            let url = arguments
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            match classify_url_target(url) {
                Some(RiskTargetClass::Localhost) => ToolRiskAssessment {
                    requires_approval: true,
                    risk_level: "HIGH",
                    reasons: vec![
                        "browser navigation targets localhost endpoint".to_string(),
                        "browser automation can trigger host-side effects".to_string(),
                    ],
                    operation_class: RiskOperationClass::NetworkRead,
                    target_class: RiskTargetClass::Localhost,
                    boundary_class: ApprovalBoundaryClass::HardBoundary,
                },
                Some(RiskTargetClass::PrivateNetwork) => ToolRiskAssessment {
                    requires_approval: true,
                    risk_level: "HIGH",
                    reasons: vec![
                        "browser navigation targets private network".to_string(),
                        "browser automation can trigger host-side effects".to_string(),
                    ],
                    operation_class: RiskOperationClass::NetworkRead,
                    target_class: RiskTargetClass::PrivateNetwork,
                    boundary_class: ApprovalBoundaryClass::HardBoundary,
                },
                Some(RiskTargetClass::PublicInternet) => ToolRiskAssessment {
                    requires_approval: true,
                    risk_level: "MEDIUM",
                    reasons: vec!["browser automation navigates public internet".to_string()],
                    operation_class: RiskOperationClass::NetworkRead,
                    target_class: RiskTargetClass::PublicInternet,
                    boundary_class: ApprovalBoundaryClass::SoftBoundary,
                },
                _ => ToolRiskAssessment {
                    requires_approval: true,
                    risk_level: "MEDIUM",
                    reasons: vec!["browser navigation target is unknown".to_string()],
                    operation_class: RiskOperationClass::NetworkRead,
                    target_class: RiskTargetClass::Unknown,
                    boundary_class: ApprovalBoundaryClass::SoftBoundary,
                },
            }
        }
        "browser_get_active_page" => ToolRiskAssessment {
            requires_approval: false,
            risk_level: "LOW",
            reasons: vec!["active browser page metadata has no side effects".to_string()],
            operation_class: RiskOperationClass::NetworkRead,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::None,
        },
        "browser_get_page_snapshot"
        | "browser_find_element"
        | "browser_extract"
        | "browser_region_screenshot"
        | "browser_full_page_screenshot"
        | "browser_wait"
        | "browser_downloads"
        | "browser_console_log"
        | "browser_network_log"
        | "browser_storage_read"
        | "browser_accessibility_audit" => ToolRiskAssessment {
            requires_approval: true,
            risk_level: "MEDIUM",
            reasons: vec![
                "browser inspection can expose page content or browsing context".to_string(),
            ],
            operation_class: RiskOperationClass::NetworkRead,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::SoftBoundary,
        },
        "browser_scroll" | "browser_scroll_into_view" | "browser_highlight" => ToolRiskAssessment {
            requires_approval: false,
            risk_level: "LOW",
            reasons: vec!["browser viewport targeting changes only local visual state".to_string()],
            operation_class: RiskOperationClass::Unknown,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::None,
        },
        "browser_click"
        | "browser_type"
        | "browser_navigate_tab"
        | "browser_tabs"
        | "browser_fill"
        | "browser_key"
        | "browser_select"
        | "browser_upload_file"
        | "browser_dialog"
        | "browser_storage_write"
        | "browser_eval" => ToolRiskAssessment {
            requires_approval: true,
            risk_level: "HIGH",
            reasons: vec![
                "browser automation can trigger page, network, or host-side mutations".to_string(),
            ],
            operation_class: RiskOperationClass::ProcessExec,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        },
        "shell_execute" => ToolRiskAssessment {
            requires_approval: true,
            risk_level: "HIGH",
            reasons: vec!["shell execution can mutate host state".to_string()],
            operation_class: RiskOperationClass::ProcessExec,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        },
        "save_asset" => ToolRiskAssessment {
            requires_approval: true,
            risk_level: "HIGH",
            reasons: vec![
                "saving a local asset writes executable HTML or JS to host storage".to_string(),
            ],
            operation_class: RiskOperationClass::FilesystemWrite,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        },
        _ => ToolRiskAssessment {
            requires_approval: false,
            risk_level: "LOW",
            reasons: vec!["core tool not classified as risky".to_string()],
            operation_class: RiskOperationClass::Unknown,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::None,
        },
    }
}

pub fn assess_mcp_tool_risk(tool: &McpTool, arguments: &Value) -> ToolRiskAssessment {
    let mut score = 0_i32;
    let mut reasons = Vec::new();
    let mut operation_class = RiskOperationClass::Unknown;
    let mut target_class = RiskTargetClass::Unknown;
    let mut boundary_class = ApprovalBoundaryClass::None;

    if tool.is_remote_sse() {
        score += 1;
        reasons.push("tool calls a remote MCP server".to_string());
        operation_class = RiskOperationClass::NetworkRead;
        boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
    } else if tool.supports_local_process_lifecycle() {
        score += 3;
        reasons.push("tool executes local host command".to_string());
        operation_class = RiskOperationClass::ProcessExec;
        target_class = RiskTargetClass::Host;
        boundary_class = ApprovalBoundaryClass::HardBoundary;
    }

    if !matches!(tool.source_type, McpSourceType::Local) {
        score += 2;
        reasons.push(format!("tool source is {}", tool.source_type.as_str()));
        boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
    }

    let command = tool.command.clone().unwrap_or_default().to_lowercase();
    let args_text = tool
        .args
        .clone()
        .unwrap_or_default()
        .join(" ")
        .to_lowercase();
    let argument_json = arguments.to_string().to_lowercase();

    let dangerous_keywords = [
        "powershell",
        "pwsh",
        "cmd.exe",
        "wscript",
        "cscript",
        "rundll32",
        "mshta",
        "bash",
        "sh ",
        " rm ",
        " del ",
        " rmdir ",
        " format ",
        " diskpart",
        " reg delete",
        "shutdown",
        "reboot",
    ];

    if dangerous_keywords.iter().any(|k| command.contains(k))
        || dangerous_keywords.iter().any(|k| args_text.contains(k))
        || dangerous_keywords.iter().any(|k| argument_json.contains(k))
        || is_high_risk_tool_name(&tool.name)
    {
        score += 3;
        reasons.push("command/args contain destructive or shell-like indicators".to_string());
        operation_class = RiskOperationClass::ProcessExec;
        boundary_class = ApprovalBoundaryClass::HardBoundary;
        if matches!(target_class, RiskTargetClass::Unknown) {
            target_class = RiskTargetClass::Host;
        }
    }

    let capabilities = tool
        .capabilities
        .iter()
        .map(|c| c.to_lowercase())
        .collect::<Vec<_>>();
    if capabilities.iter().any(|c| {
        c.contains("shell")
            || c.contains("terminal")
            || c.contains("write")
            || c.contains("network")
            || c.contains("filesystem")
    }) {
        score += 1;
        reasons.push("tool capabilities include privileged operations".to_string());
        if capabilities
            .iter()
            .any(|c| c.contains("shell") || c.contains("terminal"))
        {
            operation_class = RiskOperationClass::ProcessExec;
            target_class = RiskTargetClass::Host;
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        } else if capabilities.iter().any(|c| c.contains("write")) {
            if matches!(operation_class, RiskOperationClass::Unknown) {
                operation_class = RiskOperationClass::FilesystemWrite;
            }
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        } else if capabilities.iter().any(|c| c.contains("filesystem"))
            && matches!(operation_class, RiskOperationClass::Unknown)
        {
            operation_class = RiskOperationClass::FilesystemRead;
            boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
        } else if capabilities.iter().any(|c| c.contains("network"))
            && matches!(operation_class, RiskOperationClass::Unknown)
        {
            operation_class = RiskOperationClass::NetworkRead;
            boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
        }
    }

    if let Some(path) = arguments.get("path").and_then(Value::as_str) {
        if is_sensitive_path(path) {
            score += 2;
            reasons.push("access to sensitive path".to_string());
            target_class = RiskTargetClass::SensitivePath;
            if matches!(operation_class, RiskOperationClass::Unknown) {
                operation_class = RiskOperationClass::FilesystemRead;
            }
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        }
    }

    if let Some(url) = arguments.get("url").and_then(Value::as_str) {
        match classify_url_target(url) {
            Some(RiskTargetClass::Localhost) => {
                score += 1;
                reasons.push("network request to local endpoint".to_string());
                target_class = RiskTargetClass::Localhost;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
            Some(RiskTargetClass::PrivateNetwork) => {
                score += 1;
                reasons.push("network request to private network".to_string());
                target_class = RiskTargetClass::PrivateNetwork;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
            Some(RiskTargetClass::PublicInternet) => {
                target_class = RiskTargetClass::PublicInternet;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
                boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
            }
            _ => {}
        }
        if url.starts_with("http://") {
            score += 1;
            reasons.push("network request over insecure HTTP".to_string());
            boundary_class = max_boundary(boundary_class, ApprovalBoundaryClass::SoftBoundary);
        }
    }

    finalize_risk_assessment(
        score,
        reasons,
        operation_class,
        target_class,
        boundary_class,
        None,
    )
}

pub fn assess_skill_binding_risk(
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
) -> ToolRiskAssessment {
    let mut score = 0_i32;
    let mut reasons = Vec::new();
    let mut operation_class = RiskOperationClass::Unknown;
    let mut target_class = RiskTargetClass::Unknown;
    let mut boundary_class = ApprovalBoundaryClass::SoftBoundary;

    score += 1;
    reasons.push("skill binding executes local runtime".to_string());

    match binding.binding_kind.as_str() {
        "script_runner" => {
            score += 1;
            reasons.push("auto-generated from scripts/ directory".to_string());
        }
        "deeting_tool" => {}
        other => {
            score += 1;
            reasons.push(format!("binding kind: {}", other));
        }
    }

    match binding.runtime.to_lowercase().as_str() {
        "bash" => {
            score += 3;
            reasons.push("bash runtime has full shell access".to_string());
            operation_class = RiskOperationClass::ProcessExec;
            target_class = RiskTargetClass::Host;
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        }
        "python" => {
            score += 2;
            reasons.push("python runtime can access filesystem/network".to_string());
        }
        "node" => {
            score += 2;
            reasons.push("node runtime can access filesystem/network".to_string());
        }
        other => {
            score += 1;
            reasons.push(format!("unknown runtime: {}", other));
        }
    }

    let arg_str = arguments.to_string().to_lowercase();
    let critical_keywords = [
        "rm -rf",
        "rm -fr",
        "del /",
        "format ",
        "dd if=",
        "mkfs",
        "fdisk",
        "> /dev/",
        "curl | bash",
        "curl | sh",
        "wget |",
        "eval (",
        "exec (",
        "/bin/sh -c",
        "/bin/bash -c",
    ];
    for kw in critical_keywords {
        if arg_str.contains(kw) {
            score += 3;
            reasons.push(format!("critical keyword detected: {}", kw));
            operation_class = RiskOperationClass::ProcessExec;
            target_class = RiskTargetClass::Host;
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        }
    }

    let warning_keywords = [
        "powershell",
        "pwsh",
        "cmd.exe",
        "wscript",
        "cscript",
        "rundll32",
        "mshta",
        "shutdown",
        "reboot",
        "sudo ",
        "chmod 777",
        "chown ",
        ">/etc/",
        ">/root/",
        ">/home/",
    ];
    for kw in warning_keywords {
        if arg_str.contains(kw) {
            score += 2;
            reasons.push(format!("warning keyword detected: {}", kw));
            boundary_class = ApprovalBoundaryClass::HardBoundary;
            if matches!(operation_class, RiskOperationClass::Unknown) {
                operation_class = RiskOperationClass::ProcessExec;
                target_class = RiskTargetClass::Host;
            }
        }
    }

    if let Some(path) = arguments.get("path").and_then(Value::as_str) {
        if is_sensitive_path(path) {
            score += 2;
            reasons.push("access to sensitive path".to_string());
            target_class = RiskTargetClass::SensitivePath;
            if matches!(operation_class, RiskOperationClass::Unknown) {
                operation_class = RiskOperationClass::FilesystemRead;
            }
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        }
    }

    if let Some(url) = arguments.get("url").and_then(Value::as_str) {
        match classify_url_target(url) {
            Some(RiskTargetClass::Localhost) => {
                score += 1;
                reasons.push("network request to local endpoint".to_string());
                target_class = RiskTargetClass::Localhost;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
            Some(RiskTargetClass::PrivateNetwork) => {
                score += 1;
                reasons.push("network request to private network".to_string());
                target_class = RiskTargetClass::PrivateNetwork;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
            Some(RiskTargetClass::PublicInternet) => {
                target_class = RiskTargetClass::PublicInternet;
                if matches!(operation_class, RiskOperationClass::Unknown) {
                    operation_class = RiskOperationClass::NetworkRead;
                }
            }
            _ => {}
        }
        if url.starts_with("http://") {
            score += 1;
            reasons.push("network request over insecure HTTP".to_string());
        }
    }

    if is_high_risk_tool_name(&binding.tool_name) {
        score += 2;
        reasons.push("tool name matches high-risk pattern".to_string());
        boundary_class = ApprovalBoundaryClass::HardBoundary;
        if matches!(operation_class, RiskOperationClass::Unknown) {
            operation_class = RiskOperationClass::ProcessExec;
        }
    }

    finalize_risk_assessment(
        score,
        reasons,
        operation_class,
        target_class,
        boundary_class,
        Some((6, 4, 2)),
    )
}

pub fn classify_scan_runtime_risk(
    runtime: Option<&str>,
    file_path: Option<&str>,
) -> ToolRiskAssessment {
    let runtime = runtime
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_lowercase();
    let path = file_path.unwrap_or_default().to_lowercase();

    if runtime == "bash"
        || path.ends_with(".sh")
        || path.ends_with(".bat")
        || path.ends_with(".ps1")
    {
        return ToolRiskAssessment {
            requires_approval: true,
            risk_level: "HIGH",
            reasons: vec!["bundle includes shell/script execution surface".to_string()],
            operation_class: RiskOperationClass::ProcessExec,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        };
    }

    if runtime == "python"
        || runtime == "node"
        || path.ends_with(".py")
        || path.ends_with(".js")
        || path.ends_with(".ts")
        || path.ends_with(".mjs")
        || path.ends_with(".cjs")
    {
        return ToolRiskAssessment {
            requires_approval: true,
            risk_level: "MEDIUM",
            reasons: vec![
                "bundle includes runtime code that may perform network or filesystem reads"
                    .to_string(),
            ],
            operation_class: RiskOperationClass::Unknown,
            target_class: RiskTargetClass::Unknown,
            boundary_class: ApprovalBoundaryClass::SoftBoundary,
        };
    }

    ToolRiskAssessment {
        requires_approval: false,
        risk_level: "LOW",
        reasons: vec!["no runtime execution surface detected".to_string()],
        operation_class: RiskOperationClass::Unknown,
        target_class: RiskTargetClass::Unknown,
        boundary_class: ApprovalBoundaryClass::None,
    }
}

fn finalize_risk_assessment(
    score: i32,
    reasons: Vec<String>,
    operation_class: RiskOperationClass,
    target_class: RiskTargetClass,
    boundary_class: ApprovalBoundaryClass,
    thresholds: Option<(i32, i32, i32)>,
) -> ToolRiskAssessment {
    let (risk_level, requires_approval) = match thresholds {
        Some((critical, high, medium)) => {
            if score >= critical {
                ("CRITICAL", true)
            } else if score >= high {
                ("HIGH", true)
            } else if score >= medium {
                ("MEDIUM", true)
            } else {
                ("LOW", false)
            }
        }
        None => {
            if score >= 3 {
                ("HIGH", true)
            } else if score >= 2 {
                ("MEDIUM", true)
            } else {
                ("LOW", false)
            }
        }
    };

    ToolRiskAssessment {
        requires_approval,
        risk_level,
        reasons,
        operation_class,
        target_class,
        boundary_class,
    }
}

fn max_boundary(
    left: ApprovalBoundaryClass,
    right: ApprovalBoundaryClass,
) -> ApprovalBoundaryClass {
    use ApprovalBoundaryClass::{HardBoundary, None, SoftBoundary};
    match (left, right) {
        (HardBoundary, _) | (_, HardBoundary) => HardBoundary,
        (SoftBoundary, _) | (_, SoftBoundary) => SoftBoundary,
        _ => None,
    }
}

fn is_sensitive_path(path: &str) -> bool {
    let sensitive_paths = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"];
    sensitive_paths
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

fn classify_url_target(url: &str) -> Option<RiskTargetClass> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?.trim().to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return Some(RiskTargetClass::Localhost);
    }
    if let Ok(ip) = IpAddr::from_str(&host) {
        if ip.is_loopback() {
            return Some(RiskTargetClass::Localhost);
        }
        if is_private_ip(&ip) {
            return Some(RiskTargetClass::PrivateNetwork);
        }
        return Some(RiskTargetClass::PublicInternet);
    }
    if is_private_hostname(&host) {
        return Some(RiskTargetClass::PrivateNetwork);
    }
    Some(RiskTargetClass::PublicInternet)
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private() || v4.is_link_local() || v4.is_broadcast() || v4.is_unspecified()
        }
        IpAddr::V6(v6) => v6.is_unique_local() || v6.is_loopback() || v6.is_unspecified(),
    }
}

fn is_private_hostname(host: &str) -> bool {
    host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".lan")
        || host.ends_with(".home")
}

fn parse_operation_class(value: &str) -> RiskOperationClass {
    match value.trim() {
        "network_read" => RiskOperationClass::NetworkRead,
        "filesystem_read" => RiskOperationClass::FilesystemRead,
        "filesystem_write" => RiskOperationClass::FilesystemWrite,
        "process_exec" => RiskOperationClass::ProcessExec,
        _ => RiskOperationClass::Unknown,
    }
}

fn parse_target_class(value: &str) -> RiskTargetClass {
    match value.trim() {
        "host" => RiskTargetClass::Host,
        "public_internet" => RiskTargetClass::PublicInternet,
        "private_network" => RiskTargetClass::PrivateNetwork,
        "localhost" => RiskTargetClass::Localhost,
        "sensitive_path" => RiskTargetClass::SensitivePath,
        _ => RiskTargetClass::Unknown,
    }
}

fn parse_boundary_class(value: &str) -> ApprovalBoundaryClass {
    match value.trim() {
        "soft_boundary" => ApprovalBoundaryClass::SoftBoundary,
        "hard_boundary" => ApprovalBoundaryClass::HardBoundary,
        _ => ApprovalBoundaryClass::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcp_core::types::{McpSourceType, McpTool, McpToolStatus};

    fn sample_tool() -> McpTool {
        McpTool {
            id: "tool-1".to_string(),
            identifier: None,
            name: "fetch_docs".to_string(),
            service_key: None,
            service_display_name: None,
            service_description: None,
            source_type: McpSourceType::Local,
            source_id: Some("local".to_string()),
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: vec!["network".to_string()],
            description: "Fetch docs".to_string(),
            error: None,
            command: None,
            args: None,
            env: None,
            pending_config_json: None,
            config_json: r#"{"transport":"sse","url":"https://example.com/sse"}"#.to_string(),
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: mcp_core::types::McpConflictStatus::None,
            is_read_only: true,
            is_new: false,
            created_at: "2026-03-13T00:00:00Z".to_string(),
            updated_at: "2026-03-13T00:00:00Z".to_string(),
        }
    }

    fn sample_binding() -> LocalSkillToolBindingSnapshot {
        LocalSkillToolBindingSnapshot {
            binding_id: "binding-1".to_string(),
            binding_kind: "deeting_tool".to_string(),
            skill_id: "skill-1".to_string(),
            callable_name: "skill.fetch".to_string(),
            tool_name: "fetch_web_content".to_string(),
            description: "Fetch".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: "/tmp/fetch.py".to_string(),
            runtime: "python".to_string(),
            timeout_seconds: 30,
            updated_at: "2026-03-13T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn assess_skill_binding_risk_captures_public_network_read_shape() {
        let risk = assess_skill_binding_risk(
            &sample_binding(),
            &json!({"url": "https://example.com/docs"}),
        );

        assert_eq!(risk.risk_level, "MEDIUM");
        assert_eq!(risk.operation_class, RiskOperationClass::NetworkRead);
        assert_eq!(risk.target_class, RiskTargetClass::PublicInternet);
        assert_eq!(risk.boundary_class, ApprovalBoundaryClass::SoftBoundary);
    }

    #[test]
    fn assess_skill_binding_risk_escalates_localhost_to_hard_boundary() {
        let risk = assess_skill_binding_risk(
            &sample_binding(),
            &json!({"url": "http://127.0.0.1:8000/admin"}),
        );

        assert!(risk.requires_approval);
        assert_eq!(risk.target_class, RiskTargetClass::Localhost);
        assert_eq!(risk.boundary_class, ApprovalBoundaryClass::HardBoundary);
    }

    #[test]
    fn assess_mcp_tool_risk_marks_remote_network_tool_as_soft_boundary() {
        let risk = assess_mcp_tool_risk(&sample_tool(), &json!({"url": "https://example.com"}));

        assert!(risk.requires_approval);
        assert_eq!(risk.operation_class, RiskOperationClass::NetworkRead);
        assert_eq!(risk.target_class, RiskTargetClass::PublicInternet);
        assert_eq!(risk.boundary_class, ApprovalBoundaryClass::SoftBoundary);
    }

    #[test]
    fn assess_core_tool_risk_requires_approval_for_browser_open_tab() {
        let risk = assess_core_tool_risk("browser_open_tab", &json!({"url":"https://example.com"}));

        assert!(risk.requires_approval);
        assert_eq!(risk.operation_class, RiskOperationClass::NetworkRead);
        assert_eq!(risk.target_class, RiskTargetClass::PublicInternet);
    }

    #[test]
    fn assess_core_tool_risk_classifies_expanded_browser_tools() {
        let find = assess_core_tool_risk("browser_find_element", &json!({"tab_id": 1}));
        assert!(find.requires_approval);
        assert_eq!(find.risk_level, "MEDIUM");
        assert_eq!(find.operation_class, RiskOperationClass::NetworkRead);

        let active = assess_core_tool_risk("browser_get_active_page", &json!({}));
        assert!(!active.requires_approval);
        assert_eq!(active.risk_level, "LOW");

        let highlight = assess_core_tool_risk("browser_highlight", &json!({"tab_id": 1}));
        assert!(!highlight.requires_approval);
        assert_eq!(highlight.risk_level, "LOW");

        let fill = assess_core_tool_risk("browser_fill", &json!({"tab_id": 1}));
        assert!(fill.requires_approval);
        assert_eq!(fill.risk_level, "HIGH");
        assert_eq!(fill.operation_class, RiskOperationClass::ProcessExec);

        let storage_write = assess_core_tool_risk(
            "browser_storage_write",
            &json!({"tab_id": 1, "area": "localStorage"}),
        );
        assert!(storage_write.requires_approval);
        assert_eq!(storage_write.risk_level, "HIGH");
    }
    #[test]
    fn assess_core_tool_risk_allows_browser_agent_status_probe() {
        let risk = assess_core_tool_risk("browser_agent_status", &json!({}));

        assert!(!risk.requires_approval);
        assert_eq!(risk.boundary_class, ApprovalBoundaryClass::None);
    }

    #[test]
    fn soft_boundary_public_network_reads_are_grant_eligible() {
        let risk = assess_skill_binding_risk(
            &sample_binding(),
            &json!({"url": "https://example.com/docs"}),
        );
        let key = risk.session_grant_key("fingerprint-1");

        assert_eq!(
            key.as_deref(),
            Some("fingerprint-1|network_read|public_internet|soft_boundary")
        );
        assert!(risk.grant_eligible());
    }

    #[test]
    fn localhost_requests_do_not_produce_session_grants() {
        let risk = assess_skill_binding_risk(
            &sample_binding(),
            &json!({"url": "http://127.0.0.1:8000/admin"}),
        );

        assert!(!risk.grant_eligible());
        assert!(risk.session_grant_key("fingerprint-2").is_none());
    }

    #[test]
    fn session_approval_grant_round_trips_from_key() {
        let key = "fp-1|network_read|public_internet|soft_boundary";
        let grant = SessionApprovalGrant::from_key(key, 1234).expect("grant");

        assert_eq!(grant.key, key);
        assert_eq!(grant.tool_fingerprint, "fp-1");
        assert_eq!(grant.operation_class, RiskOperationClass::NetworkRead);
        assert_eq!(grant.target_class, RiskTargetClass::PublicInternet);
        assert_eq!(grant.boundary_class, ApprovalBoundaryClass::SoftBoundary);
        assert_eq!(grant.created_at_unix_ms, 1234);
    }

    #[test]
    fn approval_classes_from_key_reads_canonical_tail_tuple() {
        assert_eq!(
            approval_classes_from_key("fingerprint-1|network_read|public_internet|soft_boundary"),
            (
                "network_read".to_string(),
                "public_internet".to_string(),
                "soft_boundary".to_string(),
            )
        );
    }

    #[test]
    fn approval_classes_from_key_ignores_legacy_prefix_segments() {
        assert_eq!(
            approval_classes_from_key(
                "shell_execute|Select-Object FullName, Name, PSIsContainer|ConvertTo-Json -Depth 3|process_exec|host|soft_boundary"
            ),
            (
                "process_exec".to_string(),
                "host".to_string(),
                "soft_boundary".to_string(),
            )
        );
    }
}
