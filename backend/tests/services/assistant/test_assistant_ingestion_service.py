from types import SimpleNamespace
from unittest.mock import AsyncMock
import uuid
import json

import pytest

from app.services.assistant.assistant_ingestion_service import AssistantIngestionService


class _FakeKnowledgeRepo:
    def __init__(self, artifact):
        self.artifact = artifact
        self.updated_payloads: list[dict] = []

    async def get(self, artifact_id: uuid.UUID):
        if self.artifact.id == artifact_id:
            return self.artifact
        return None

    async def update(self, _artifact, payload: dict):
        self.updated_payloads.append(payload)
        return self.artifact


class _FakeAssistantService:
    def __init__(self):
        self.created: list[dict] = []

    async def create_assistant(self, payload, owner_user_id):
        created = SimpleNamespace(id=uuid.uuid4())
        self.created.append(
            {
                "id": created.id,
                "payload": payload,
                "owner_user_id": owner_user_id,
            }
        )
        return created


@pytest.mark.asyncio
async def test_batch_refine_and_create_assistants_creates_multiple_records(monkeypatch):
    artifact = SimpleNamespace(id=uuid.uuid4(), raw_content="persona csv content")
    knowledge_repo = _FakeKnowledgeRepo(artifact)
    assistant_service = _FakeAssistantService()
    service = AssistantIngestionService(assistant_service, knowledge_repo)

    monkeypatch.setattr(service, "_resolve_refine_model", AsyncMock(return_value="gpt-test"))
    monkeypatch.setattr(
        service,
        "_extract_batch_assistant_data",
        AsyncMock(
            return_value=[
                {
                    "name": "Persona 1",
                    "summary": "s1",
                    "description": "d1",
                    "system_prompt": "p1",
                    "tags": ["a"],
                    "icon_id": "lucide:user",
                },
                {
                    "name": "Persona 2",
                    "summary": "s2",
                    "description": "d2",
                    "system_prompt": "p2",
                    "tags": ["b"],
                    "icon_id": "lucide:bot",
                },
            ]
        ),
    )

    result = await service.batch_refine_and_create_assistants(
        artifact.id,
        user_id=uuid.uuid4(),
        max_items=10,
    )

    assert result["status"] == "success"
    assert result["count"] == 2
    assert len(result["assistants"]) == 2
    assert len(assistant_service.created) == 2
    assert assistant_service.created[0]["payload"].version.name == "Persona 1"
    assert knowledge_repo.updated_payloads[-1] == {"status": "indexed"}


@pytest.mark.asyncio
async def test_batch_refine_and_create_assistants_respects_max_items(monkeypatch):
    artifact = SimpleNamespace(id=uuid.uuid4(), raw_content="persona csv content")
    knowledge_repo = _FakeKnowledgeRepo(artifact)
    assistant_service = _FakeAssistantService()
    service = AssistantIngestionService(assistant_service, knowledge_repo)

    monkeypatch.setattr(service, "_resolve_refine_model", AsyncMock(return_value="gpt-test"))
    monkeypatch.setattr(
        service,
        "_extract_batch_assistant_data",
        AsyncMock(
            return_value=[
                {"name": "A", "system_prompt": "p", "tags": []},
                {"name": "B", "system_prompt": "p", "tags": []},
                {"name": "C", "system_prompt": "p", "tags": []},
            ]
        ),
    )

    result = await service.batch_refine_and_create_assistants(
        artifact.id,
        user_id=uuid.uuid4(),
        max_items=2,
    )

    assert result["count"] == 2
    assert len(assistant_service.created) == 2


@pytest.mark.asyncio
async def test_refine_and_create_assistant_accepts_none_user_id(monkeypatch):
    artifact = SimpleNamespace(id=uuid.uuid4(), raw_content="single persona")
    knowledge_repo = _FakeKnowledgeRepo(artifact)
    assistant_service = _FakeAssistantService()
    service = AssistantIngestionService(assistant_service, knowledge_repo)

    monkeypatch.setattr(service, "_resolve_refine_model", AsyncMock(return_value="gpt-test"))
    monkeypatch.setattr(
        service,
        "_extract_assistant_data",
        AsyncMock(
            return_value={
                "name": "Single Persona",
                "summary": "summary",
                "description": "description",
                "system_prompt": "prompt",
                "tags": ["single"],
                "icon_id": "lucide:bot",
            }
        ),
    )

    result = await service.refine_and_create_assistant(artifact.id, user_id=None)

    assert result["status"] == "success"
    assert assistant_service.created[0]["owner_user_id"] is None
    assert knowledge_repo.updated_payloads[-1] == {"status": "indexed"}


@pytest.mark.asyncio
async def test_batch_refine_and_create_assistants_uses_csv_fast_path(monkeypatch):
    csv_content = (
        "```csv\n"
        "act,prompt\n"
        "\"Ethereum Developer\",\"Prompt A\"\n"
        "\"Linux Terminal\",\"Prompt B\"\n"
        "\"English Translator and Improver\",\"Prompt C\"\n"
        "```"
    )
    artifact = SimpleNamespace(id=uuid.uuid4(), raw_content=csv_content)
    knowledge_repo = _FakeKnowledgeRepo(artifact)
    assistant_service = _FakeAssistantService()
    service = AssistantIngestionService(assistant_service, knowledge_repo)

    monkeypatch.setattr(
        service,
        "_resolve_refine_model",
        AsyncMock(return_value="gpt-test"),
    )
    llm_splitter = AsyncMock(side_effect=AssertionError("LLM splitter should not be called"))
    monkeypatch.setattr(service, "_extract_batch_assistant_data", llm_splitter)

    result = await service.batch_refine_and_create_assistants(
        artifact.id,
        user_id=uuid.uuid4(),
        max_items=2,
    )

    assert result["status"] == "success"
    assert result["count"] == 2
    assert len(result["assistants"]) == 2
    assert assistant_service.created[0]["payload"].version.name == "Ethereum Developer"
    assert assistant_service.created[1]["payload"].version.system_prompt == "Prompt B"
    assert knowledge_repo.updated_payloads[-1] == {"status": "indexed"}


def test_extract_json_payload_supports_markdown_and_embedded_text():
    payload = {"name": "Persona", "system_prompt": "do X"}
    json_text = json.dumps(payload, ensure_ascii=False)
    wrapped = f"Some prefix\n```json\n{json_text}\n```\nSome suffix"

    parsed = AssistantIngestionService._extract_json_payload(wrapped)

    assert isinstance(parsed, dict)
    assert parsed["name"] == "Persona"
    assert parsed["system_prompt"] == "do X"


@pytest.mark.asyncio
async def test_chat_json_retries_when_first_response_invalid(monkeypatch):
    artifact = SimpleNamespace(id=uuid.uuid4(), raw_content="content")
    knowledge_repo = _FakeKnowledgeRepo(artifact)
    assistant_service = _FakeAssistantService()
    service = AssistantIngestionService(assistant_service, knowledge_repo)

    responses = iter(
        [
            '{"assistants":[{"name":"A","system_prompt":"x"}',  # invalid JSON
            '{"assistants":[{"name":"A","system_prompt":"x"}]}',  # repaired JSON
        ]
    )

    async def _fake_chat_completion(**_kwargs):
        return next(responses)

    monkeypatch.setattr(
        "app.services.assistant.assistant_ingestion_service.llm_service.chat_completion",
        _fake_chat_completion,
    )

    payload = await service._chat_json(
        "return json",
        user_id=None,
        model="gpt-test",
        max_tokens=256,
    )

    assert isinstance(payload, dict)
    assert payload["assistants"][0]["name"] == "A"
