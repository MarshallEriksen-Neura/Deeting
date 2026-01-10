from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    应用配置
    """
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    # 基础配置
    PROJECT_NAME: str = "AI Higress Gateway"
    API_V1_STR: str = "/api/v1"

    # 数据库配置 (PostgreSQL)
    # 格式: postgresql+asyncpg://user:password@host:port/dbname
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_gateway"

    # 调试模式
    DEBUG: bool = False

    # 环境配置
    ENVIRONMENT: str = "development"  # development/production/test

    # Redis 配置 (用于缓存/限流)
    # 默认使用本地 Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_ENCODING: str = "utf-8"

    # Qdrant (向量数据库，可选)
    QDRANT_ENABLED: bool = False
    QDRANT_URL: str | None = None
    QDRANT_API_KEY: str | None = None
    QDRANT_TIMEOUT_SECONDS: float = 10.0
    QDRANT_KB_SYSTEM_COLLECTION: str = "kb_system"
    QDRANT_KB_USER_COLLECTION: str = "kb_user"
    QDRANT_KB_USER_SHARED_COLLECTION: str = "kb_shared_v1"
    QDRANT_KB_USER_COLLECTION_STRATEGY: str = "per_user"  # shared | per_user | sharded_by_model
    QDRANT_KB_USER_COLLECTION_SHARDS: int = 16
    KB_GLOBAL_EMBEDDING_LOGICAL_MODEL: str | None = None
    EMBEDDING_MODELS_REQUIRE_INPUT_TYPE: str = (
        "embed-english-v3,embed-multilingual-v3,cohere-embed,nemoretriever,"
        "nvidia/llama-3.2-nemoretriever"
    )

    # 限流默认值(可被 provider preset / API Key 覆盖)
    RATE_LIMIT_EXTERNAL_RPM: int = 60
    RATE_LIMIT_INTERNAL_RPM: int = 600
    RATE_LIMIT_EXTERNAL_TPM: int = 100000
    RATE_LIMIT_INTERNAL_TPM: int = 1000000
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # 缓存配置
    CACHE_PREFIX: str = "ai_gateway:"
    CACHE_DEFAULT_TTL: int = 300  # 默认缓存 5 分钟

    # 追踪与可观察性
    TRACE_ID_HEADER: str = "X-Trace-Id"

    # 风控与网关保护
    MAX_REQUEST_BYTES: int = 512 * 1024  # 单次请求体最大字节数(默认 512KB)
    MAX_RESPONSE_BYTES: int = 2 * 1024 * 1024  # 单次响应体最大字节数(默认 2MB)
    OUTBOUND_WHITELIST: list[str] = [
        "localhost", "127.0.0.1",
        "api.openai.com", "api.anthropic.com", "api.cohere.ai",
        "api.groq.com", "api.mistral.ai", "openrouter.ai",
        "dashscope.aliyuncs.com", "api.deepseek.com"
    ]  # 上游域名白名单,留空表示全部禁止
    GATEWAY_MAX_CONCURRENCY: int = 200  # 网关并发上限(每进程)
    GATEWAY_QUEUE_TIMEOUT: float = 0.25  # 排队等待获取并发槽的超时(秒)

    # 内部通道调试信息开关
    INTERNAL_CHANNEL_DEBUG_INFO: bool = True

    # 安全内容过滤
    SECURITY_SQL_INJECTION_DETECT: bool = True
    SECURITY_PROMPT_INJECTION_DETECT: bool = True
    SECURITY_DEBUG_HEADERS: list[str] = [
        "x-request-id", "cf-ray", "server", "x-envoy-upstream-service-time",
        "cf-cache-status"
    ]
    SECURITY_SENSITIVE_HEADERS: list[str] = [
        "authorization", "x-api-key", "cookie", "set-cookie",
        "x-request-id", "cf-ray", "server", "x-envoy-upstream-service-time",
        "x-openai-organization", "openai-organization", "cf-cache-status"
    ]
    SECURITY_SENSITIVE_BODY_FIELDS: list[str] = [
        "api_key", "password", "secret", "token", "system_fingerprint"
    ]

    # 上游熔断配置
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = 5  # 连续失败阈值
    CIRCUIT_BREAKER_RESET_SECONDS: int = 30  # 打开状态维持时间
    CIRCUIT_BREAKER_HALF_OPEN_SUCCESS: int = 2  # 半开状态需要的成功次数

    # 上游代理（兼容 legacy pool）
    UPSTREAM_PROXY_ENABLED: bool = False
    UPSTREAM_PROXY_FAILURE_COOLDOWN_SECONDS: int = 120
    UPSTREAM_PROXY_MAX_RETRIES: int = 1

    # 日志配置 (Loguru)
    LOG_LEVEL: str = "INFO"
    LOG_JSON_FORMAT: bool = False
    LOG_FILE_PATH: str = "logs/app.log"
    LOG_ROTATION: str = "500 MB"  # 日志文件大小轮转
    LOG_RETENTION: str = "10 days" # 日志保留时间

    # CORS 配置
    BACKEND_CORS_ORIGINS: list[str] = ["*"]

    # JWT 配置
    JWT_SECRET_KEY: str = ""  # 从 .env 读取,用于 HS256 备用
    JWT_ALGORITHM: str = "RS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_PRIVATE_KEY_PATH: str = "security/private.pem"
    JWT_PUBLIC_KEY_PATH: str = "security/public.pem"

    # 对象存储 / 短链配置
    SECRET_KEY: str = ""
    OSS_PROVIDER: str = "aliyun_oss"  # aliyun_oss | s3
    OSS_ENDPOINT: str = ""
    OSS_REGION: str = ""
    OSS_ACCESS_KEY_ID: str = ""
    OSS_ACCESS_KEY_SECRET: str = ""
    OSS_PUBLIC_BUCKET: str = "ai-gateway-public"
    OSS_PRIVATE_BUCKET: str = "ai-gateway-private"
    OSS_PUBLIC_BASE_URL: str = ""

    ASSET_STORAGE_MODE: str = "auto"  # auto | oss | local
    ASSET_LOCAL_DIR: str = "backend/media/assets"
    ASSET_OSS_PREFIX: str = "assets"
    ASSET_SIGNED_URL_TTL_SECONDS: int = 3600

    # 注册控制开关（开启后需有有效注册窗口才可自动注册）
    REGISTRATION_CONTROL_ENABLED: bool = False

    # LinuxDo OAuth 配置
    LINUXDO_OAUTH_ENABLED: bool = False
    LINUXDO_CLIENT_ID: str | None = None
    LINUXDO_CLIENT_SECRET: str | None = None
    LINUXDO_REDIRECT_URI: str | None = None
    LINUXDO_AUTHORIZE_ENDPOINT: str = "https://connect.linux.do/oauth2/authorize"
    LINUXDO_TOKEN_ENDPOINT: str = "https://connect.linux.do/oauth2/token"
    LINUXDO_USERINFO_ENDPOINT: str = "https://connect.linux.do/api/user"

    # 密码和安全配置
    PASSWORD_MIN_LENGTH: int = 8
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW: int = 600  # 秒
    VERIFICATION_CODE_TTL_SECONDS: int = 600
    VERIFICATION_CODE_MAX_ATTEMPTS: int = 3

    # Celery 配置
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"
    CELERY_TASK_DEFAULT_QUEUE: str = "default"
    CELERY_TIMEZONE: str = "UTC"

    # 会话上下文窗口 / 摘要配置
    CONVERSATION_ACTIVE_WINDOW_TOKENS_INTERNAL: int = 4096
    CONVERSATION_ACTIVE_WINDOW_TOKENS_EXTERNAL: int = 2048
    CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL: int = 12
    CONVERSATION_ACTIVE_WINDOW_TURNS_EXTERNAL: int = 8
    CONVERSATION_FLUSH_THRESHOLD_TOKENS: int = 6144
    CONVERSATION_WINDOW_OVERFLOW_RATIO: float = 1.2
    CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS: int = 120
    CONVERSATION_REDIS_TTL_SECONDS: int = 3600
    CONVERSATION_SUMMARIZER_PRESET_ID: str | None = None
    CONVERSATION_SUMMARY_MAX_TOKENS: int = 1024
    CONVERSATION_EMBEDDING_ENABLED: bool = False
    CONVERSATION_EMBEDDING_PRESET_ID: str | None = None

    # 路由亲和（前缀感知，用于命中上游 KV Cache）
    AFFINITY_ROUTING_ENABLED: bool = True
    AFFINITY_ROUTING_TTL_SECONDS: int = 300
    AFFINITY_ROUTING_BONUS: float = 0.2
    AFFINITY_ROUTING_PREFIX_RATIO: float = 0.7  # 取前缀比例做指纹
    AFFINITY_ROUTING_MAX_PREFIX_CHARS: int = 4000  # 指纹截断，防止超大请求
    AFFINITY_ROUTING_DISCOUNT_RATE: float = 0.5  # 用于估算节省（假定前缀缓存约 50% 复用）

    # Bridge / MCP (internal only)
    BRIDGE_GATEWAY_URL: str = "http://127.0.0.1:8088"
    BRIDGE_GATEWAY_INTERNAL_TOKEN: str = ""
    BRIDGE_GATEWAY_EVENTS_PATH: str = "/internal/bridge/events"
    BRIDGE_AGENT_TOKEN_EXPIRE_DAYS: int = 365
    BRIDGE_AGENT_TOKEN_ISS: str = "ai-higress"

    # 安全中间件配置
    ENABLE_SECURITY_MIDDLEWARE: bool = False  # 是否启用安全中间件栈
    ENABLE_API_DOCS: bool = True  # 是否启用API文档
    GATEWAY_MAX_CONCURRENT_REQUESTS: int = 100  # 网关最大并发请求数
    SECURITY_XSS_PROTECTION: bool = True  # XSS保护
    SECURITY_CONTENT_TYPE_OPTIONS: bool = True  # 防止MIME类型嗅探
    SECURITY_FRAME_OPTIONS: bool = True  # 防止点击劫持
    ENABLE_HSTS: bool = False  # 是否启用HSTS
    HSTS_MAX_AGE: int = 31536000  # HSTS最大有效期（秒）
    BAN_IP_ON_DETECTION: bool = False  # 检测到攻击时是否封禁IP
    BAN_TTL_SECONDS: int = 900  # 封禁IP的时长（秒）
    INSPECT_REQUEST_BODY: bool = False  # 是否检查请求体
    INSPECT_BODY_MAX_LENGTH: int | None = None  # 请求体检查的最大长度


settings = Settings()
