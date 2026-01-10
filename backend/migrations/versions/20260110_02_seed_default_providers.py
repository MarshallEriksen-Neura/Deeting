"""seed default provider presets / instances / models

Revision ID: 20260110_02_seed_default_providers
Revises: 20260110_01_add_provider_preset_user_fields
Create Date: 2026-01-10 12:00:00
"""

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260110_02_seed_default_providers"
down_revision = "20260110_01_add_provider_preset_user_fields"
branch_labels = None
depends_on = None


provider_preset = sa.table(
    "provider_preset",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("name", sa.String),
    sa.column("slug", sa.String),
    sa.column("provider", sa.String),
    sa.column("base_url", sa.String),
    sa.column("auth_type", sa.String),
    sa.column("auth_config", postgresql.JSONB),
    sa.column("default_headers", postgresql.JSONB),
    sa.column("default_params", postgresql.JSONB),
    sa.column("is_active", sa.Boolean),
    sa.column("icon", sa.String),
    sa.column("theme_color", sa.String),
    sa.column("category", sa.String),
    sa.column("url_template", sa.String),
)


provider_instance = sa.table(
    "provider_instance",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("user_id", postgresql.UUID(as_uuid=True)),
    sa.column("preset_slug", sa.String),
    sa.column("name", sa.String),
    sa.column("description", sa.String),
    sa.column("base_url", sa.String),
    sa.column("icon", sa.String),
    sa.column("credentials_ref", sa.String),
    sa.column("channel", sa.String),
    sa.column("priority", sa.Integer),
    sa.column("is_enabled", sa.Boolean),
    sa.column("meta", postgresql.JSONB),
)


provider_model = sa.table(
    "provider_model",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("instance_id", postgresql.UUID(as_uuid=True)),
    sa.column("capability", sa.String),
    sa.column("model_id", sa.String),
    sa.column("unified_model_id", sa.String),
    sa.column("display_name", sa.String),
    sa.column("upstream_path", sa.String),
    sa.column("template_engine", sa.String),
    sa.column("request_template", postgresql.JSONB),
    sa.column("response_transform", postgresql.JSONB),
    sa.column("pricing_config", postgresql.JSONB),
    sa.column("limit_config", postgresql.JSONB),
    sa.column("tokenizer_config", postgresql.JSONB),
    sa.column("routing_config", postgresql.JSONB),
    sa.column("source", sa.String),
    sa.column("extra_meta", postgresql.JSONB),
    sa.column("weight", sa.Integer),
    sa.column("priority", sa.Integer),
    sa.column("is_active", sa.Boolean),
    sa.column("synced_at", sa.DateTime(timezone=True)),
)


def _upsert_preset(conn, payload: dict) -> uuid.UUID:
    existing = conn.execute(
        sa.select(provider_preset.c.id).where(provider_preset.c.slug == payload["slug"])
    ).scalar_one_or_none()
    if existing:
        return existing
    conn.execute(sa.insert(provider_preset).values(payload))
    return payload["id"]


