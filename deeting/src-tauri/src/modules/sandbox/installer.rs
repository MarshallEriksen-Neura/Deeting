#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
use crate::modules::desktop_config::network::build_proxy_aware_reqwest_client_for_settings;
use crate::modules::desktop_config::network::DesktopNetworkProxySettings;
#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{
    decode_wsl_text, detect_wsl_arch, resolve_wsl_home_dir, shell_quote, windows_path_to_wsl,
};
use crate::modules::sandbox::error::SandboxError;
#[cfg(target_os = "windows")]
use crate::utils::configure_background_std_command;

const BOXLITE_VERSION: &str = "0.8.2";
const BOXLITE_RELEASE_BASE: &str = "https://github.com/boxlite-ai/boxlite/releases/download/v0.8.2";
const INSTALL_RECORD_NAME: &str = "boxlite-installation.json";

#[derive(Debug, Clone)]
pub struct BoxLiteInstallerConfig {
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxLiteInstallationRecord {
    pub version: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_sha256: String,
    pub wsl_home: String,
    pub wsl_install_dir: String,
    pub wsl_binary_path: String,
    pub wsl_boxlite_home: String,
}

#[derive(Debug, Clone)]
struct BoxLiteReleaseAsset {
    asset_name: &'static str,
    sha256: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxLiteInstallProgress {
    pub stage: &'static str,
    pub percent: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
}

pub type ProgressReporter = Arc<dyn Fn(BoxLiteInstallProgress) + Send + Sync>;

fn report(reporter: Option<&ProgressReporter>, progress: BoxLiteInstallProgress) {
    if let Some(reporter) = reporter {
        reporter(progress);
    }
}

pub(crate) async fn install_boxlite_wsl(
    config: &BoxLiteInstallerConfig,
    reporter: Option<ProgressReporter>,
    proxy_settings: Option<&DesktopNetworkProxySettings>,
) -> Result<BoxLiteInstallationRecord, SandboxError> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = config;
        let _ = reporter;
        let _ = proxy_settings;
        return Err(SandboxError::Unavailable(
            "managed BoxLite installation is only supported on Windows + WSL".to_string(),
        ));
    }

