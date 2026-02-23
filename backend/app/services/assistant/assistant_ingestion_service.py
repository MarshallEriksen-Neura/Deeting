import csv
import io
import json
import logging
import re
import sys
import uuid
from typing import Any

from app.core.config import settings
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories.knowledge_repository import KnowledgeRepository
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_service import AssistantService
from app.services.providers.llm import llm_service

logger = logging.getLogger(__name__)


class AssistantIngestionService:
    """
    Refines raw KnowledgeArtifacts into structured Assistants.
    The 'Kitchen' that turns 'Raw Meat' (Markdown) into 'Gourmet Dishes' (Assistants).
    """

    def __init__(
        self, assistant_service: AssistantService, knowledge_repo: KnowledgeRepository
    ):
        self.assistant_service = assistant_service
        self.knowledge_repo = knowledge_repo

    async def refine_and_create_assistant(
        self, artifact_id: uuid.UUID, user_id: uuid.UUID | None
    ) -> dict[str, Any]:
        """
        1. Fetch the raw artifact.
        2. Resolve preferred model (User Secretary > System Default).
        3. Use LLM to extract Assistant details.
        4. Create the Assistant in DB.
        5. Update Artifact status.
        """
        artifact = await self.knowledge_repo.get(artifact_id)
        if not artifact:
            raise ValueError(f"Artifact {artifact_id} not found")

        refine_model = await self._resolve_refine_model(user_id)
        logger.info(
            "Refining assistant using model: %s for user: %s",
            refine_model or "default",
            user_id,
        )

        refinement_data = await self._extract_assistant_data(
            artifact.raw_content,
            user_id=user_id,
            model=refine_model,
        )

        assistant = await self._create_assistant_from_refinement(
            refinement_data,
            user_id=user_id,
            refine_model=refine_model,
        )

        await self.knowledge_repo.update(artifact, {"status": "indexed"})

        return {
            "status": "success",
            "assistant_id": str(assistant.id),
            "name": refinement_data.get("name"),
        }

    async def batch_refine_and_create_assistants(
        self,
        artifact_id: uuid.UUID,
        user_id: uuid.UUID | None,
        max_items: int = 20,
    ) -> dict[str, Any]:
        """
        Batch refinement: split one artifact into multiple assistant records.
        """
        if max_items <= 0:
            raise ValueError("max_items must be greater than 0")

        artifact = await self.knowledge_repo.get(artifact_id)
        if not artifact:
            raise ValueError(f"Artifact {artifact_id} not found")

        refine_model = await self._resolve_refine_model(user_id)
        logger.info(
            "Batch refining assistant using model: %s for user: %s",
            refine_model or "default",
            user_id,
        )

        refinement_items = self._extract_assistants_from_csv(
            artifact.raw_content,
            max_items=max_items,
        )
        if refinement_items:
            logger.info(
                "Batch assistant CSV fast-path extracted %s items",
                len(refinement_items),
            )
        else:
            refinement_items = await self._extract_batch_assistant_data(
                artifact.raw_content,
                user_id=user_id,
                model=refine_model,
                max_items=max_items,
            )
        if not refinement_items:
            raise RuntimeError("No assistant candidates extracted from artifact")

        created: list[dict[str, str]] = []
        for index, refinement_data in enumerate(refinement_items[:max_items], start=1):
            fallback_name = f"Imported Assistant {index}"
            assistant = await self._create_assistant_from_refinement(
                refinement_data,
                user_id=user_id,
                refine_model=refine_model,
                fallback_name=fallback_name,
            )
            created.append(
                {
                    "assistant_id": str(assistant.id),
                    "name": (
                        str(refinement_data.get("name")).strip()
                        if refinement_data.get("name")
                        else fallback_name
                    ),
                }
            )

        await self.knowledge_repo.update(artifact, {"status": "indexed"})
        return {
            "status": "success",
            "count": len(created),
            "assistants": created,
        }

    async def _resolve_refine_model(self, user_id: uuid.UUID | None) -> str | None:
        if user_id is None:
            return getattr(settings, "INTERNAL_LLM_MODEL_ID", None)

        from app.core.database import AsyncSessionLocal
        from app.models.secretary import UserSecretary
        from sqlalchemy import select

        async with AsyncSessionLocal() as session:
            stmt = select(UserSecretary.model_name).where(UserSecretary.user_id == user_id)
            result = await session.execute(stmt)
            refine_model = result.scalar_one_or_none()

        return refine_model or getattr(settings, "INTERNAL_LLM_MODEL_ID", None)

    async def _create_assistant_from_refinement(
        self,
        refinement_data: dict[str, Any],
        *,
        user_id: uuid.UUID | None,
        refine_model: str | None,
        fallback_name: str = "New Assistant",
    ):
        payload = self._build_assistant_payload(
            refinement_data,
            refine_model=refine_model,
            fallback_name=fallback_name,
        )
        return await self.assistant_service.create_assistant(payload, owner_user_id=user_id)

    def _build_assistant_payload(
        self,
        refinement_data: dict[str, Any],
        *,
        refine_model: str | None,
        fallback_name: str,
    ) -> AssistantCreate:
        name = str(refinement_data.get("name") or fallback_name).strip() or fallback_name
        summary = str(refinement_data.get("summary") or "Automated Assistant").strip()
        description = str(refinement_data.get("description") or "").strip()
        system_prompt = str(
            refinement_data.get("system_prompt") or "You are a helpful AI assistant."
        ).strip()
        icon_id = str(refinement_data.get("icon_id") or "lucide:bot").strip()

        raw_tags = refinement_data.get("tags")
        tags: list[str] = []
        if isinstance(raw_tags, list):
            tags = [str(tag).strip() for tag in raw_tags if str(tag).strip()]

        return AssistantCreate(
            visibility=AssistantVisibility.PUBLIC,
            status=AssistantStatus.PUBLISHED,
            summary=summary[:200],
            icon_id=icon_id or "lucide:bot",
            version=AssistantVersionCreate(
                version="1.0.0",
                name=name[:100],
                description=description,
                system_prompt=system_prompt,
                tags=tags[:5],
                model_config={"model": refine_model or "gpt-4o", "temperature": 0.7},
            ),
        )

    async def _extract_assistant_data(
        self,
        markdown: str,
        user_id: uuid.UUID | None,
        model: str | None = None,
    ) -> dict[str, Any]:
        """
        The 'Refinery' logic using LLM.
        """
        prompt = f"""
        You are an AI Persona Architect. I will provide you with a Markdown document describing an AI character or a set of prompts.
        Your job is to refine this into a structured JSON for Deeting OS.

        Rules:
        1. **Name**: Short, professional name.
        2. **Summary**: Max 100 chars summary.
        3. **Description**: Detailed explanation of what this assistant does.
        4. **System Prompt**: The core instructions for the LLM. If the source has a prompt, preserve its essence but optimize it for clarity.
        5. **Tags**: Up to 5 relevant tags.
        6. **Icon ID**: A Lucide icon string (e.g. lucide:code, lucide:brain).

        Markdown Content:
        ---
        {markdown[:10000]}
        ---

        Return ONLY a JSON object:
        {{
            "name": "...",
            "summary": "...",
            "description": "...",
            "system_prompt": "...",
            "tags": ["tag1", "tag2"],
            "icon_id": "lucide:..."
        }}
        """

        try:
            payload = await self._chat_json(
                prompt,
                user_id=user_id,
                model=model,
                max_tokens=2048,
            )
            if not isinstance(payload, dict):
                raise RuntimeError("Assistant extraction must return a JSON object")
            return payload
        except Exception as e:
            logger.error(f"LLM Refinement failed: {e}")
            raise RuntimeError(f"Failed to refine assistant data: {e!s}")

    async def _extract_batch_assistant_data(
        self,
        markdown: str,
        user_id: uuid.UUID | None,
        model: str | None = None,
        max_items: int = 20,
    ) -> list[dict[str, Any]]:
        prompt = f"""
        You are an AI Persona Architect.
        The document may contain MANY assistant/persona prompts.
        Split the content into independent assistant objects.

        Rules:
        1. Return ONLY valid JSON.
        2. Return either:
           - a JSON array of assistant objects, OR
           - a JSON object with key "assistants" as array.
        3. Each object must include: name, summary, description, system_prompt, tags, icon_id.
        4. Keep at most {max_items} assistants.
        5. Keep each system_prompt complete and executable.

        Source Markdown:
        ---
        {markdown[:20000]}
        ---
        """

        payload = await self._chat_json(
            prompt,
            user_id=user_id,
            model=model,
            max_tokens=8192,
        )

        candidates: list[Any]
        if isinstance(payload, list):
            candidates = payload
        elif isinstance(payload, dict):
            assistants = payload.get("assistants")
            if isinstance(assistants, list):
                candidates = assistants
            else:
                candidates = [payload]
        else:
            raise RuntimeError("Batch assistant extraction must return JSON array/object")

        return [item for item in candidates if isinstance(item, dict)]

    def _extract_assistants_from_csv(
        self,
        raw_content: str,
        *,
        max_items: int,
    ) -> list[dict[str, Any]]:
        csv_text = self._extract_csv_text(raw_content)
        if not csv_text:
            return []

        try:
            csv.field_size_limit(sys.maxsize)
        except Exception:
            pass

        try:
            reader = csv.DictReader(io.StringIO(csv_text))
        except Exception as exc:
            logger.warning("CSV fast-path init failed: %s", exc)
            return []

        field_map: dict[str, str] = {}
        for field in reader.fieldnames or []:
            normalized = str(field).strip().strip('"').lower()
            field_map[normalized] = field
        act_col = field_map.get("act")
        prompt_col = field_map.get("prompt")
        if not act_col or not prompt_col:
            return []

        items: list[dict[str, Any]] = []
        for row_index, row in enumerate(reader, start=1):
            name = str((row.get(act_col) or "")).strip()
            prompt = str((row.get(prompt_col) or "")).strip()
            if not prompt:
                continue
            if not name:
                name = f"Imported Assistant {row_index}"

            items.append(
                {
                    "name": name,
                    "summary": f"Imported from CSV: {name}"[:100],
                    "description": f"Imported from CSV row {row_index}.",
                    "system_prompt": prompt,
                    "tags": ["csv-import"],
                    "icon_id": "lucide:bot",
                }
            )
            if len(items) >= max_items:
                break

        return items

    @staticmethod
    def _extract_csv_text(raw_content: str) -> str | None:
        if not raw_content:
            return None

        def _locate_header(text: str) -> str | None:
            normalized = text.lstrip("\ufeff").strip()
            lowered = normalized.lower()
            markers = ['"act","prompt"', "act,prompt"]
            positions = [lowered.find(marker) for marker in markers if lowered.find(marker) != -1]
            if not positions:
                return None
            return normalized[min(positions) :]

        blocks = re.findall(
            r"```(?:csv)?\s*([\s\S]*?)\s*```",
            raw_content,
            flags=re.IGNORECASE,
        )
        for block in blocks:
            candidate = _locate_header(block)
            if candidate:
                return candidate

        return _locate_header(raw_content)

    async def _chat_json(
        self,
        prompt: str,
        *,
        user_id: uuid.UUID | None,
        model: str | None,
        max_tokens: int = 4096,
    ) -> Any:
        response = await self._call_llm_text(
            prompt=prompt,
            user_id=user_id,
            model=model,
            max_tokens=max_tokens,
        )
        try:
            return self._extract_json_payload(response)
        except Exception as first_error:
            logger.warning(
                "Assistant ingestion JSON parse failed (first try): %s",
                first_error,
            )

        repair_response = await self._repair_json_response(
            invalid_response=response,
            user_id=user_id,
            model=model,
            max_tokens=min(max_tokens, 4096),
        )
        try:
            return self._extract_json_payload(repair_response)
        except Exception as repair_error:
            logger.warning(
                "Assistant ingestion JSON repair failed: %s",
                repair_error,
            )

        retry_prompt = (
            "The previous answer was not valid JSON. "
            "Return ONLY valid JSON (no markdown fence, no explanation).\n\n"
            f"Original instruction:\n{prompt}"
        )
        retry_response = await self._call_llm_text(
            prompt=retry_prompt,
            user_id=user_id,
            model=model,
            max_tokens=min(max(max_tokens * 2, 4096), 8192),
        )
        try:
            return self._extract_json_payload(retry_response)
        except Exception as retry_error:
            raise RuntimeError(
                f"Failed to parse JSON after retries: {retry_error}"
            ) from retry_error

    async def _call_llm_text(
        self,
        *,
        prompt: str,
        user_id: uuid.UUID | None,
        model: str | None,
        max_tokens: int,
    ) -> str:
        kwargs: dict[str, Any] = {
            "messages": [{"role": "user", "content": prompt}],
            "model": model,
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if user_id is not None:
            kwargs["user_id"] = str(user_id)

        response = await llm_service.chat_completion(**kwargs)
        if not isinstance(response, str):
            raise RuntimeError("LLM response is not a text payload")
        return response

    async def _repair_json_response(
        self,
        *,
        invalid_response: str,
        user_id: uuid.UUID | None,
        model: str | None,
        max_tokens: int,
    ) -> str:
        repair_prompt = (
            "Fix the following invalid JSON and return ONLY valid JSON. "
            "Do not add any explanation.\n\n"
            "Invalid JSON:\n"
            f"{invalid_response[:16000]}"
        )
        return await self._call_llm_text(
            prompt=repair_prompt,
            user_id=user_id,
            model=model,
            max_tokens=max_tokens,
        )

    @staticmethod
    def _extract_json_payload(raw_text: str) -> Any:
        cleaned = raw_text.strip()
        if not cleaned:
            raise ValueError("Empty LLM response")

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned).strip()
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                pass

        block_pattern = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
        for match in block_pattern.findall(raw_text):
            candidate = match.strip()
            if not candidate:
                continue
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

        for start_char, end_char in [("{", "}"), ("[", "]")]:
            start = cleaned.find(start_char)
            end = cleaned.rfind(end_char)
            if start == -1 or end == -1 or end <= start:
                continue
            candidate = cleaned[start : end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

        raise ValueError("Failed to extract valid JSON from LLM response")
