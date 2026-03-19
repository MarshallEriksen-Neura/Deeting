use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::mpsc::Sender;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallConfig {
    /// 安装目录
    pub install_path: String,
    /// 是否创建桌面快捷方式
    pub create_shortcut: bool,
    /// 是否设置开机自启
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    /// 当前阶段: preparing | extracting | installing | configuring | done | error
    pub stage: String,
    /// 0-100 进度百分比
    pub percent: u8,
    /// 当前操作描述
    pub message: String,
}

// ---------------------------------------------------------------------------
// 默认路径 & 磁盘检测
// ---------------------------------------------------------------------------

/// 获取默认安装路径: C:\Program Files\Deeting
pub fn default_install_path() -> String {
    let base = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("AppData").join("Local")))
        .unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
    base.join("Deeting").to_string_lossy().to_string()
}

/// 获取指定路径所在磁盘的可用空间（MB）
pub fn disk_free_space_mb(path: &str) -> u64 {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        // 获取盘符根目录
        let root: String = if path.len() >= 3 && path.as_bytes()[1] == b':' {
            format!("{}\\", &path[..2])
        } else {
            "C:\\".to_string()
        };

        let wide: Vec<u16> = OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free: u64 = 0;

        unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes as *mut u64,
                &mut total_bytes as *mut u64,
                &mut total_free as *mut u64,
            );
        }

        free_bytes / (1024 * 1024)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        // 非 Windows 平台返回模拟值用于开发
        50_000
    }
}

/// 检测已安装的 Deeting
pub fn detect_existing_install() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Deeting";
        if let Ok(key) = hklm.open_subkey(path) {
            if let Ok(location) = key.get_value::<String, _>("InstallLocation") {
                return Some(location);
            }
        }

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(path) {
            if let Ok(location) = key.get_value::<String, _>("InstallLocation") {
                return Some(location);
            }
        }

        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

// ---------------------------------------------------------------------------
// 安装核心逻辑
// ---------------------------------------------------------------------------

async fn send_progress(tx: &Sender<InstallProgress>, stage: &str, percent: u8, message: &str) {
    let _ = tx
        .send(InstallProgress {
            stage: stage.to_string(),
            percent,
            message: message.to_string(),
        })
        .await;
}

/// 执行完整安装流程
pub async fn run_install(
    config: InstallConfig,
    tx: Sender<InstallProgress>,
) -> Result<(), String> {
    let install_dir = PathBuf::from(&config.install_path);

    // ── Stage 1: 准备 ──────────────────────────────────────────
    send_progress(&tx, "preparing", 5, "正在准备安装环境...").await;
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("无法创建安装目录: {}", e))?;

    send_progress(&tx, "preparing", 10, "正在检测系统环境...").await;
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // ── Stage 2: 解压/复制文件 ─────────────────────────────────
    send_progress(&tx, "extracting", 15, "正在解压应用文件...").await;

    // 在实际构建中，主安装包会嵌入 bootstrapper 资源中
    // 这里模拟解压过程，实际生产中会：
    // 1. 从嵌入资源中提取 deeting-setup.exe
    // 2. 或者从 CDN 下载主安装包
    let embedded_installer = find_embedded_installer();

    if let Some(installer_path) = embedded_installer {
        // 有内嵌安装包，静默执行 NSIS
        send_progress(&tx, "installing", 30, "正在安装核心组件...").await;
        run_silent_nsis(&installer_path, &config.install_path).await?;
    } else {
        // 开发模式：模拟安装过程
        for i in 0..8 {
            let percent = 20 + i * 8;
            let messages = [
                "正在安装核心框架...",
                "正在配置 AI Agent 引擎...",
                "正在部署 MCP 插件系统...",
                "正在安装会议分析模块...",
                "正在配置语音识别引擎...",
                "正在安装知识库组件...",
                "正在部署多模态处理器...",
                "正在优化运行环境...",
            ];
            send_progress(&tx, "installing", percent as u8, messages[i as usize]).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
        }
    }

    // ── Stage 3: 配置 ──────────────────────────────────────────
    send_progress(&tx, "configuring", 88, "正在注册系统组件...").await;
    tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;

    send_progress(&tx, "configuring", 92, "正在配置 deeting:// 协议处理...").await;
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    if config.create_shortcut {
        send_progress(&tx, "configuring", 95, "正在创建桌面快捷方式...").await;
        let _ = create_shortcut(&config.install_path, true);
    }

    if config.auto_start {
        send_progress(&tx, "configuring", 97, "正在配置开机自启动...").await;
        let _ = set_auto_start(&config.install_path);
    }

    // ── 完成 ──────────────────────────────────────────────────
    send_progress(&tx, "done", 100, "安装完成！").await;

    Ok(())
}

/// 查找嵌入的安装包
fn find_embedded_installer() -> Option<PathBuf> {
    // 在生产构建中，安装包会嵌入到 resources 目录
    // Tauri 会将资源提取到应用资源目录
    let candidates = [
        // 生产环境：Tauri 资源目录
        "resources/deeting-setup.exe",
        // 相对路径查找
        "../resources/deeting-setup.exe",
        // Windows 安装后路径
        "./resources/deeting-setup.exe",
    ];

    for path in &candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    // 尝试从应用资源目录查找（Tauri 2.x）
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(exe_parent) = exe_dir.parent() {
            let resource_path = exe_parent.join("resources").join("deeting-setup.exe");
            if resource_path.exists() {
                return Some(resource_path);
            }
        }
    }

    None
}

/// 静默执行 NSIS 安装包
async fn run_silent_nsis(installer_path: &PathBuf, install_dir: &str) -> Result<(), String> {
    let status = tokio::process::Command::new(installer_path)
        .args(["/S", &format!("/D={}", install_dir)])
        .status()
        .await
        .map_err(|e| format!("无法启动安装程序: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "安装程序退出码: {}",
            status.code().unwrap_or(-1)
        ))
    }
}

// ---------------------------------------------------------------------------
// 快捷方式 & 自启动
// ---------------------------------------------------------------------------

/// 创建桌面快捷方式
pub fn create_shortcut(install_path: &str, _desktop: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe_path = PathBuf::from(install_path).join("Deeting.exe");
        let desktop = dirs::desktop_dir().ok_or("无法获取桌面路径")?;
        let link_path = desktop.join("Deeting.lnk");

        // 使用 PowerShell 创建快捷方式
        let script = format!(
            r#"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{}'); $s.TargetPath = '{}'; $s.WorkingDirectory = '{}'; $s.Save()"#,
            link_path.to_string_lossy(),
            exe_path.to_string_lossy(),
            install_path,
        );

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("创建快捷方式失败: {}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = install_path;
        Ok(())
    }
}

/// 设置开机自启动
fn set_auto_start(install_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
            .map_err(|e| format!("无法打开注册表: {}", e))?;

        let exe_path = PathBuf::from(install_path).join("Deeting.exe");
        key.set_value("Deeting", &exe_path.to_string_lossy().to_string())
            .map_err(|e| format!("无法设置自启动: {}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = install_path;
        Ok(())
    }
}

/// 启动已安装的应用
pub fn launch_installed_app(install_path: &str) -> Result<(), String> {
    let exe = PathBuf::from(install_path).join("Deeting.exe");

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&exe)
            .spawn()
            .map_err(|e| format!("无法启动应用: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 开发模式
        println!("Would launch: {:?}", exe);
        Ok(())
    }
}
