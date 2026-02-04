import json
import logging
import uuid
from typing import Any

from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories.knowledge_repository import KnowledgeRepository
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_service import AssistantService
from app.services.providers.llm import llm_service
from app.tasks.assistant import sync_assistant_to_qdrant

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
        self, artifact_id: uuid.UUID
    ) -> dict[str, Any]:
        """
        1. Fetch the raw artifact.
        2. Use LLM to extract Assistant details.
        3. Create the Assistant in DB.
        4. Trigger Qdrant sync.
        """
        artifact = await self.knowledge_repo.get(artifact_id)
        if not artifact:
            raise ValueError(f"Artifact {artifact_id} not found")

        # 1. LLM Extraction
        refinement_data = await self._extract_assistant_data(artifact.raw_content)

        # 2. Prepare Payload
        # We create a 'System' assistant (owner_user_id=None)
        payload = AssistantCreate(
            visibility=AssistantVisibility.PUBLIC,
            status=AssistantStatus.PUBLISHED,
            summary=refinement_data.get("summary", "Automated Assistant"),
            icon_id=refinement_data.get("icon_id", "lucide:bot"),
            version=AssistantVersionCreate(
                version="1.0.0",
                name=refinement_data.get("name", "New Assistant"),
                description=refinement_data.get("description", ""),
                system_prompt=refinement_data.get("system_prompt", ""),
                tags=refinement_data.get("tags", []),
                model_config={"model": "gpt-4o", "temperature": 0.7},
            ),
        )

        # 3. Create in DB (Bypassing review because it's system-level)
        assistant = await self.assistant_service.create_assistant(
            payload, owner_user_id=None
        )

        # 4. CRITICAL: Trigger Qdrant Sync (The missing link!)
        sync_assistant_to_qdrant.delay(str(assistant.id))

        # 5. Update Artifact Status
        await self.knowledge_repo.update(artifact, {"status": "indexed"})

        return {
            "status": "success",
            "assistant_id": str(assistant.id),
            "name": refinement_data.get("name"),
        }

    async def _extract_assistant_data(self, markdown: str) -> dict[str, Any]:
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
        {markdown[:10000]} # Truncate if too long
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
            # Note: Using the internal llm_service which already handles API Keys/BaseURLs from config
            response = await llm_service.chat_completion(
                messages=[{"role": "user", "content": prompt}], temperature=0.1
            )

            # Basic cleanup of LLM response
            text = response.strip()
            if text.startswith("```json"):
                text = text.replace("```json", "").replace("```", "").strip()

            return json.loads(text)
        except Exception as e:
            logger.error(f"LLM Refinement failed: {e}")
            raise RuntimeError(f"Failed to refine assistant data: {e!s}")
