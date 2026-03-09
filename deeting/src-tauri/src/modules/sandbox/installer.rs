#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{
    detect_wsl_python_abi, resolve_wsl_home_dir, shell_quote, windows_path_to_wsl,
};
use crate::modules::sandbox::error::SandboxError;

const BOXLITE_VERSION: &str = "0.6.0";
const BOXLITE_RELEASE_BASE: &str = "https://github.com/boxlite-ai/boxlite/releases/download/v0.6.0";
const BRIDGE_SCRIPT_NAME: &str = "boxlite_bridge.py";
const INSTALL_RECORD_NAME: &str = "boxlite-installation.json";
const SUPPORTED_PYTHON_ABIS: [&str; 4] = ["cp310", "cp311", "cp312", "cp313"];

#[derive(Debug, Clone)]
pub struct BoxLiteInstallerConfig {
    pub data_dir: PathBuf,
    pub python_bin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxLiteInstallationRecord {
    pub version: String,
    pub python_bin: String,
    pub python_abi: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_sha256: String,
    pub wsl_home: String,
    pub wsl_site_dir: String,
    pub wsl_runtime_home: String,
    pub wsl_state_dir: String,
    pub bridge_script_host_path: String,
    pub bridge_script_wsl_path: String,
}

#[derive(Debug, Clone)]
struct BoxLiteReleaseAsset {
    python_abi: &'static str,
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

        let python_abi = detect_wsl_python_abi(&config.python_bin)?;
        let release = release_asset_for_python_abi(&python_abi)?;
        let downloaded_asset = download_release_asset(&config.data_dir, &release).await?;
        let bridge_script_host_path = write_bridge_script(&config.data_dir)?;

        let wsl_home = resolve_wsl_home_dir()?;
        let wsl_site_dir = format!("{wsl_home}/.deeting/sandbox/boxlite/site-packages");
        let wsl_runtime_home = format!("{wsl_home}/.deeting/sandbox/boxlite/runtime-home");
        let wsl_state_dir = format!("{wsl_home}/.deeting/sandbox/boxlite/state");
        let wheel_wsl_path = windows_path_to_wsl(&downloaded_asset)?;
        let bridge_script_wsl_path = windows_path_to_wsl(&bridge_script_host_path)?;

        install_wheel_into_wsl(
            &config.python_bin,
            &wheel_wsl_path,
            &wsl_site_dir,
            &wsl_runtime_home,
            &wsl_state_dir,
        )?;

