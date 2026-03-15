use crate::modules::im::types::*;
use crate::modules::im::feishu::FeishuClient;
use crate::modules::im::telegram::TelegramClient;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// IM Manager 配置
#[derive(Debug, Clone, Default)]
pub struct ImManagerConfig {
    pub clients: Vec<ImClientConfig>,
}

/// IM Manager 统一调度器
/// 
/// 负责管理多个 IM 平台的客户端，统一事件分发
pub struct ImManager {
    pub(crate) config: ImManagerConfig,
    clients: Arc<RwLock<HashMap<ImPlatform, Box<dyn ImClient>>>>,
    event_tx: mpsc::Sender<ImEvent>,
    event_rx: Arc<RwLock<Option<mpsc::Receiver<ImEvent>>>>,
    running: Arc<RwLock<bool>>,
}

impl ImManager {
    /// 创建新的 IM Manager
    pub fn new(config: ImManagerConfig) -> Self {
        let (event_tx, event_rx) = mpsc::channel(256);
        
        Self {
            config,
            clients: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            event_rx: Arc::new(RwLock::new(Some(event_rx))),
            running: Arc::new(RwLock::new(false)),
        }
    }
    
    /// 获取事件发送端（用于外部监听事件）
    pub fn event_sender(&self) -> mpsc::Sender<ImEvent> {
        self.event_tx.clone()
    }
    
    /// 获取事件接收端
    pub async fn take_event_receiver(&self) -> Option<mpsc::Receiver<ImEvent>> {
        let mut guard = self.event_rx.write().await;
        guard.take()
    }
    
    /// 初始化客户端
    pub async fn initialize(&self) -> Result<(), ImError> {
        let mut clients = self.clients.write().await;
        
        for client_config in &self.config.clients {
            if !client_config.enabled {
                debug!("平台 {} 已禁用，跳过初始化", client_config.platform);
                continue;
            }
            
            // 检查是否已存在
            if clients.contains_key(&client_config.platform) {
                debug!("平台 {} 已初始化，跳过", client_config.platform);
                continue;
            }
            
            // 创建客户端
            let client: Box<dyn ImClient> = match client_config.platform {
                ImPlatform::Feishu => {
                    match client_config.mode {
                        ConnectionMode::WebSocket => {
                            info!("初始化飞书 WebSocket 客户端");
                            Box::new(FeishuClient::from_config(&client_config.platform_config)?)
                        }
                        _ => {
                            warn!("飞书仅支持 WebSocket 模式");
                            continue;
                        }
                    }
                }
                ImPlatform::Telegram => {
                    match client_config.mode {
                        ConnectionMode::LongPolling => {
                            info!("初始化 Telegram 轮询客户端");
                            Box::new(TelegramClient::from_config(&client_config.platform_config)?)
                        }
                        _ => {
                            warn!("Telegram 仅支持 LongPolling 模式");
                            continue;
                        }
                    }
                }
                ImPlatform::Wechat | ImPlatform::Dingtalk => {
                    // 这些平台需要 Webhook 模式，暂不支持
                    warn!("平台 {} 需要中转服务，暂不支持直连模式", client_config.platform);
                    continue;
                }
                ImPlatform::QQ => {
                    warn!("QQ 平台暂未实现");
                    continue;
                }
            };
            
            clients.insert(client_config.platform, client);
        }
        
        Ok(())
    }
    
    /// 启动所有客户端
    pub async fn start(&self) -> Result<(), ImError> {
        let mut running = self.running.write().await;
        if *running {
            return Err(ImError::Other("Manager 已在运行".to_string()));
        }
        
        // 初始化客户端
        self.initialize().await?;
        
        *running = true;
        
        // 启动所有客户端
        let clients = self.clients.read().await;
        for (platform, client) in clients.iter() {
            let event_tx = self.event_tx.clone();
            if let Err(e) = client.start(event_tx).await {
                error!("启动 {} 客户端失败: {}", platform, e);
            }
        }
        
        info!("IM Manager 已启动，共 {} 个客户端", clients.len());
        
        Ok(())
    }
    
    /// 停止所有客户端
    pub async fn stop(&self) -> Result<(), ImError> {
        let mut running = self.running.write().await;
        if !*running {
            return Ok(());
        }
        
        info!("停止 IM Manager");
        
        let clients = self.clients.read().await;
        for (platform, client) in clients.iter() {
            if let Err(e) = client.stop().await {
                warn!("停止 {} 客户端失败: {}", platform, e);
            }
        }
        
        *running = false;
        
        Ok(())
    }
    
