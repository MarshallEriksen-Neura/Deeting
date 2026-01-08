from typing import Any

import httpx

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata


class ProviderProbePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.provider_probe",
            version="1.0.0",
            description="Probe AI providers to verify connectivity and schema compatibility.",
            author="Gemini CLI"
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "probe_provider",
                    "description": "Probe a provider to verify connectivity and field mapping.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "provider_type": {"type": "string", "enum": ["openai", "gemini"]},
                            "base_url": {"type": "string"},
                            "api_key": {"type": "string"},
                            "model": {"type": "string"},
                            "test_message": {"type": "string", "default": "Hello, this is a test."}
                        },
                        "required": ["provider_type", "base_url", "api_key", "model"]
                    }
                }
            }
        ]

    async def handle_probe_provider(self, provider_type: str, base_url: str, api_key: str, model: str, test_message: str = "Hello") -> str:
        # 1. Construct Unified Request (Standard Check)
        unified_req = {
            "capability": "chat",
            "model": model,
            "messages": [{"role": "user", "content": test_message}],
            "max_tokens": 100,
            "temperature": 0.7
        }

        # 2. Map to Provider Request
        provider_req = self._map_to_provider(provider_type, unified_req)

        # 3. Send Request
        headers = {
            "Content-Type": "application/json",
        }

        # Determine URL based on type
        url = base_url
        if provider_type == "openai":
            headers["Authorization"] = f"Bearer {api_key}"
            if not url.endswith("/chat/completions"):
                if url.endswith("/v1"):
                     url = f"{url}/chat/completions"
                else:
                     url = f"{url}/chat/completions"

        elif provider_type == "gemini":
            headers["x-goog-api-key"] = api_key
            url = f"{base_url}/models/{model}:generateContent"
        else:
            return f"Unsupported provider type: {provider_type}"

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=provider_req, headers=headers, timeout=30.0)

                try:
                    resp_data = resp.json()
                except Exception:
                    resp_data = resp.text

                status = "Success" if resp.status_code == 200 else f"Failed ({resp.status_code})"

                return (
                    f"Probe Result: {status}\n"
                    f"Mapped Request: {provider_req}\n"
                    f"Response: {resp_data}"
                )
        except Exception as e:
            return f"Error during probe: {e!s}"

    def _map_to_provider(self, provider_type: str, unified: dict[str, Any]) -> dict[str, Any]:
        if provider_type == "openai":
            # 1:1 mapping mostly
            return {
                "model": unified["model"],
                "messages": unified["messages"],
                "max_tokens": unified.get("max_tokens"),
                "temperature": unified.get("temperature")
            }
        elif provider_type == "gemini":
            # Map to Gemini API
            contents = []
            for msg in unified["messages"]:
                contents.append({
                    "role": "user" if msg["role"] == "user" else "model",
                    "parts": [{"text": msg["content"]}]
                })

            payload = {
                "contents": contents,
                "generationConfig": {}
            }
            if "max_tokens" in unified:
                payload["generationConfig"]["maxOutputTokens"] = unified["max_tokens"]
            if "temperature" in unified:
                payload["generationConfig"]["temperature"] = unified["temperature"]
            return payload
        return {}
