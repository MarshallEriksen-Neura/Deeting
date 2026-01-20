from __future__ import annotations

from collections import Counter, defaultdict
import os
import sys
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from app.core.db_sync import SessionLocal
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset


def _extract_capability_config(configs: dict[str, Any], capability: str) -> dict[str, Any] | None:
    if not configs:
        return None
    if capability in configs:
        return configs.get(capability)
    return None


def inspect_state(sample_limit: int = 20) -> None:
    try:
        with SessionLocal() as session:
            presets = session.query(ProviderPreset).all()
            instances = session.query(ProviderInstance).all()
            models = session.query(ProviderModel).all()
    except SQLAlchemyError as exc:
        print("[ERROR] 无法读取数据库，请检查 DATABASE_URL 与连接权限。")
        print(f"异常信息: {exc}")
        return

    preset_by_slug = {p.slug: p for p in presets}
    instance_by_id = {str(i.id): i for i in instances}

    cap_counter: Counter[str] = Counter()
    preset_cap_counter: Counter[str] = Counter()
    preset_empty = 0

    for preset in presets:
        configs = preset.capability_configs or {}
        if not configs:
            preset_empty += 1
        for key in configs.keys():
            preset_cap_counter[key] += 1

    missing_preset: list[tuple[str, str]] = []
    missing_cap_config: list[tuple[str, str, str, str]] = []
    missing_template: list[tuple[str, str, str, str]] = []

    for model in models:
        inst = instance_by_id.get(str(model.instance_id))
        if not inst:
            missing_preset.append((str(model.instance_id), model.model_id))
            continue

        preset = preset_by_slug.get(inst.preset_slug)
        if not preset:
            missing_preset.append((str(model.instance_id), model.model_id))
            continue

        for cap in model.capabilities or []:
            cap_counter[cap] += 1
            config = _extract_capability_config(preset.capability_configs or {}, cap)
            if not config:
                missing_cap_config.append((str(inst.id), model.model_id, cap, preset.slug))
                continue
            request_template = config.get("request_template") or config.get("body_template")
            if not request_template:
                missing_template.append((str(inst.id), model.model_id, cap, preset.slug))

    print("=== Provider Preset / Model 状态概览 ===")
    print(f"provider_preset: {len(presets)}")
    print(f"provider_instance: {len(instances)}")
    print(f"provider_model: {len(models)}")
    print("")

    print("=== provider_preset.capability_configs 分布 ===")
    if not presets:
        print("没有任何 provider_preset 数据。")
    else:
        print(f"capability_configs 为空的 preset 数量: {preset_empty}")
        if preset_cap_counter:
            print("能力键统计:")
            for key, count in preset_cap_counter.most_common():
                print(f"  - {key}: {count}")
        else:
            print("未发现任何 capability_configs 键。")
    print("")

    print("=== provider_model.capabilities 分布 ===")
    if cap_counter:
        for key, count in cap_counter.most_common():
            print(f"  - {key}: {count}")
    else:
        print("未发现任何 provider_model.capabilities。")
    print("")

    print("=== 关联性检查（实例/模型 -> 模板配置） ===")
    if missing_preset:
        print(f"缺失 preset 的模型数: {len(missing_preset)}（仅展示前 {sample_limit} 条）")
        for item in missing_preset[:sample_limit]:
            print(f"  - instance_id={item[0]} model_id={item[1]}")
    else:
        print("未发现缺失 preset 的模型。")

    if missing_cap_config:
        print(f"缺失 capability_config 的模型数: {len(missing_cap_config)}（仅展示前 {sample_limit} 条）")
        for item in missing_cap_config[:sample_limit]:
            print(f"  - instance_id={item[0]} model_id={item[1]} cap={item[2]} preset={item[3]}")
    else:
        print("所有模型能力都有对应 capability_config。")

    if missing_template:
        print(f"缺失 request_template/body_template 的模型数: {len(missing_template)}（仅展示前 {sample_limit} 条）")
        for item in missing_template[:sample_limit]:
            print(f"  - instance_id={item[0]} model_id={item[1]} cap={item[2]} preset={item[3]}")
    else:
        print("所有 capability_config 都包含 request_template/body_template。")
    print("")

    print("=== 预览：每个 preset 的能力键 ===")
    for preset in presets:
        configs = preset.capability_configs or {}
        keys = ", ".join(sorted(configs.keys())) if configs else "-"
        print(f"- {preset.slug} ({preset.provider}): {keys}")


if __name__ == "__main__":
    inspect_state()