def _upsert_instance(conn, payload: dict) -> uuid.UUID:
    existing = conn.execute(
        sa.select(provider_instance.c.id).where(
            provider_instance.c.preset_slug == payload["preset_slug"],
            provider_instance.c.user_id.is_(None),
            provider_instance.c.name == payload["name"],
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    conn.execute(sa.insert(provider_instance).values(payload))
    return payload["id"]


def _insert_model_if_absent(conn, payload: dict) -> None:
    exists = conn.execute(
        sa.select(provider_model.c.id).where(
            provider_model.c.instance_id == payload["instance_id"],
            provider_model.c.capability == payload["capability"],
            provider_model.c.model_id == payload["model_id"],
            provider_model.c.upstream_path == payload["upstream_path"],
        )
    ).scalar_one_or_none()
    if exists:
        return
    conn.execute(sa.insert(provider_model).values(payload))


def upgrade() -> None:
    conn = op.get_bind()

    presets = [
        {
            "id": uuid.uuid4(),
            "name": "Custom HTTP",
            "slug": "custom",
            "provider": "custom",
            "base_url": "http://localhost:11434/v1",
            "auth_type": "none",
            "auth_config": {},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:webhook",
            "theme_color": "#64748b",
            "category": "Custom",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "OpenAI",
            "slug": "openai",
            "provider": "openai",
            "base_url": "https://api.openai.com",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "OPENAI_API_KEY"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:openai",
            "theme_color": "#10a37f",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Anthropic",
            "slug": "anthropic",
            "provider": "anthropic",
            "base_url": "https://api.anthropic.com",
            "auth_type": "api_key",
            "auth_config": {"secret_ref_id": "ANTHROPIC_API_KEY", "header": "x-api-key"},
            "default_headers": {"anthropic-version": "2023-06-01", "Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:anthropic",
            "theme_color": "#d97757",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Google Gemini",
            "slug": "gemini",
            "provider": "google",
            "base_url": "https://generativelanguage.googleapis.com",
            "auth_type": "api_key",
            "auth_config": {"secret_ref_id": "GEMINI_API_KEY", "header": "x-goog-api-key"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:google",
            "theme_color": "#4285f4",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Vertex AI (Google Cloud)",
            "slug": "vertexai",
            "provider": "vertexai",
            "base_url": "https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "GOOGLE_APPLICATION_CREDENTIALS"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:googlecloud",
            "theme_color": "#4285f4",
            "category": "Cloud API",
            "url_template": "https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/",
        },
        {
            "id": uuid.uuid4(),
            "name": "Azure OpenAI",
            "slug": "azure",
            "provider": "azure",
            "base_url": "https://{resource}.openai.azure.com/",
            "auth_type": "api_key",
            "auth_config": {"secret_ref_id": "AZURE_OPENAI_API_KEY", "header": "api-key"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:azure",
            "theme_color": "#0ea5e9",
            "category": "Cloud API",
            "url_template": "https://{resource}.openai.azure.com/",
        },
        {
            "id": uuid.uuid4(),
            "name": "Moonshot (Kimi)",
            "slug": "kimi",
            "provider": "moonshot",
            "base_url": "https://api.moonshot.cn",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "KIMI_API_KEY"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:moon",
            "theme_color": "#000000",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "DeepSeek",
            "slug": "deepseek",
            "provider": "deepseek",
            "base_url": "https://api.deepseek.com",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "DEEPSEEK_API_KEY"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:fish-symbol",
            "theme_color": "#4e69e2",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Qwen (Aliyun)",
            "slug": "qwen",
            "provider": "qwen",
            "base_url": "https://dashscope.aliyuncs.com/api/v1",
            "auth_type": "api_key",
            "auth_config": {"secret_ref_id": "DASHSCOPE_API_KEY", "header": "Authorization", "prefix": "Bearer "},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "simple-icons:alibabacloud",
            "theme_color": "#615ced",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Baichuan",
            "slug": "baichuan",
            "provider": "baichuan",
            "base_url": "https://api.baichuan-ai.com",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "BAICHUAN_API_KEY"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:mountain",
            "theme_color": "#f97316",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "GLM (Zhipu)",
            "slug": "glm",
            "provider": "zhipu",
            "base_url": "https://open.bigmodel.cn",
            "auth_type": "bearer",
            "auth_config": {"secret_ref_id": "ZHIPU_API_KEY"},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:messages-square",
            "theme_color": "#3b82f6",
            "category": "Cloud API",
            "url_template": None,
        },
        {
            "id": uuid.uuid4(),
            "name": "Ollama",
            "slug": "ollama",
            "provider": "ollama",
            "base_url": "http://localhost:11434",
            "auth_type": "none",
            "auth_config": {},
            "default_headers": {"Content-Type": "application/json"},
            "default_params": {},
            "is_active": True,
            "icon": "lucide:terminal",
            "theme_color": "#111827",
            "category": "Local Hosted",
            "url_template": None,
        },
    ]

    preset_ids = {p["slug"]: _upsert_preset(conn, p) for p in presets}

    instances = [
        {
            "id": uuid.uuid4(),
            "user_id": None,
            "preset_slug": "openai",
            "name": "OpenAI Public",
            "description": "默认 OpenAI 通道，填写 OPENAI_API_KEY 后可用",
            "base_url": "https://api.openai.com",
            "icon": None,
            "credentials_ref": "OPENAI_API_KEY",
            "channel": "external",
            "priority": 0,
            "is_enabled": True,
            "meta": {},
        },
        {
            "id": uuid.uuid4(),
            "user_id": None,
            "preset_slug": "anthropic",
            "name": "Anthropic Public",
            "description": "默认 Claude 通道，填写 ANTHROPIC_API_KEY 后可用",
            "base_url": "https://api.anthropic.com",
            "icon": None,
            "credentials_ref": "ANTHROPIC_API_KEY",
            "channel": "external",
            "priority": 0,
            "is_enabled": True,
            "meta": {},
        },
        {
            "id": uuid.uuid4(),
            "user_id": None,
            "preset_slug": "gemini",
            "name": "Gemini Public",
            "description": "默认 Gemini 通道，填写 GEMINI_API_KEY 后可用",
            "base_url": "https://generativelanguage.googleapis.com",
            "icon": None,
            "credentials_ref": "GEMINI_API_KEY",
            "channel": "external",
            "priority": 0,
            "is_enabled": True,
            "meta": {},
        },
        {
            "id": uuid.uuid4(),
            "user_id": None,
            "preset_slug": "ollama",
            "name": "Ollama Local",
            "description": "本地 Ollama 通道，默认无需密钥",
            "base_url": "http://localhost:11434",
            "icon": None,
            "credentials_ref": "LOCAL_HOST",
            "channel": "external",
            "priority": 0,
            "is_enabled": True,
            "meta": {},
        },
    ]

    instance_ids = {i["preset_slug"]: _upsert_instance(conn, i) for i in instances}

    models = [
        # OpenAI
        {
            "id": uuid.uuid4(),
            "instance_id": instance_ids["openai"],
            "capability": "chat",
            "model_id": "gpt-4o",
            "unified_model_id": "gpt-4o",
            "display_name": "GPT-4o",
            "upstream_path": "/v1/chat/completions",
            "template_engine": "openai_compat",
            "request_template": {},
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "tokenizer_config": {},
            "routing_config": {},
            "source": "manual",
            "extra_meta": {},
            "weight": 100,
            "priority": 0,
            "is_active": True,
            "synced_at": None,
        },
        # Anthropic
        {
            "id": uuid.uuid4(),
            "instance_id": instance_ids["anthropic"],
            "capability": "chat",
            "model_id": "claude-3-5-sonnet-20241022",
            "unified_model_id": "claude-3-5-sonnet",
            "display_name": "Claude 3.5 Sonnet",
            "upstream_path": "/v1/messages",
            "template_engine": "anthropic_messages",
            "request_template": {},
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "tokenizer_config": {},
            "routing_config": {},
            "source": "manual",
            "extra_meta": {},
            "weight": 100,
            "priority": 0,
            "is_active": True,
            "synced_at": None,
        },
        # Gemini
        {
            "id": uuid.uuid4(),
            "instance_id": instance_ids["gemini"],
            "capability": "chat",
            "model_id": "gemini-1.5-flash",
            "unified_model_id": "gemini-1.5-flash",
            "display_name": "Gemini 1.5 Flash",
            "upstream_path": "/v1beta/models/gemini-1.5-flash:generateContent",
            "template_engine": "google_gemini",
            "request_template": {},
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "tokenizer_config": {},
            "routing_config": {},
            "source": "manual",
            "extra_meta": {},
            "weight": 100,
            "priority": 0,
            "is_active": True,
            "synced_at": None,
        },
        # Ollama (OpenAI 兼容接口)
        {
            "id": uuid.uuid4(),
            "instance_id": instance_ids["ollama"],
            "capability": "chat",
            "model_id": "llama3:latest",
            "unified_model_id": "llama3",
            "display_name": "Llama3 (Ollama)",
            "upstream_path": "/api/chat",
            "template_engine": "openai_compat",
            "request_template": {},
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "tokenizer_config": {},
            "routing_config": {},
            "source": "manual",
            "extra_meta": {},
            "weight": 100,
            "priority": 0,
            "is_active": True,
            "synced_at": None,
        },
    ]

    for model in models:
        _insert_model_if_absent(conn, model)


def downgrade() -> None:
    conn = op.get_bind()

    # 删除模型
    conn.execute(
        provider_model.delete().where(
            provider_model.c.model_id.in_(
                [
                    "gpt-4o",
                    "claude-3-5-sonnet-20241022",
                    "gemini-1.5-flash",
                    "llama3:latest",
                ]
            )
        )
    )

    # 删除实例（公共）
    conn.execute(
        provider_instance.delete().where(
            provider_instance.c.preset_slug.in_(
                ["openai", "anthropic", "gemini", "ollama"]
            ),
            provider_instance.c.user_id.is_(None),
        )
    )

    # 删除预设
    conn.execute(
        provider_preset.delete().where(
            provider_preset.c.slug.in_(
                ["custom", "openai", "anthropic", "gemini", "vertexai", "azure", "kimi", "deepseek", "qwen", "baichuan", "glm", "ollama"]
            )
        )
    )
