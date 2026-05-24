use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    configure_windows_test_manifest();

    if let Err(err) = build_boxlite_sidecar() {
        println!(
            "cargo:warning=failed to build deeting-boxlite-sidecar: {err}. Sandbox WSL backend will fall back to host-python at runtime."
        );
    }
    tauri_build::build()
}

fn configure_windows_test_manifest() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    println!(
        "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    );
}

fn build_boxlite_sidecar() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| e.to_string())?);
    let main_target_dir = out_dir
        .ancestors()
        .nth(3)
        .ok_or("failed to resolve main profile target dir from OUT_DIR")?
        .to_path_buf();
    let main_target_root = out_dir
        .ancestors()
        .nth(4)
        .ok_or("failed to resolve main target root from OUT_DIR")?
        .to_path_buf();
    let sidecar_manifest = manifest_dir
        .join("crates")
        .join("deeting-boxlite-sidecar")
        .join("Cargo.toml");
    if !sidecar_manifest.exists() {
        return Err(format!(
            "sidecar manifest not found at {}",
            sidecar_manifest.display()
        ));
    }

    println!("cargo:rerun-if-changed={}", sidecar_manifest.display());
    let src_dir = sidecar_manifest
        .parent()
        .ok_or("sidecar manifest has no parent")?
        .join("src");
    if src_dir.exists() {
        println!("cargo:rerun-if-changed={}", src_dir.display());
    }

    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let sidecar_target_root = main_target_root.join("sidecar-build");

    let mut cmd = Command::new(&cargo);
    cmd.arg("build")
        .arg("--manifest-path")
        .arg(&sidecar_manifest)
        .arg("--target-dir")
        .arg(&sidecar_target_root);
    if profile == "release" {
        cmd.arg("--release");
    }

    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("cargo build for sidecar exited with {status}"));
    }

    let sidecar_target = sidecar_target_root.join(&profile);
    let bin_name = if cfg!(windows) {
        "deeting-boxlite-sidecar.exe"
    } else {
        "deeting-boxlite-sidecar"
    };
    let built = sidecar_target.join(bin_name);
    if !built.exists() {
        return Err(format!(
            "sidecar binary missing after build: {}",
            built.display()
        ));
    }

    let dest = main_target_dir.join(bin_name);
    std::fs::copy(&built, &dest).map_err(|e| {
        format!(
            "failed to copy {} -> {}: {}",
            built.display(),
            dest.display(),
            e
        )
    })?;

    let target_triple = env::var("TARGET").map_err(|e| e.to_string())?;
    let triple_bin_name = if cfg!(windows) {
        format!("deeting-boxlite-sidecar-{target_triple}.exe")
    } else {
        format!("deeting-boxlite-sidecar-{target_triple}")
    };
    let binaries_dir = manifest_dir.join("binaries");
    std::fs::create_dir_all(&binaries_dir).map_err(|e| e.to_string())?;
    let triple_dest = binaries_dir.join(&triple_bin_name);
    std::fs::copy(&built, &triple_dest).map_err(|e| {
        format!(
            "failed to copy {} -> {}: {}",
            built.display(),
            triple_dest.display(),
            e
        )
    })?;

    println!(
        "cargo:rustc-env=DEETING_BOXLITE_SIDECAR_BUILT={}",
        dest.display()
    );
    Ok(())
}
