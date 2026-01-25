from __future__ import annotations

from uuid import UUID

from app.repositories.assistant_tag_repository import AssistantTagRepository
from app.repositories.image_generation_share_tag_repository import (
    ImageGenerationShareTagLinkRepository,
)


class ImageGenerationShareTagService:
    def __init__(
        self,
        tag_repo: AssistantTagRepository,
        link_repo: ImageGenerationShareTagLinkRepository,
    ):
        self.tag_repo = tag_repo
        self.link_repo = link_repo

    def normalize_tags(self, tags: list[str] | None) -> list[str]:
        if not tags:
            return []
        cleaned: list[str] = []
        seen = set()
        for raw in tags:
            name = str(raw or "").strip()
            if not name:
                continue
            if not name.startswith("#"):
                name = f"#{name}"
            if name in seen:
                continue
            seen.add(name)
            cleaned.append(name)
        return cleaned

    async def sync_share_tags(self, share_id: UUID, tags: list[str] | None) -> list[str]:
        normalized = self.normalize_tags(tags)
        existing_tags = await self.tag_repo.get_by_names(normalized)
        existing_by_name = {tag.name: tag for tag in existing_tags}

        for name in normalized:
            if name in existing_by_name:
                continue
            tag = await self.tag_repo.create({"name": name})
            existing_by_name[name] = tag

        tag_ids = [existing_by_name[name].id for name in normalized if name in existing_by_name]
        links = await self.link_repo.list_for_share(share_id)
        current_ids = {link.tag_id for link in links}
        desired_ids = set(tag_ids)
        remove_ids = list(current_ids - desired_ids)
        add_ids = list(desired_ids - current_ids)
        await self.link_repo.delete_links(share_id, remove_ids)
        await self.link_repo.add_links(share_id, add_ids)
        return normalized

    async def list_tags_for_shares(self, share_ids: list[UUID]) -> dict[UUID, list[str]]:
        return await self.link_repo.list_tag_names_for_shares(share_ids)


__all__ = ["ImageGenerationShareTagService"]
