use super::config::ExecutionConfig;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct WorkingDirectoryPolicy {
    home_dir: PathBuf,
    forbidden_paths: Vec<String>,
}

impl WorkingDirectoryPolicy {
    pub fn new(home_dir: PathBuf, config: &ExecutionConfig) -> Self {
        Self {
            home_dir,
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

#[cfg(test)]
mod tests {
    use super::WorkingDirectoryPolicy;
    use crate::modules::execution::ExecutionConfig;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn allows_existing_directory_outside_old_home_allowlist() {
        let home_dir = std::env::temp_dir();
        let temp_dir = unique_test_dir("allowed");
        std::fs::create_dir_all(&temp_dir).expect("create temp directory");

        let policy = WorkingDirectoryPolicy::new(home_dir, &ExecutionConfig::default());
        let result = policy.validate(&temp_dir);

        std::fs::remove_dir_all(&temp_dir).expect("remove temp directory");
        assert!(
            result.is_ok(),
            "expected arbitrary working dir to be allowed"
        );
    }

    #[test]
    fn rejects_forbidden_directory() {
        let home_dir = if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester")
        } else {
            PathBuf::from("/home/tester")
        };
        let policy = WorkingDirectoryPolicy::new(home_dir, &ExecutionConfig::default());
        let forbidden = if cfg!(windows) {
            PathBuf::from(r"C:\Windows")
        } else {
            PathBuf::from("/etc")
        };

        let error = policy
            .validate(&forbidden)
            .expect_err("expected forbidden directory to be rejected");

        assert!(error.contains("is forbidden"));
    }

    fn unique_test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "deeting-working-dir-policy-{label}-{}-{nonce}",
            std::process::id()
        ))
    }
}
