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

        if query:
            bind = self.session.get_bind()
            is_postgres = bind and bind.dialect.name == "postgresql"
            tsv_col = getattr(av, "tsv", None)
            if is_postgres and tsv_col is not None:
                ts_query = func.websearch_to_tsquery("simple", query)
                stmt = stmt.where(tsv_col.op("@@")(ts_query))
            else:
                ilike_pattern = f"%{query}%"
                stmt = stmt.where(
                    or_(
                        av.name.ilike(ilike_pattern),
                        av.description.ilike(ilike_pattern),
                        av.system_prompt.ilike(ilike_pattern),
                    )
                )

        return stmt.order_by(Assistant.created_at.desc(), Assistant.id.desc())

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
