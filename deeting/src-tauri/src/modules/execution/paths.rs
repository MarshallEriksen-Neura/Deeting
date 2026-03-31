use super::config::ExecutionConfig;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct WorkingDirectoryPolicy {
    home_dir: PathBuf,
    allowed_paths: Vec<String>,
    forbidden_paths: Vec<String>,
}

impl WorkingDirectoryPolicy {
    pub fn new(home_dir: PathBuf, config: &ExecutionConfig) -> Self {
        Self {
            home_dir,
            allowed_paths: config.allowed_paths.clone(),
            forbidden_paths: config.forbidden_paths.clone(),
        }
    }

    pub fn validate(&self, path: &Path) -> Result<(), String> {
        let canonical_path = path
            .canonicalize()
            .map_err(|err| format!("Invalid path: {err}"))?;

        for forbidden in &self.forbidden_paths {
            let forbidden_path = self.expand_path(forbidden);
            if let Ok(forbidden_canonical) = forbidden_path.canonicalize() {
                if canonical_path.starts_with(&forbidden_canonical) {
                    return Err(format!("Path '{}' is forbidden", canonical_path.display()));
                }
            }
        }

        let is_allowed = self.allowed_paths.iter().any(|allowed| {
            let allowed_path = self.expand_path(allowed);
            allowed_path
                .canonicalize()
                .map(|candidate| canonical_path.starts_with(candidate))
                .unwrap_or(false)
        });

        if !is_allowed {
            return Err(format!(
                "Path '{}' is not in allowed paths",
                canonical_path.display()
            ));
        }

        Ok(())
    }

    fn expand_path(&self, value: &str) -> PathBuf {
        let home = self.home_dir.to_string_lossy().to_string();
        let mut expanded = value
            .replace("$HOME", &home)
            .replace("~", &home)
            .replace("%USERPROFILE%", &home);

        if let Some(app_data) = dirs::data_local_dir() {
            expanded = expanded.replace("$APP_DATA", &app_data.to_string_lossy());
        }

        PathBuf::from(expanded)
    }
}
