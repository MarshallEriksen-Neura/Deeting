import importlib.util
import json
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("provider_doc_ingestion_main", MODULE_PATH)
assert SPEC and SPEC.loader
provider_doc_ingestion_main = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider_doc_ingestion_main)


class _FakeDeeting:
    def __init__(self) -> None:
        self.calls = []

    def call_tool(self, tool_name, **kwargs):
        self.calls.append((tool_name, kwargs))
        url = kwargs.get("url", "")
        return {
            "status": "success",
            "url": url,
            "title": f"Fetched {url}",
            "content": f"Path: /api/v1/chat/completions from {url}",
            "markdown": f"Path: /api/v1/chat/completions from {url}",
        }


class _FakeDeetingWithFailure(_FakeDeeting):
    def call_tool(self, tool_name, **kwargs):
        url = kwargs.get("url", "")
        if "bad" in url:
            raise RuntimeError("fetch failed")
        return super().call_tool(tool_name, **kwargs)


class ProviderDocIngestionTests(unittest.IsolatedAsyncioTestCase):
    async def test_collect_provider_doc_evidence_calls_web_fetch_for_each_url(self):
        fake = _FakeDeeting()
        provider_doc_ingestion_main.deeting = fake

        result = await provider_doc_ingestion_main.collect_provider_doc_evidence(
            urls=[
                "https://docs.example.com/getting-started",
                "https://docs.example.com/chat-api",
            ],
            js_mode=True,
        )

        self.assertEqual("success", result["status"])
        self.assertEqual(2, len(result["documents"]))
        self.assertEqual(2, len(fake.calls))
        self.assertEqual("web.fetch", fake.calls[0][0])
        self.assertEqual(
            "https://docs.example.com/getting-started",
            result["documents"][0]["source_url"],
        )
        self.assertEqual([], result["fetch_errors"])
        self.assertIn("protocol_profile_template", result)
        self.assertIn("provider_registry_handoff_template", result)

    async def test_collect_provider_doc_evidence_reports_fetch_errors(self):
        fake = _FakeDeetingWithFailure()
        provider_doc_ingestion_main.deeting = fake

        result = await provider_doc_ingestion_main.collect_provider_doc_evidence(
            urls=[
                "https://docs.example.com/good",
                "https://docs.example.com/bad",
            ]
        )

        self.assertEqual("partial", result["status"])
        self.assertEqual(1, len(result["documents"]))
        self.assertEqual(1, len(result["fetch_errors"]))
        self.assertEqual(
            "https://docs.example.com/bad",
            result["fetch_errors"][0]["source_url"],
        )

    async def test_draft_provider_candidate_normalizes_chat_transport(self):
        report = {
            "provider_identity": {
                "provider": "volcengine_las",
                "product_name": "LAS",
                "doc_base_url": "https://www.volcengine.com/docs/6492",
            },
            "auth": {
                "auth_type": "api_key",
                "header_name": "Authorization",
                "header_scheme": "Bearer",
                "env_key_hint": "ARK_API_KEY",
            },
            "capabilities": {
                "chat": {
                    "base_url": "https://operator.las.cn-beijing.volces.com",
                    "transport": {
                        "method": "POST",
                        "path": "/api/v1/chat/completions",
                        "content_type": "application/json",
                    },
                    "request_fields": {
                        "required": ["model", "messages"],
                        "optional": ["thinking", "stream", "max_tokens"],
                    },
                }
            },
            "evidence": [
                {
                    "field": "chat.transport.path",
                    "value": "/api/v1/chat/completions",
                    "source_url": "https://www.volcengine.com/docs/6492/2192011",
                    "source_snippet": "Path: /api/v1/chat/completions",
                    "confidence": "high",
                    "explicit_or_inferred": "explicit",
                }
            ],
            "gaps": ["response_schema", "stream_event_schema"],
        }

        candidate = await provider_doc_ingestion_main.draft_provider_candidate(
            extraction_report=report
        )

        self.assertEqual("volcengine-las-chat", candidate["slug"])
        self.assertEqual("api_key", candidate["auth_type"])
        self.assertEqual(
            "https://operator.las.cn-beijing.volces.com",
            candidate["base_url"],
        )
        self.assertEqual(
            "api/v1/chat/completions",
            candidate["protocol_profiles"]["chat"]["transport"]["path"],
        )
        self.assertFalse(candidate["verification_ready"])
        self.assertIn("response_schema", candidate["verification_gaps"])
        self.assertEqual(
            "chat",
            candidate["provider_registry_handoff"]["get_unified_schema"]["capability"],
        )
        self.assertEqual(
            "https://operator.las.cn-beijing.volces.com",
            candidate["provider_registry_handoff"]["verify_provider_template"]["base_url"],
        )
        self.assertEqual(
            "api/v1/chat/completions",
            candidate["provider_registry_handoff"]["verify_provider_template"]["upstream_path"],
        )
        self.assertEqual(
            "api/v1/chat/completions",
            candidate["provider_registry_handoff"]["save_local_provider_preset"]["protocol_profiles"]["chat"]["transport"]["path"],
        )

    async def test_score_provider_candidate_readiness_reports_gaps(self):
        candidate = {
            "slug": "volcengine-las-chat",
            "name": "Volcengine LAS Chat",
            "provider": "volcengine_las",
            "base_url": "https://operator.las.cn-beijing.volces.com",
            "auth_type": "api_key",
            "protocol_profiles": {
                "chat": {
                    "protocol_family": "openai_chat",
                    "transport": {"path": "api/v1/chat/completions"},
                }
            },
            "verification_gaps": ["response_schema"],
            "verification_ready": False,
        }

        readiness = await provider_doc_ingestion_main.score_provider_candidate_readiness(
            candidate=candidate
        )

        self.assertTrue(readiness["evidence_ready"])
        self.assertTrue(readiness["candidate_ready"])
        self.assertFalse(readiness["verify_ready"])
        self.assertIn("response_schema", readiness["missing_fields"])

    async def test_build_provider_registry_handoff_returns_explicit_tool_payloads(self):
        candidate = {
            "slug": "openrouter-chat",
            "name": "OpenRouter Chat",
            "provider": "openrouter",
            "base_url": "https://openrouter.ai",
            "auth_type": "api_key",
            "protocol_profiles": {
                "chat": {
                    "runtime_version": "v2",
                    "schema_version": "2026-03-07",
                    "profile_id": "openrouter:chat:openai_chat",
                    "provider": "openrouter",
                    "protocol_family": "openai_chat",
                    "capability": "chat",
                    "transport": {
                        "method": "POST",
                        "path": "api/v1/chat/completions",
                        "query_template": {},
                        "header_template": {},
                        "content_type": "application/json",
                    },
                    "request": {
                        "template_engine": "openai_compat",
                        "request_template": {
                            "model": None,
                            "messages": None,
                            "stream": None,
                        },
                        "request_builder": None,
                    },
                    "response": {
                        "decoder": {"name": "openai_chat", "config": {}},
                        "response_template": {},
                        "output_mapping": {},
                    },
                    "stream": {
                        "stream_decoder": {
                            "name": "openai_chat_stream",
                            "config": {},
                        }
                    },
                    "defaults": {
                        "headers": {
                            "HTTP-Referer": "{{ input.http_referer }}",
                        },
                        "query": {},
                        "body": {},
                    },
                    "metadata": {
                        "request_fields": {
                            "required": ["model", "messages"],
                            "optional": ["stream"],
                        },
                        "async_config": {},
                    },
                }
            },
        }

        handoff = await provider_doc_ingestion_main.build_provider_registry_handoff(
            candidate=candidate
        )

        self.assertEqual("success", handoff["status"])
        self.assertEqual(
            "chat",
            handoff["handoff"]["get_unified_schema"]["capability"],
        )
        self.assertEqual(
            "https://openrouter.ai",
            handoff["handoff"]["verify_provider_template"]["base_url"],
        )
        self.assertEqual(
            "api/v1/chat/completions",
            handoff["handoff"]["save_local_provider_preset"]["protocol_profiles"]["chat"]["transport"]["path"],
        )

    async def test_handle_input_dispatches_candidate_tool(self):
        payload = json.dumps(
            {
                "method": "score_provider_candidate_readiness",
                "arguments": {
                    "candidate": {
                        "slug": "demo",
                        "name": "Demo",
                        "provider": "demo",
                        "base_url": "https://demo.example.com",
                        "auth_type": "api_key",
                        "protocol_profiles": {
                            "chat": {
                                "protocol_family": "openai_chat",
                                "transport": {"path": "v1/chat/completions"}
                            }
                        },
                        "verification_gaps": [],
                        "verification_ready": True,
                    }
                },
            }
        )

        result = await provider_doc_ingestion_main.dispatch(payload)

        self.assertEqual("success", result["status"])
        self.assertTrue(result["verify_ready"])

    async def test_handle_input_dispatches_handoff_tool(self):
        payload = json.dumps(
            {
                "method": "build_provider_registry_handoff",
                "arguments": {
                    "candidate": {
                        "slug": "demo",
                        "name": "Demo",
                        "provider": "demo",
                        "base_url": "https://demo.example.com",
                        "auth_type": "api_key",
                        "protocol_profiles": {
                            "chat": {
                                "runtime_version": "v2",
                                "schema_version": "2026-03-07",
                                "profile_id": "demo:chat:openai_chat",
                                "provider": "demo",
                                "protocol_family": "openai_chat",
                                "capability": "chat",
                                "transport": {
                                    "method": "POST",
                                    "path": "v1/chat/completions",
                                    "query_template": {},
                                    "header_template": {},
                                    "content_type": "application/json"
                                },
                                "request": {
                                    "template_engine": "openai_compat",
                                    "request_template": {
                                        "model": None,
                                        "messages": None
                                    },
                                    "request_builder": None
                                },
                                "response": {
                                    "decoder": {"name": "openai_chat", "config": {}},
                                    "response_template": {},
                                    "output_mapping": {}
                                },
                                "stream": {
                                    "stream_decoder": {
                                        "name": "openai_chat_stream",
                                        "config": {}
                                    }
                                },
                                "defaults": {
                                    "headers": {},
                                    "query": {},
                                    "body": {}
                                },
                                "metadata": {
                                    "request_fields": {
                                        "required": ["model", "messages"],
                                        "optional": []
                                    },
                                    "async_config": {}
                                }
                            }
                        }
                    }
                }
            }
        )

        result = await provider_doc_ingestion_main.dispatch(payload)

        self.assertEqual("success", result["status"])
        self.assertEqual(
            "v1/chat/completions",
            result["handoff"]["verify_provider_template"]["upstream_path"],
        )


if __name__ == "__main__":
    unittest.main()
