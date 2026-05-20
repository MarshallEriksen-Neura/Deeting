import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("provider_registry_main", MODULE_PATH)
assert SPEC and SPEC.loader
provider_registry_main = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider_registry_main)


class _FakeDeeting:
    def __init__(self) -> None:
        self.calls = []

    def call_tool(self, tool_name, **kwargs):
        self.calls.append((tool_name, kwargs))
        return {"ok": True}


class SaveLocalProviderPresetTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_local_provider_preset_targets_local_upsert(self):
        fake = _FakeDeeting()
        provider_registry_main.deeting = fake

        result = await provider_registry_main.save_local_provider_preset(
            slug="volcengine-ark",
            name="Volcengine Ark",
            provider="volcengine",
            base_url="https://ark.cn-beijing.volces.com/api/v3",
        )

        self.assertEqual({"ok": True}, result)
        self.assertEqual(1, len(fake.calls))
        self.assertEqual("provider_preset.upsert", fake.calls[0][0])

    async def test_save_local_provider_preset_infers_chat_path_for_root_openai_host(self):
        fake = _FakeDeeting()
        provider_registry_main.deeting = fake

        await provider_registry_main.save_local_provider_preset(
            slug="openai-root",
            name="OpenAI Root",
            provider="openai",
            base_url="https://api.openai.com",
        )

        preset = fake.calls[0][1]["preset"]
        self.assertEqual("https://api.openai.com", preset["base_url"])
        self.assertEqual(
            "chat/completions",
            preset["protocol_profiles"]["chat"]["transport"]["path"],
        )

    async def test_save_local_provider_preset_splits_full_chat_endpoint(self):
        fake = _FakeDeeting()
        provider_registry_main.deeting = fake

        await provider_registry_main.save_local_provider_preset(
            slug="openai-endpoint",
            name="OpenAI Endpoint",
            provider="openai",
            base_url="https://api.openai.com/v1/chat/completions",
        )

        preset = fake.calls[0][1]["preset"]
        self.assertEqual("https://api.openai.com/v1", preset["base_url"])
        self.assertEqual(
            "chat/completions",
            preset["protocol_profiles"]["chat"]["transport"]["path"],
        )

    async def test_save_local_provider_preset_keeps_versioned_base_without_duplicating_v1(self):
        fake = _FakeDeeting()
        provider_registry_main.deeting = fake

        await provider_registry_main.save_local_provider_preset(
            slug="volcengine-ark",
            name="Volcengine Ark",
            provider="volcengine",
            base_url="https://ark.cn-beijing.volces.com/api/v3",
        )

        preset = fake.calls[0][1]["preset"]
        self.assertEqual("https://ark.cn-beijing.volces.com/api/v3", preset["base_url"])
        self.assertEqual(
            "chat/completions",
            preset["protocol_profiles"]["chat"]["transport"]["path"],
        )


if __name__ == "__main__":
    unittest.main()
