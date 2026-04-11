pub mod backend_host;
pub mod boxlite_sidecar_client;
pub mod commands;
pub mod error;
pub mod installer;
pub mod manager;
pub mod provider;
pub mod provisioner;
pub mod types;

#[cfg(target_os = "windows")]
pub mod backend_wsl;

use std::path::PathBuf;
use std::sync::Arc;

use crate::modules::sandbox::manager::{SandboxManagerOptions, SandboxRuntimeManager};

#[derive(Clone)]
pub struct SandboxState {
    pub manager: Arc<SandboxRuntimeManager>,
}

impl SandboxState {
    pub fn new(home_dir: PathBuf) -> Self {
        let options = SandboxManagerOptions::from_home_dir(home_dir);
        let manager = SandboxRuntimeManager::new(options);
        Self {
            manager: Arc::new(manager),
        }
    }
}
