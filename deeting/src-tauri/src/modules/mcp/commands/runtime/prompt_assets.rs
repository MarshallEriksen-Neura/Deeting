use crate::modules::mcp::types::LocalChatInputMessage;

#[derive(Debug, Clone, Default)]
pub(crate) struct PromptAssets {
    system_messages: Vec<LocalChatInputMessage>,
}

impl PromptAssets {
    pub(crate) fn from_system_messages(system_messages: &[LocalChatInputMessage]) -> Self {
        Self {
            system_messages: system_messages.to_vec(),
        }
    }

    pub(crate) fn system_messages(&self) -> &[LocalChatInputMessage] {
        &self.system_messages
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_assets_preserve_system_messages() {
        let assets = PromptAssets::from_system_messages(&[LocalChatInputMessage {
            role: "system".to_string(),
            content: "hello".to_string(),
        }]);

        assert_eq!(assets.system_messages().len(), 1);
        assert_eq!(assets.system_messages()[0].content, "hello");
    }
}