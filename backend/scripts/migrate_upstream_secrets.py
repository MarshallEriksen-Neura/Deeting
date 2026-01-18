import argparse
import asyncio
import logging
import os
import sys
import uuid
from dataclasses import dataclass

# 将 backend 目录添加到 sys.path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.provider_instance import ProviderCredential, ProviderInstance
from app.models.provider_preset import ProviderPreset
from app.services.secrets.manager import SecretManager


@dataclass
class MigrationStats:
    credential_total: int = 0
    credential_migrated: int = 0
    credential_skipped: int = 0
    credential_failed: int = 0
    instance_total: int = 0
    instance_migrated: int = 0
    instance_skipped: int = 0
    instance_failed: int = 0


def _mask_value(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 6:
        return value[:1] + "***"
    return f"{value[:3]}***{value[-2:]}"


def _parse_uuid_list(raw_list: list[str], label: str) -> set[uuid.UUID]:
    result: set[uuid.UUID] = set()
    for raw in raw_list:
        try:
            result.add(uuid.UUID(str(raw)))
        except Exception as exc:
            raise ValueError(f"{label} invalid uuid: {raw}") from exc
    return result


def _resolve_env_secret(secret_ref_id: str, provider: str | None) -> tuple[str | None, str | None]:
    direct = os.getenv(secret_ref_id)
    if direct:
        return direct, f"env:{secret_ref_id}"
    if provider:
        env_key = f"UPSTREAM_{provider.upper()}_SECRET"
        fallback = os.getenv(env_key)
        if fallback:
            return fallback, f"env:{env_key}"
    return None, None


async def _load_instances(session, instance_filter: set[uuid.UUID], preset_filter: set[str]) -> list[ProviderInstance]:
    stmt = select(ProviderInstance)
    if instance_filter:
        stmt = stmt.where(ProviderInstance.id.in_(instance_filter))
    if preset_filter:
        stmt = stmt.where(ProviderInstance.preset_slug.in_(preset_filter))
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def _load_credentials(session, instance_filter: set[uuid.UUID]) -> list[ProviderCredential]:
    stmt = select(ProviderCredential)
    if instance_filter:
        stmt = stmt.where(ProviderCredential.instance_id.in_(instance_filter))
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def migrate_secrets(
    *,
    apply: bool,
    allow_env: bool,
    instance_filter: set[uuid.UUID],
    preset_filter: set[str],
) -> MigrationStats:
    logger = logging.getLogger("migrate_upstream_secrets")
    stats = MigrationStats()
    secret_manager = SecretManager()

    async with AsyncSessionLocal() as session:
        presets = await session.execute(select(ProviderPreset))
        preset_by_slug = {preset.slug: preset for preset in presets.scalars().all()}

        instances = await _load_instances(session, instance_filter, preset_filter)
        instance_map = {inst.id: inst for inst in instances}

        credentials = await _load_credentials(session, set(instance_map.keys()))
        alias_map: dict[uuid.UUID, dict[str, ProviderCredential]] = {}
        for cred in credentials:
            alias_map.setdefault(cred.instance_id, {})[cred.alias] = cred

        for cred in credentials:
            stats.credential_total += 1
            secret_ref_id = (cred.secret_ref_id or "").strip()
            if not secret_ref_id:
                stats.credential_failed += 1
                logger.warning("credential_missing_ref instance=%s alias=%s", cred.instance_id, cred.alias)
                continue

            if secret_manager._is_db_ref(secret_ref_id):
                stats.credential_skipped += 1
                continue

            inst = instance_map.get(cred.instance_id)
            if not inst:
                stats.credential_failed += 1
                logger.warning("credential_missing_instance instance=%s alias=%s", cred.instance_id, cred.alias)
                continue

            preset = preset_by_slug.get(inst.preset_slug)
            provider = preset.provider if preset else None
            if not provider:
                stats.credential_failed += 1
                logger.warning("credential_missing_provider instance=%s alias=%s", cred.instance_id, cred.alias)
                continue

            raw_secret = None
            source = None
            if secret_manager._looks_like_plain_secret(secret_ref_id):
                raw_secret = secret_ref_id
                source = "plaintext"
            elif allow_env:
                raw_secret, source = _resolve_env_secret(secret_ref_id, provider)

            if not raw_secret:
                stats.credential_failed += 1
                logger.warning(
                    "credential_unmigrated instance=%s alias=%s ref=%s",
                    cred.instance_id,
                    cred.alias,
                    _mask_value(secret_ref_id),
                )
                continue

            if not apply:
                stats.credential_migrated += 1
                logger.info(
                    "credential_would_migrate instance=%s alias=%s source=%s ref=%s",
                    cred.instance_id,
                    cred.alias,
                    source,
                    _mask_value(secret_ref_id),
                )
                continue

            try:
                new_ref = await secret_manager.store(provider=provider, raw_secret=raw_secret, db_session=session)
            except RuntimeError as exc:
                stats.credential_failed += 1
                logger.error(
                    "credential_store_failed instance=%s alias=%s err=%s",
                    cred.instance_id,
                    cred.alias,
                    str(exc),
                )
                continue

            cred.secret_ref_id = new_ref
            session.add(cred)
            stats.credential_migrated += 1
            logger.info(
                "credential_migrated instance=%s alias=%s source=%s new_ref=%s",
                cred.instance_id,
                cred.alias,
                source,
                new_ref,
            )

        for inst in instances:
            stats.instance_total += 1
            credentials_ref = (inst.credentials_ref or "").strip()
            if not credentials_ref:
                stats.instance_failed += 1
                logger.warning("instance_missing_ref instance=%s", inst.id)
                continue

            if secret_manager._is_db_ref(credentials_ref):
                stats.instance_skipped += 1
                continue

            if credentials_ref in alias_map.get(inst.id, {}):
                stats.instance_skipped += 1
                continue

            preset = preset_by_slug.get(inst.preset_slug)
            provider = preset.provider if preset else None
            if not provider:
                stats.instance_failed += 1
                logger.warning("instance_missing_provider instance=%s", inst.id)
                continue

            raw_secret = None
            source = None
            if secret_manager._looks_like_plain_secret(credentials_ref):
                raw_secret = credentials_ref
                source = "plaintext"
            elif allow_env:
                raw_secret, source = _resolve_env_secret(credentials_ref, provider)

            if not raw_secret:
                stats.instance_failed += 1
                logger.warning(
                    "instance_unmigrated instance=%s ref=%s",
                    inst.id,
                    _mask_value(credentials_ref),
                )
                continue

            if not apply:
                stats.instance_migrated += 1
                logger.info(
                    "instance_would_migrate instance=%s source=%s ref=%s",
                    inst.id,
                    source,
                    _mask_value(credentials_ref),
                )
                continue

            try:
                new_ref = await secret_manager.store(provider=provider, raw_secret=raw_secret, db_session=session)
            except RuntimeError as exc:
                stats.instance_failed += 1
                logger.error(
                    "instance_store_failed instance=%s err=%s",
                    inst.id,
                    str(exc),
                )
                continue

            inst.credentials_ref = new_ref
            session.add(inst)
            stats.instance_migrated += 1
            logger.info(
                "instance_migrated instance=%s source=%s new_ref=%s",
                inst.id,
                source,
                new_ref,
            )

        if apply:
            await session.commit()
        else:
            await session.rollback()

    return stats


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="迁移旧的 ENV/明文上游密钥引用到加密库 (upstream_secret)")
    parser.add_argument("--apply", action="store_true", help="执行迁移并写入数据库（默认 dry-run）")
    parser.add_argument("--allow-env", action="store_true", help="允许从环境变量读取旧密钥引用")
    parser.add_argument(
        "--instance-id",
        action="append",
        default=[],
        help="仅迁移指定实例（可多次传入）",
    )
    parser.add_argument(
        "--preset-slug",
        action="append",
        default=[],
        help="仅迁移指定 preset_slug（可多次传入）",
    )
    return parser


