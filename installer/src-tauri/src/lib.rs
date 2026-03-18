mod installer;

use installer::{InstallConfig, InstallProgress};
use tauri::{AppHandle, Emitter, Manager};

/// 获取默认安装路径
#[tauri::command]
fn get_default_install_path() -> String {
    installer::default_install_path()
}

/// 获取磁盘可用空间 (MB)
#[tauri::command]
fn get_disk_free_space(path: String) -> u64 {
    installer::disk_free_space_mb(&path)
}

/// 检测是否已安装
#[tauri::command]
fn check_existing_install() -> Option<String> {
    installer::detect_existing_install()
}

/// 执行安装
#[tauri::command]
async fn start_install(app: AppHandle, config: InstallConfig) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<InstallProgress>(32);

    // 在后台线程执行安装
    let install_handle = tokio::spawn(async move {
        installer::run_install(config, tx).await
    });

    // 转发进度事件到前端
    while let Some(progress) = rx.recv().await {
        let _ = app.emit("install-progress", &progress);
    }

    install_handle
        .await
        .map_err(|e| format!("安装任务异常: {}", e))?
        .map_err(|e| format!("安装失败: {}", e))
}

/// 创建桌面快捷方式
#[tauri::command]
fn create_desktop_shortcut(install_path: String) -> Result<(), String> {
    installer::create_shortcut(&install_path, true)
}

/// 启动已安装的应用
#[tauri::command]
fn launch_app(install_path: String) -> Result<(), String> {
    installer::launch_installed_app(&install_path)
}

/// 退出安装程序
#[tauri::command]
fn quit_installer(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_default_install_path,
            get_disk_free_space,
            check_existing_install,
            start_install,
            create_desktop_shortcut,
            launch_app,
            quit_installer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running installer");
}
