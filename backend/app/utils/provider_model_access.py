from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID


def parse_unlock_price_credits(pricing_config: dict[str, Any] | None) -> Decimal | None:
    if not isinstance(pricing_config, dict):
        return None

    raw = pricing_config.get("unlock_price_credits")
    if raw is None:
        return None

    try:
        price = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        return None

    if price <= 0:
        return None
    return price


def requires_model_purchase(
    *,
    instance_owner_id: UUID | None,
    user_id: UUID | None,
    unlock_price_credits: Decimal | None,
) -> bool:
    if unlock_price_credits is None or unlock_price_credits <= 0:
        return False
    if user_id is None:
        return False
    if instance_owner_id == user_id:
        return False
    return True
