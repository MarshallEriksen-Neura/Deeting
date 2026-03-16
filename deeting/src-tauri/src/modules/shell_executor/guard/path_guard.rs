//! 路径限制保护

use crate::modules::shell_executor::config::PathRestrictionsConfig;
use std::path::PathBuf;

/// 路径保护器
pub struct PathGuard {
    home_dir: PathBuf,
    allowed_paths: Vec<String>,
    forbidden_paths: Vec<String>,
}

impl PathGuard {
    pub fn new(home_dir: PathBuf, config: PathRestrictionsConfig) -> Self {
        Self {
            home_dir,
            allowed_paths: config.allowed_paths,
            forbidden_paths: config.forbidden_paths,
        }
    }

    /// 验证路径是否允许访问
    pub fn validate(&self, path: &PathBuf) -> Result<(), String> {
        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?;

        // 1. 检查禁止路径
        for forbidden in &self.forbidden_paths {
            let forbidden_path = self.expand_path(forbidden);
            if let Ok(forbidden_canonical) = forbidden_path.canonicalize() {
                if canonical_path.starts_with(&forbidden_canonical) {
                    return Err(format!("Path '{}' is forbidden", canonical_path.display()));
                }
            }
        }

        // 2. 检查允许路径
        let is_allowed = self.allowed_paths.iter().any(|allowed| {
            let allowed_path = self.expand_path(allowed);
            if let Ok(allowed_canonical) = allowed_path.canonicalize() {
                canonical_path.starts_with(&allowed_canonical)
            } else {
                false
            }
        });

        if !is_allowed {
            return Err(format!(
                "Path '{}' is not in allowed paths",
                canonical_path.display()
            ));
        }

        Ok(())
    }

    /// 展开路径中的环境变量
    fn expand_path(&self, path: &str) -> PathBuf {
        let expanded = path
            .replace("$HOME", &self.home_dir.to_string_lossy().to_string())
            .replace("$HOME", &self.home_dir.to_string_lossy().to_string())
            .replace("~", &self.home_dir.to_string_lossy().to_string());

        // Windows: %USERPROFILE%
        #[cfg(target_os = "windows")]
        let expanded = expanded.replace(
            "%USERPROFILE%",
            &self.home_dir.to_string_lossy().to_string(),
        );

        // 应用数据目录
        if let Some(app_data) = dirs::data_local_dir() {
            let expanded = expanded.replace("$APP_DATA", &app_data.to_string_lossy().to_string());
            PathBuf::from(expanded)
        } else {
            PathBuf::from(expanded)
        }
    }
}
