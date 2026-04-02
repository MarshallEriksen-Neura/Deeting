//! 共享轻量对话服务
//!
//! 提供平台无关的文本对话能力，供 IM 各平台和 Island 复用。
//! 底层调用 `execute_local_orchestrated_chat` 编排层。

pub mod commands;
pub mod service;
pub mod types;

pub use service::*;
pub use types::*;