        let record = BoxLiteInstallationRecord {
            version: BOXLITE_VERSION.to_string(),
            python_bin: config.python_bin.clone(),
            python_abi: python_abi.clone(),
            asset_name: release.asset_name.to_string(),
            asset_url: release_asset_url(&release),
            asset_sha256: release.sha256.to_string(),
            wsl_home,
            wsl_site_dir,
            wsl_runtime_home,
            wsl_state_dir,
            bridge_script_host_path: bridge_script_host_path.display().to_string(),
            bridge_script_wsl_path,
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

pub fn bridge_script_host_path(data_dir: &Path) -> PathBuf {
    data_dir.join(BRIDGE_SCRIPT_NAME)
}

pub fn load_installation_record(data_dir: &Path) -> Option<BoxLiteInstallationRecord> {
    let path = installation_record_path(data_dir);
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn is_supported_python_abi(python_abi: &str) -> bool {
    SUPPORTED_PYTHON_ABIS.contains(&python_abi)
}

pub fn supported_python_abis_label() -> &'static str {
    "cp310, cp311, cp312, cp313"
}

fn release_asset_for_python_abi(python_abi: &str) -> Result<BoxLiteReleaseAsset, SandboxError> {
    let release = match python_abi {
        "cp310" => BoxLiteReleaseAsset {
            python_abi: "cp310",
            asset_name: "boxlite-0.6.0-cp310-cp310-manylinux_2_28_x86_64.whl",
            sha256: "eefc50988d788cd691c64c095d8020e7153922462cc72af807632e0355ad1f18",
        },
        "cp311" => BoxLiteReleaseAsset {
            python_abi: "cp311",
            asset_name: "boxlite-0.6.0-cp311-cp311-manylinux_2_28_x86_64.whl",
            sha256: "ba7f50cadc630a20ab46d7255b9d94a3c0b6fb905e37717747e1d9523d0b6b1c",
        },
        "cp312" => BoxLiteReleaseAsset {
            python_abi: "cp312",
            asset_name: "boxlite-0.6.0-cp312-cp312-manylinux_2_28_x86_64.whl",
            sha256: "42ea936b0dd692a6550f7e4c5309cd51d86b0b25cf5c1789d58093db3f0409fe",
        },
        "cp313" => BoxLiteReleaseAsset {
            python_abi: "cp313",
            asset_name: "boxlite-0.6.0-cp313-cp313-manylinux_2_28_x86_64.whl",
            sha256: "53352002d36c73b0652d3c8bb18ae7d09715db6d9f89488505896b53bee972a7",
        },
        _ => {
            return Err(SandboxError::Unavailable(format!(
                "WSL Python ABI {python_abi} is not supported for BoxLite {}. Supported ABIs: cp310, cp311, cp312, cp313",
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

fn write_bridge_script(data_dir: &Path) -> Result<PathBuf, SandboxError> {
    let path = bridge_script_host_path(data_dir);
    let contents = include_str!("boxlite_bridge.py");
    match fs::read_to_string(&path) {
        Ok(existing) if existing == contents => Ok(path),
        _ => {
            fs::write(&path, contents)?;
            Ok(path)
        }
    }
}

#[cfg(target_os = "windows")]
fn install_wheel_into_wsl(
    python_bin: &str,
    wheel_wsl_path: &str,
    wsl_site_dir: &str,
    wsl_runtime_home: &str,
    wsl_state_dir: &str,
) -> Result<(), SandboxError> {
    let script = format!(
        "set -eu; mkdir -p {site} {runtime} {state}; {python} - <<'PY'\nimport os, shutil, zipfile\nwheel={wheel}\nsite={site}\ntmp=site + '.tmp'\nshutil.rmtree(tmp, ignore_errors=True)\nshutil.rmtree(site, ignore_errors=True)\nos.makedirs(tmp, exist_ok=True)\nwith zipfile.ZipFile(wheel) as archive:\n    archive.extractall(tmp)\nos.makedirs(site, exist_ok=True)\nfor name in os.listdir(tmp):\n    shutil.move(os.path.join(tmp, name), os.path.join(site, name))\nshutil.rmtree(tmp, ignore_errors=True)\nPY\nchmod +x {site}/boxlite/runtime/boxlite-shim {site}/boxlite/runtime/boxlite-guest || true",
        python = shell_quote(python_bin),
        wheel = shell_quote(wheel_wsl_path),
        site = shell_quote(wsl_site_dir),
        runtime = shell_quote(wsl_runtime_home),
        state = shell_quote(wsl_state_dir),
    );
    let output = std::process::Command::new("wsl.exe")
        .args(["--", "bash", "-lc", &script])
        .output()
        .map_err(|err| {
            SandboxError::Unavailable(format!("failed to install BoxLite into WSL: {err}"))
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(SandboxError::Unavailable(format!(
            "failed to install BoxLite into WSL: {detail}"
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
    fn release_asset_supports_known_python_abis() {
        assert_eq!(
            release_asset_for_python_abi("cp310").unwrap().python_abi,
            "cp310"
        );
        assert_eq!(
            release_asset_for_python_abi("cp311").unwrap().python_abi,
            "cp311"
        );
        assert!(release_asset_for_python_abi("cp39").is_err());
    }

    #[test]
    fn compute_sha256_matches_expected_value() {
        assert_eq!(
            compute_sha256_hex(b"deeting-boxlite"),
            "72e62eb482f18bb0ce0e22f4ec8546afdc5b46f53e59d2bf5d2fa07ca501d727"
        );
    }
}
