from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy import and_, or_
from datetime import datetime
import uuid
from sqlalchemy import func, text

from app.models.assistant import Assistant, AssistantVersion

from .base import BaseRepository


class AssistantRepository(BaseRepository[Assistant]):
    model = Assistant

    async def get_with_versions(self, assistant_id):
        result = await self.session.execute(
            select(Assistant)
            .options(selectinload(Assistant.versions))
            .where(Assistant.id == assistant_id)
        )
        return result.scalars().first()

    async def get_by_share_slug(self, share_slug: str) -> Assistant | None:
        result = await self.session.execute(
            select(Assistant).where(Assistant.share_slug == share_slug)
        )
        return result.scalars().first()

    async def list_paginated(
        self,
        size: int,
        cursor: str | None = None,
        visibility: str | None = None,
        status: str | None = None,
        owner_user_id=None,
    ) -> tuple[list[Assistant], str | None]:
        """
        基于 created_at/id 的游标分页，倒序（最新在前）。
        cursor 形如: \"<iso_created_at>|<uuid>\"
        """
        cursor_created_at: datetime | None = None
        cursor_id = None
        if cursor:
            try:
                created_part, id_part = cursor.split("|", 1)
                cursor_created_at = datetime.fromisoformat(created_part)
                cursor_id = uuid.UUID(id_part)
            except Exception:
                # 游标格式不合法，视为无游标
                cursor_created_at = None
                cursor_id = None

        stmt = select(Assistant)
        conditions = []
        if visibility:
            conditions.append(Assistant.visibility == visibility)
        if status:
            conditions.append(Assistant.status == status)
        if owner_user_id:
            conditions.append(Assistant.owner_user_id == owner_user_id)

        if cursor_created_at and cursor_id:
            conditions.append(
                or_(
                    Assistant.created_at < cursor_created_at,
                    and_(
                        Assistant.created_at == cursor_created_at,
                        Assistant.id < cursor_id,
                    ),
                )
            )

        if conditions:
            stmt = stmt.where(and_(*conditions))

        stmt = stmt.order_by(Assistant.created_at.desc(), Assistant.id.desc()).limit(
            size + 1
        )

        result = await self.session.execute(stmt)
        rows = list(result.scalars().all())

        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = f"{last.created_at.isoformat()}|{last.id}"
            rows = rows[:size]

        return rows, next_cursor

    async def search_public(
        self,
        query: str,
        size: int,
        cursor: str | None = None,
        tags: list[str] | None = None,
    ) -> tuple[list[Assistant], str | None]:
        """
        基于 Postgres 全文检索的游标分页。非 Postgres 回退到 ILIKE。
        next_cursor 格式: \"<rank>|<iso_created_at>|<uuid>\"
        """
        bind = self.session.get_bind()
        is_postgres = bind.dialect.name == "postgresql"

        cur_rank = None
        cur_created = None
        cur_id = None
        if cursor:
            try:
                rank_part, created_part, id_part = cursor.split("|", 2)
                cur_rank = float(rank_part)
                cur_created = datetime.fromisoformat(created_part)
                cur_id = uuid.UUID(id_part)
            except Exception:
                cur_rank = cur_created = cur_id = None

        av = AssistantVersion
        stmt = (
            select(Assistant, av, func.coalesce(text("0"), 0).label("rank"))
            .join(av, av.id == Assistant.current_version_id)
            .where(
                Assistant.visibility == "public",
                Assistant.status == "published",
            )
        )

        if tags:
            stmt = stmt.where(av.tags.contains(tags))

        if is_postgres and query:
            ts_query = func.websearch_to_tsquery("simple", query)
            rank_expr = func.ts_rank_cd(av.tsv, ts_query)
            stmt = (
                select(Assistant, av, rank_expr.label("rank"))
                .join(av, av.id == Assistant.current_version_id)
                .where(
                    Assistant.visibility == "public",
                    Assistant.status == "published",
                    rank_expr > 0,
                )
            )
            if tags:
                stmt = stmt.where(av.tags.contains(tags))

            if cur_rank is not None:
                stmt = stmt.where(
                    or_(
                        rank_expr < cur_rank,
                        and_(
                            rank_expr == cur_rank,
                            or_(
                                Assistant.created_at < cur_created,
                                and_(
                                    Assistant.created_at == cur_created,
                                    Assistant.id < cur_id,
                                ),
                            ),
                        ),
                    )
                )

            stmt = stmt.order_by(
                rank_expr.desc(),
                Assistant.created_at.desc(),
                Assistant.id.desc(),
            ).limit(size + 1)

            result = await self.session.execute(stmt)
            rows = result.all()
            assistants = [r[0] for r in rows]

            next_cursor = None
            if len(rows) > size:
                last_a, _, last_rank = rows[size - 1]
                next_cursor = f"{float(last_rank):.6f}|{last_a.created_at.isoformat()}|{last_a.id}"
                assistants = assistants[:size]
            return assistants, next_cursor

        # 非 Postgres 或空查询：回退 ILIKE 模糊
        ilike_pattern = f"%{query}%" if query else "%"
        stmt = stmt.where(
            or_(
                av.name.ilike(ilike_pattern),
                av.description.ilike(ilike_pattern),
                av.system_prompt.ilike(ilike_pattern),
            )
        )

        if cur_created and cur_id:
            stmt = stmt.where(
                or_(
                    Assistant.created_at < cur_created,
                    and_(
                        Assistant.created_at == cur_created,
                        Assistant.id < cur_id,
                    ),
                )
            )

        stmt = stmt.order_by(Assistant.created_at.desc(), Assistant.id.desc()).limit(
            size + 1
        )
        result = await self.session.execute(stmt)
        rows = result.scalars().all()
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = f"0|{last.created_at.isoformat()}|{last.id}"
            rows = rows[:size]
        return rows, next_cursor


class AssistantVersionRepository(BaseRepository[AssistantVersion]):
    model = AssistantVersion

    async def list_for_assistant(self, assistant_id):
        result = await self.session.execute(
            select(AssistantVersion).where(AssistantVersion.assistant_id == assistant_id)
        )
        return list(result.scalars().all())

    async def get_for_assistant(self, assistant_id, version_id):
        result = await self.session.execute(
            select(AssistantVersion).where(
                AssistantVersion.id == version_id,
                AssistantVersion.assistant_id == assistant_id,
            )
        )
        return result.scalars().first()

    async def get_by_semver(self, assistant_id, semver: str):
        result = await self.session.execute(
            select(AssistantVersion).where(
                AssistantVersion.assistant_id == assistant_id,
                AssistantVersion.version == semver,
            )
        )
        return result.scalars().first()