    /// 发送消息
    pub async fn send_message(
        &self,
        platform: ImPlatform,
        request: SendMessageRequest,
    ) -> Result<SendMessageResponse, ImError> {
        let clients = self.clients.read().await;
        let client = clients.get(&platform)
            .ok_or_else(|| ImError::Other(format!("平台 {} 未初始化", platform)))?;
        
        client.send_message(request).await
    }
    
    /// 回复卡片动作
    pub async fn reply_card_action(
        &self,
        platform: ImPlatform,
        message_id: &str,
        response: CardActionResponse,
    ) -> Result<(), ImError> {
        let clients = self.clients.read().await;
        let client = clients.get(&platform)
            .ok_or_else(|| ImError::Other(format!("平台 {} 未初始化", platform)))?;
        
        client.reply_card_action(message_id, response).await
    }
    
    /// 获取平台连接状态
    pub async fn get_status(&self, platform: ImPlatform) -> ConnectionStatus {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(&platform) {
            client.status()
        } else {
            ConnectionStatus::Disconnected
        }
    }
    
    /// 获取所有平台状态
    pub async fn get_all_status(&self) -> HashMap<ImPlatform, ConnectionStatus> {
        let clients = self.clients.read().await;
        clients.iter()
            .map(|(platform, client)| (*platform, client.status()))
            .collect()
    }
    
    /// 添加客户端
    pub async fn add_client(&self, config: ImClientConfig) -> Result<(), ImError> {
        if !config.enabled {
            return Ok(());
        }
        
        let client: Box<dyn ImClient> = match config.platform {
            ImPlatform::Feishu => {
                if config.mode != ConnectionMode::WebSocket {
                    return Err(ImError::ConfigError("飞书仅支持 WebSocket 模式".to_string()));
                }
                Box::new(FeishuClient::from_config(&config.platform_config)?)
            }
            ImPlatform::Telegram => {
                if config.mode != ConnectionMode::LongPolling {
                    return Err(ImError::ConfigError("Telegram 仅支持 LongPolling 模式".to_string()));
                }
                Box::new(TelegramClient::from_config(&config.platform_config)?)
            }
            _ => {
                return Err(ImError::NotImplemented);
            }
        };
        
        let platform = config.platform;
        {
            let mut clients = self.clients.write().await;
            clients.insert(platform, client);
        }

        // 如果 manager 已在运行，启动新客户端
        let running = self.running.read().await;
        if *running {
            let event_tx = self.event_tx.clone();
            let clients = self.clients.read().await;
            if let Some(client) = clients.get(&platform) {
                if let Err(e) = client.start(event_tx).await {
                    error!("启动 {} 客户端失败: {}", platform, e);
                }
            }
        }
        
        Ok(())
    }
    
    /// 移除客户端
    pub async fn remove_client(&self, platform: ImPlatform) -> Result<(), ImError> {
        let mut clients = self.clients.write().await;
        
        if let Some(client) = clients.remove(&platform) {
            client.stop().await?;
            info!("已移除 {} 客户端", platform);
        }
        
        Ok(())
    }
}

/// IM Manager Builder
pub struct ImManagerBuilder {
    config: ImManagerConfig,
}

impl ImManagerBuilder {
    pub fn new() -> Self {
        Self {
            config: ImManagerConfig::default(),
        }
    }
    
    /// 添加飞书客户端
    pub fn with_feishu(mut self, app_id: String, app_secret: String) -> Self {
        self.config.clients.push(ImClientConfig {
            platform: ImPlatform::Feishu,
            enabled: true,
            mode: ConnectionMode::WebSocket,
            platform_config: {
                let mut config = HashMap::new();
                config.insert("app_id".to_string(), serde_json::json!(app_id));
                config.insert("app_secret".to_string(), serde_json::json!(app_secret));
                config
            },
        });
        self
    }
    
    /// 添加 Telegram 客户端
    pub fn with_telegram(mut self, bot_token: String) -> Self {
        self.config.clients.push(ImClientConfig {
            platform: ImPlatform::Telegram,
            enabled: true,
            mode: ConnectionMode::LongPolling,
            platform_config: {
                let mut config = HashMap::new();
                config.insert("bot_token".to_string(), serde_json::json!(bot_token));
                config
            },
        });
        self
    }
    
    /// 构建 Manager
    pub fn build(self) -> ImManager {
        ImManager::new(self.config)
    }
}

impl Default for ImManagerBuilder {
    fn default() -> Self {
        Self::new()
    }
}
