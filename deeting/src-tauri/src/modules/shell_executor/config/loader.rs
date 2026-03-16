//! 配置加载器

use super::ShellExecutorConfig;
use std::path::Path;

/// 配置加载器
pub struct ShellExecutorConfigLoader;

impl ShellExecutorConfigLoader {
    /// 从文件加载配置
    pub fn load_from_file(path: &Path) -> Result<ShellExecutorConfig, String> {
        if !path.exists() {
            return Ok(ShellExecutorConfig::default());
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        let config: ShellExecutorConfig =
            toml::from_str(&content).map_err(|e| format!("Failed to parse config file: {}", e))?;

        Ok(config)
    }

    /// 保存配置到文件
    pub fn save_to_file(config: &ShellExecutorConfig, path: &Path) -> Result<(), String> {
        // 确保目录存在
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let content = toml::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

        Ok(())
    }

    /// 从默认位置加载配置
    pub fn load_default() -> Result<ShellExecutorConfig, String> {
        let config_path = Self::get_default_config_path()?;
        Self::load_from_file(&config_path)
    }

    /// 获取默认配置文件路径
    pub fn get_default_config_path() -> Result<std::path::PathBuf, String> {
        let config_dir = dirs::config_local_dir().ok_or("Failed to get config directory")?;

        Ok(config_dir.join("deeting").join("shell_executor.toml"))
    }
}