async def _main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        instance_filter = _parse_uuid_list(args.instance_id, "instance_id")
    except ValueError as exc:
        print(str(exc))
        return 1

    preset_filter = set([item.strip() for item in args.preset_slug if item.strip()])

    stats = await migrate_secrets(
        apply=args.apply,
        allow_env=args.allow_env,
        instance_filter=instance_filter,
        preset_filter=preset_filter,
    )

    mode = "APPLY" if args.apply else "DRY-RUN"
    print("\n" + "=" * 72)
    print(f"UPSTREAM SECRET MIGRATION ({mode})")
    print("=" * 72)
    print(
        "credentials: total={total} migrated={migrated} skipped={skipped} failed={failed}".format(
            total=stats.credential_total,
            migrated=stats.credential_migrated,
            skipped=stats.credential_skipped,
            failed=stats.credential_failed,
        )
    )
    print(
        "instances:   total={total} migrated={migrated} skipped={skipped} failed={failed}".format(
            total=stats.instance_total,
            migrated=stats.instance_migrated,
            skipped=stats.instance_skipped,
            failed=stats.instance_failed,
        )
    )
    print("=" * 72 + "\n")

    if not args.apply:
        print("提示：当前为 dry-run，如需写入请加 --apply。")
    if not args.allow_env:
        print("提示：默认未读取环境变量，如需迁移 ENV 引用请加 --allow-env。")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(asyncio.run(_main()))