    #[cfg(target_os = "windows")]
    {
        fs::create_dir_all(&config.data_dir)?;

        report(
            reporter.as_ref(),
            BoxLiteInstallProgress {
                stage: "download",
                percent: 0,
                bytes_downloaded: Some(0),
                bytes_total: None,
            },
        );

        let wsl_arch = detect_wsl_arch()?;
        let release = release_asset_for_wsl_arch(&wsl_arch)?;
        let download_client = proxy_settings
            .map(build_proxy_aware_reqwest_client_for_settings)
            .transpose()
            .map_err(SandboxError::Validation)?;
        let downloaded_asset = download_release_asset(
            &config.data_dir,
            &release,
            reporter.as_ref(),
            download_client.as_ref(),
        )
        .await?;

        report(
            reporter.as_ref(),
            BoxLiteInstallProgress {
                stage: "verify",
                percent: 85,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );

        let wsl_home = resolve_wsl_home_dir()?;
        let install_root = format!("{wsl_home}/.deeting/sandbox/boxlite");
        let wsl_install_dir = format!("{install_root}/cli");
        let wsl_binary_path = format!("{wsl_install_dir}/boxlite");
        let wsl_boxlite_home = format!("{install_root}/home");
        let asset_wsl_path = windows_path_to_wsl(&downloaded_asset)?;

        report(
            reporter.as_ref(),
            BoxLiteInstallProgress {
                stage: "extract",
                percent: 92,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );

        install_cli_into_wsl(
            &asset_wsl_path,
            &wsl_install_dir,
            &wsl_binary_path,
            &wsl_boxlite_home,
        )?;

        let record = BoxLiteInstallationRecord {
            version: BOXLITE_VERSION.to_string(),
            asset_name: release.asset_name.to_string(),
            asset_url: release_asset_url(&release),
            asset_sha256: release.sha256.to_string(),
            wsl_home,
            wsl_install_dir,
            wsl_binary_path,
            wsl_boxlite_home,
        };
        fs::write(
            installation_record_path(&config.data_dir),
            serde_json::to_vec_pretty(&record)
                .map_err(|err| SandboxError::Internal(err.to_string()))?,
        )?;

        report(
            reporter.as_ref(),
            BoxLiteInstallProgress {
                stage: "done",
                percent: 100,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );

        Ok(record)
    }
}

pub fn installation_record_path(data_dir: &Path) -> PathBuf {
    data_dir.join(INSTALL_RECORD_NAME)
}

pub fn load_installation_record(data_dir: &Path) -> Option<BoxLiteInstallationRecord> {
    let path = installation_record_path(data_dir);
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn release_asset_for_wsl_arch(wsl_arch: &str) -> Result<BoxLiteReleaseAsset, SandboxError> {
    let release = match wsl_arch {
        "x86_64" => BoxLiteReleaseAsset {
            asset_name: "boxlite-cli-v0.8.2-x86_64-unknown-linux-gnu.tar.gz",
            sha256: "61b8e6ad3356ea06f78e2a2ea958b6595593f55fd63f3bfb770897f35fc038ed",
        },
        "aarch64" => BoxLiteReleaseAsset {
            asset_name: "boxlite-cli-v0.8.2-aarch64-unknown-linux-gnu.tar.gz",
            sha256: "6dbd215c8965968c62ad4ceca7cccf6165a6068ad9188d6fdb9a26fdac6b1b73",
        },
        other => {
            return Err(SandboxError::Unavailable(format!(
                "WSL architecture {other} is not supported for managed BoxLite {} installation.",
                BOXLITE_VERSION
            )));
        }
    };
    Ok(release)
}

fn release_asset_url(release: &BoxLiteReleaseAsset) -> String {
    format!("{BOXLITE_RELEASE_BASE}/{}", release.asset_name)
}

async fn download_release_asset(
    data_dir: &Path,
    release: &BoxLiteReleaseAsset,
    reporter: Option<&ProgressReporter>,
    client: Option<&reqwest::Client>,
) -> Result<PathBuf, SandboxError> {
    let download_dir = data_dir.join("downloads");
    fs::create_dir_all(&download_dir)?;
    let download_path = download_dir.join(release.asset_name);
    if download_path.is_file() && verify_file_sha256(&download_path, release.sha256)? {
        report(
            reporter,
            BoxLiteInstallProgress {
                stage: "download",
                percent: 80,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );
        return Ok(download_path);
    }

    let default_client;
    let client = match client {
        Some(client) => client,
        None => {
            default_client = reqwest::Client::builder()
                .build()
                .map_err(|err| SandboxError::Internal(err.to_string()))?;
            &default_client
        }
    };
    let response = client.get(release_asset_url(release)).send().await?;
    let response = response.error_for_status()?;
    let total_bytes = response.content_length();

    let mut buffer: Vec<u8> = match total_bytes {
        Some(len) => Vec::with_capacity(len as usize),
        None => Vec::new(),
    };
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit_percent: u32 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.extend_from_slice(&chunk);
        downloaded = downloaded.saturating_add(chunk.len() as u64);

        let percent = match total_bytes {
            Some(total) if total > 0 => {
                let fraction = downloaded as f64 / total as f64;
                (fraction.clamp(0.0, 1.0) * 80.0) as u32
            }
            _ => 40,
        };
        if percent >= last_emit_percent.saturating_add(2) || percent >= 80 {
            last_emit_percent = percent;
            report(
                reporter,
                BoxLiteInstallProgress {
                    stage: "download",
                    percent,
                    bytes_downloaded: Some(downloaded),
                    bytes_total: total_bytes,
                },
            );
        }
    }
    verify_bytes_sha256(&buffer, release.sha256)?;

    let temp_path = download_path.with_extension("partial");
    fs::write(&temp_path, &buffer)?;
    let _ = fs::remove_file(&download_path);
    fs::rename(temp_path, &download_path)?;
    Ok(download_path)
}

#[cfg(target_os = "windows")]
fn install_cli_into_wsl(
    asset_wsl_path: &str,
    wsl_install_dir: &str,
    wsl_binary_path: &str,
    wsl_boxlite_home: &str,
) -> Result<(), SandboxError> {
    for (label, value) in [
        ("asset", asset_wsl_path),
        ("install_dir", wsl_install_dir),
        ("binary_path", wsl_binary_path),
        ("boxlite_home", wsl_boxlite_home),
    ] {
        if value.trim().is_empty() {
            return Err(SandboxError::Unavailable(format!(
                "failed to install BoxLite CLI into WSL: {label} resolved to an empty path"
            )));
        }
    }
    let script = format!(
        "#!/usr/bin/env bash\n\
set -eu\n\
asset={asset}\n\
install_dir={install_dir}\n\
binary_path={binary_path}\n\
boxlite_home={boxlite_home}\n\
tmp_dir=\"${{install_dir}}.tmp\"\n\
rm -rf \"$tmp_dir\"\n\
mkdir -p \"$tmp_dir\" \"$boxlite_home\"\n\
tar -xzf \"$asset\" -C \"$tmp_dir\"\n\
binary=$(find \"$tmp_dir\" -type f -name boxlite | head -n 1)\n\
if [ -z \"$binary\" ]; then echo 'boxlite binary not found in archive' >&2; exit 1; fi\n\
rm -rf \"$install_dir\"\n\
mkdir -p \"$install_dir\"\n\
mv \"$binary\" \"$binary_path\"\n\
chmod +x \"$binary_path\"\n\
rm -rf \"$tmp_dir\"\n",
        asset = shell_quote(asset_wsl_path),
        install_dir = shell_quote(wsl_install_dir),
        binary_path = shell_quote(wsl_binary_path),
        boxlite_home = shell_quote(wsl_boxlite_home),
    );

    // wsl.exe's argument translation mangles complex inline scripts that mix
    // single quotes, double quotes and `$var` expansions — the dollar-sign
    // references get stripped en route to bash, which is why shell variables
    // arrive empty. Materialise the script on disk and execute it by path.
    let script_host_path =
        std::env::temp_dir().join(format!("deeting-boxlite-install-{}.sh", std::process::id()));
    fs::write(&script_host_path, script.as_bytes())?;
    let script_wsl_path = windows_path_to_wsl(&script_host_path).inspect_err(|_| {
        let _ = fs::remove_file(&script_host_path);
    })?;

    let mut command = std::process::Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    let output = command
        .args(["--", "bash", script_wsl_path.as_str()])
        .output();
    let _ = fs::remove_file(&script_host_path);
    let output = output.map_err(|err| {
        SandboxError::Unavailable(format!("failed to install BoxLite CLI into WSL: {err}"))
    })?;
    if !output.status.success() {
        let stderr = decode_wsl_text(&output.stderr);
        let stdout = decode_wsl_text(&output.stdout);
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit code {}", output.status.code().unwrap_or(-1))
        };
        return Err(SandboxError::Unavailable(format!(
            "failed to install BoxLite CLI into WSL: {detail}"
        )));
    }
    Ok(())
}

fn verify_file_sha256(path: &Path, expected: &str) -> Result<bool, SandboxError> {
    let bytes = fs::read(path)?;
    Ok(compute_sha256_hex(&bytes) == expected)
}

fn verify_bytes_sha256(bytes: &[u8], expected: &str) -> Result<(), SandboxError> {
    let actual = compute_sha256_hex(bytes);
    if actual != expected {
        return Err(SandboxError::Internal(format!(
            "downloaded BoxLite asset failed integrity verification: expected {expected}, got {actual}"
        )));
    }
    Ok(())
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_asset_supports_known_wsl_architectures() {
        assert_eq!(
            release_asset_for_wsl_arch("x86_64").unwrap().asset_name,
            "boxlite-cli-v0.8.2-x86_64-unknown-linux-gnu.tar.gz"
        );
        assert_eq!(
            release_asset_for_wsl_arch("aarch64").unwrap().asset_name,
            "boxlite-cli-v0.8.2-aarch64-unknown-linux-gnu.tar.gz"
        );
        assert!(release_asset_for_wsl_arch("armv7l").is_err());
    }

    #[test]
    fn compute_sha256_matches_expected_value() {
        assert_eq!(
            compute_sha256_hex(b"deeting-boxlite"),
            "72e62eb482f18bb0ce0e22f4ec8546afdc5b46f53e59d2bf5d2fa07ca501d727"
        );
    }
}
