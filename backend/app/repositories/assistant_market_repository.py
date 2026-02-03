from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, and_, or_, func, case

from app.models.assistant import Assistant, AssistantStatus, AssistantVersion
from app.models.assistant_install import AssistantInstall
from app.models.assistant_tag import AssistantTag, AssistantTagLink
from app.models.review import ReviewTask, ReviewStatus


class AssistantMarketRepository:
    def __init__(self, session):
        self.session = session

    def build_market_query(
        self,
        *,
        user_id: UUID | None,
        entity_type: str,
        query: str | None = None,
        tags: list[str] | None = None,
    ):
        """
        市场助手列表查询（public + published + 审核通过或系统助手）。
        """
        if query:
            raise RuntimeError("search_backend_not_supported")
        av = AssistantVersion
        ai = AssistantInstall
        rt = ReviewTask

        stmt = (
            select(
                Assistant,
                av,
                ai.id.label("install_id"),
            )
            .join(av, av.id == Assistant.current_version_id)
            .outerjoin(
                ai,
                and_(
                    ai.assistant_id == Assistant.id,
                    ai.user_id == user_id,
                ),
            )
            .outerjoin(
                rt,
                and_(
                    rt.entity_type == entity_type,
                    rt.entity_id == Assistant.id,
                ),
            )
            .where(
                Assistant.visibility == "public",
                Assistant.status == "published",
                or_(
                    Assistant.owner_user_id.is_(None),
                    rt.status == ReviewStatus.APPROVED.value,
                ),
            )
        )

        if tags:
            subq = (
                select(AssistantTagLink.assistant_id)
                .join(AssistantTag, AssistantTag.id == AssistantTagLink.tag_id)
                .where(AssistantTag.name.in_(tags))
            )
            stmt = stmt.where(Assistant.id.in_(subq))

        return stmt.order_by(Assistant.created_at.desc(), Assistant.id.desc())

    async def fetch_market_rows_by_ids(
        self,
        *,
        assistant_ids: list[str | UUID],
        user_id: UUID | None,
        entity_type: str,
        tags: list[str] | None = None,
    ) -> list[tuple[Assistant, AssistantVersion, UUID | None]]:
        if not assistant_ids:
            return []
        normalized_ids = [str(raw_id) for raw_id in assistant_ids if raw_id]
        if not normalized_ids:
            return []
        uuid_ids: list[UUID] = []
        for raw_id in normalized_ids:
            try:
                uuid_ids.append(UUID(str(raw_id)))
            except Exception:
                continue
        if not uuid_ids:
            return []

        stmt = self.build_market_query(
            user_id=user_id,
            entity_type=entity_type,
            query=None,
            tags=tags,
        )
        stmt = stmt.where(Assistant.id.in_(uuid_ids))
        result = await self.session.execute(stmt)
        rows = result.all()
        row_map = {str(row[0].id): row for row in rows}
        return [row_map[item_id] for item_id in normalized_ids if item_id in row_map]

    def build_install_query(self, *, user_id: UUID, install_id: UUID | None = None):
        av = AssistantVersion
        ai = AssistantInstall
        version_id_expr = case(
            (ai.follow_latest.is_(True), Assistant.current_version_id),
            else_=func.coalesce(ai.pinned_version_id, Assistant.current_version_id),
        )
        stmt = (
            select(ai, Assistant, av)
            .join(Assistant, Assistant.id == ai.assistant_id)
            .join(av, av.id == version_id_expr)
            .where(ai.user_id == user_id)
            .where(Assistant.status != AssistantStatus.ARCHIVED)
            .order_by(ai.sort_order.desc(), ai.created_at.desc(), ai.id.desc())
        )
        if install_id:
            stmt = stmt.where(ai.id == install_id)
        return stmt
