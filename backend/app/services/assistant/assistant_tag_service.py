from __future__ import annotations

from uuid import UUID

from app.repositories.assistant_tag_repository import AssistantTagLinkRepository, AssistantTagRepository


class AssistantTagService:
    def __init__(
        self,
        tag_repo: AssistantTagRepository,
        link_repo: AssistantTagLinkRepository,
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

    async def sync_assistant_tags(self, assistant_id: UUID, tags: list[str] | None) -> None:
        normalized = self.normalize_tags(tags)
        existing_tags = await self.tag_repo.get_by_names(normalized)
        existing_by_name = {tag.name: tag for tag in existing_tags}

        # 创建缺失标签
        for name in normalized:
            if name in existing_by_name:
                continue
            tag = await self.tag_repo.create({"name": name})
            existing_by_name[name] = tag

        tag_ids = [existing_by_name[name].id for name in normalized if name in existing_by_name]

        # 同步关系
        links = await self.link_repo.list_for_assistant(assistant_id)
        current_ids = {link.tag_id for link in links}
        desired_ids = set(tag_ids)
        remove_ids = list(current_ids - desired_ids)
        add_ids = list(desired_ids - current_ids)
        await self.link_repo.delete_links(assistant_id, remove_ids)
        await self.link_repo.add_links(assistant_id, add_ids)

    async def list_tags_for_assistants(self, assistant_ids: list[UUID]) -> dict[UUID, list[str]]:
        return await self.link_repo.list_tag_names_for_assistants(assistant_ids)
