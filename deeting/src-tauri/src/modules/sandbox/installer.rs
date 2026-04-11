#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{
    detect_wsl_arch, resolve_wsl_home_dir, shell_quote, windows_path_to_wsl,
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

pub async fn install_boxlite_wsl(
    config: &BoxLiteInstallerConfig,
) -> Result<BoxLiteInstallationRecord, SandboxError> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = config;
        return Err(SandboxError::Unavailable(
            "managed BoxLite installation is only supported on Windows + WSL".to_string(),
        ));
    }

    #[cfg(target_os = "windows")]
    {
        fs::create_dir_all(&config.data_dir)?;

        let wsl_arch = detect_wsl_arch()?;
        let release = release_asset_for_wsl_arch(&wsl_arch)?;
        let downloaded_asset = download_release_asset(&config.data_dir, &release).await?;

        let wsl_home = resolve_wsl_home_dir()?;
        let install_root = format!("{wsl_home}/.deeting/sandbox/boxlite");
        let wsl_install_dir = format!("{install_root}/cli");
        let wsl_binary_path = format!("{wsl_install_dir}/boxlite");
        let wsl_boxlite_home = format!("{install_root}/home");
        let asset_wsl_path = windows_path_to_wsl(&downloaded_asset)?;

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
) -> Result<PathBuf, SandboxError> {
    let download_dir = data_dir.join("downloads");
    fs::create_dir_all(&download_dir)?;
    let download_path = download_dir.join(release.asset_name);
    if download_path.is_file() && verify_file_sha256(&download_path, release.sha256)? {
        return Ok(download_path);
    }

    let response = reqwest::Client::builder()
        .build()
        .map_err(|err| SandboxError::Internal(err.to_string()))?
        .get(release_asset_url(release))
        .send()
        .await?;
    let response = response.error_for_status()?;
    let bytes = response.bytes().await?;
    verify_bytes_sha256(bytes.as_ref(), release.sha256)?;

    let temp_path = download_path.with_extension("partial");
    fs::write(&temp_path, &bytes)?;
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
    let script = format!(
        "set -eu; \
asset={asset}; \
install_dir={install_dir}; \
binary_path={binary_path}; \
boxlite_home={boxlite_home}; \
tmp_dir=\"$install_dir.tmp\"; \
rm -rf \"$tmp_dir\"; \
mkdir -p \"$tmp_dir\" \"$boxlite_home\"; \
tar -xzf \"$asset\" -C \"$tmp_dir\"; \
binary=$(find \"$tmp_dir\" -type f -name boxlite | head -n 1); \
if [ -z \"$binary\" ]; then echo 'boxlite binary not found in archive' >&2; exit 1; fi; \
rm -rf \"$install_dir\"; \
mkdir -p \"$install_dir\"; \
mv \"$binary\" \"$binary_path\"; \
chmod +x \"$binary_path\"; \
rm -rf \"$tmp_dir\"",
        asset = shell_quote(asset_wsl_path),
        install_dir = shell_quote(wsl_install_dir),
        binary_path = shell_quote(wsl_binary_path),
        boxlite_home = shell_quote(wsl_boxlite_home),
    );
    let mut command = std::process::Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    let output = command
        .args(["--", "bash", "-lc", &script])
        .output()
        .map_err(|err| {
            SandboxError::Unavailable(format!("failed to install BoxLite CLI into WSL: {err}"))
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
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
