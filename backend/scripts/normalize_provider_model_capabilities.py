from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from typing import Iterable

from sqlalchemy.exc import SQLAlchemyError

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from app.core.db_sync import SessionLocal
from app.models.provider_instance import ProviderModel


CHAT_ALIASES = {"code", "reasoning", "vision"}
IMAGE_ALIASES = {"image"}
AUDIO_ALIASES = {"audio"}


def _normalize_caps(caps: Iterable[str], audio_mode: str) -> tuple[list[str], bool]:
    """
    归一化能力列表：
    - code/reasoning/vision -> chat
    - image -> image_generation
    - audio: 根据 audio_mode 处理 (keep/disable/chat)
    """
    changed = False
    normalized: list[str] = []
    for cap in caps:
        cap_norm = (cap or "").strip().lower()
        if not cap_norm:
            continue
        if cap_norm in IMAGE_ALIASES:
            cap_norm = "image_generation"
            changed = True
        if cap_norm in AUDIO_ALIASES:
            cap_norm = "speech_to_text"
            changed = True
        if cap_norm in CHAT_ALIASES:
            cap_norm = "chat"
            changed = True
        if cap_norm == "audio" and audio_mode == "chat":
            cap_norm = "chat"
            changed = True
        if cap_norm not in normalized:
            normalized.append(cap_norm)
    return normalized, changed


def normalize(dry_run: bool, audio_mode: str) -> None:
    try:
        with SessionLocal() as session:
            models = session.query(ProviderModel).all()
            if not models:
                print("没有 provider_model 数据。")
                return

            updates = 0
            disabled = 0
            before_counter: Counter[str] = Counter()
            after_counter: Counter[str] = Counter()

            for model in models:
                caps = model.capabilities or []
                for c in caps:
                    before_counter[(c or "").lower()] += 1

                new_caps, changed = _normalize_caps(caps, audio_mode)

                if audio_mode == "disable" and "audio" in {(c or "").lower() for c in caps}:
                    if model.is_active:
                        model.is_active = False
                        disabled += 1
                        changed = True

                for c in new_caps:
                    after_counter[c] += 1

                if changed:
                    model.capabilities = new_caps or ["chat"]
                    updates += 1

            print("=== 能力归一化预览 ===")
            print(f"模型总数: {len(models)}")
            print(f"将更新的模型数: {updates}")
            if audio_mode == "disable":
                print(f"将禁用的音频模型数: {disabled}")

            print("")
            print("=== 能力分布（归一化前） ===")
            for key, count in before_counter.most_common():
                print(f"  - {key or '(empty)'}: {count}")

            print("")
            print("=== 能力分布（归一化后） ===")
            for key, count in after_counter.most_common():
                print(f"  - {key or '(empty)'}: {count}")

            if dry_run:
                print("")
                print("当前为 dry-run，没有写入数据库。")
                session.rollback()
                return

            session.commit()
            print("")
            print("已写入数据库。")
    except SQLAlchemyError as exc:
        print("[ERROR] 无法写入数据库，请检查 DATABASE_URL 与连接权限。")
        print(f"异常信息: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="归一化 provider_model.capabilities")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际写入数据库（默认仅 dry-run）",
    )
    parser.add_argument(
        "--audio",
        choices=["keep", "disable", "chat"],
        default="keep",
        help="audio 能力处理策略：keep 保持不变；disable 禁用模型；chat 归一到 chat",
    )
    args = parser.parse_args()
    normalize(dry_run=not args.apply, audio_mode=args.audio)


if __name__ == "__main__":
    main()
