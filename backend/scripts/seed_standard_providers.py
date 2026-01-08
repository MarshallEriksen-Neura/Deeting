import asyncio
import uuid
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.provider_preset import ProviderPreset, ProviderPresetItem

async def seed_providers():
    async with AsyncSessionLocal() as session:
        # 1. OpenAI Standard
        openai_id = uuid.uuid4()
        openai_preset = ProviderPreset(
            id=openai_id,
            name="OpenAI Official",
            slug="openai-official",
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={"secret_ref_id": "OPENAI_API_KEY"},
            default_headers={"OpenAI-Organization": ""},
            is_active=True
        )
        
        # 2. Anthropic Standard
        anthropic_id = uuid.uuid4()
        anthropic_preset = ProviderPreset(
            id=anthropic_id,
            name="Anthropic Official",
            slug="anthropic-official",
            provider="anthropic",
            base_url="https://api.anthropic.com",
            auth_type="api_key",
            auth_config={"header": "x-api-key", "secret_ref_id": "ANTHROPIC_API_KEY"},
            default_headers={"anthropic-version": "2023-06-01"},
            is_active=True
        )

        # 3. Google Gemini (Using Jinja2 Template to demonstrate flexibility)
        google_id = uuid.uuid4()
        google_preset = ProviderPreset(
            id=google_id,
            name="Google Gemini Official",
            slug="google-official",
            provider="google",
            base_url="https://generativelanguage.googleapis.com",
            auth_type="api_key",
            auth_config={"header": "x-goog-api-key", "secret_ref_id": "GOOGLE_API_KEY"},
            is_active=True
        )

        session.add_all([openai_preset, anthropic_preset, google_preset])

        # --- Items (Models) ---
        
        # GPT-4o
        gpt4o = ProviderPresetItem(
            preset_id=openai_id,
            capability="chat",
            model="gpt-4o",
            unified_model_id="gpt-4o",
            upstream_path="/v1/chat/completions",
            template_engine="openai_compat",
            request_template={}, # OpenAI 格式无需模板，直接透传
            is_active=True
        )

        # Claude 3.5 Sonnet
        claude = ProviderPresetItem(
            preset_id=anthropic_id,
            capability="chat",
            model="claude-3-5-sonnet-20240620",
            unified_model_id="claude-3-5-sonnet",
            upstream_path="/v1/messages",
            template_engine="anthropic_messages",
            request_template={}, # 使用专用适配器
            is_active=True
        )

        # Gemini 1.5 Pro (Using the Powerful Jinja2 Template we just built!)
        # Agent 以后就会照着这个模板来生成其他怪异厂商的配置
        gemini_template = {
            "contents": [
                "{% for msg in messages %}",
                {
                    "role": "{{ 'user' if msg.role == 'user' else 'model' }}",
                    "parts": [{"text": "{{ msg.content }}"}]
                },
                "{% endfor %}"
            ],
            "generationConfig": {
                "temperature": "{{ temperature }}",
                "maxOutputTokens": "{{ max_tokens }}"
            }
        }

        gemini = ProviderPresetItem(
            preset_id=google_id,
            capability="chat",
            model="gemini-1.5-pro",
            unified_model_id="gemini-1.5-pro",
            upstream_path="/v1beta/models/gemini-1.5-pro:generateContent",
            template_engine="jinja2",
            request_template=gemini_template,
            is_active=True
        )

        session.add_all([gpt4o, claude, gemini])
        await session.commit()
        print("Standard Providers Seeded Successfully!")

if __name__ == "__main__":
    asyncio.run(seed_providers())
