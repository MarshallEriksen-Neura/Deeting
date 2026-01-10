from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover
    Redis = object  # type: ignore[misc,assignment]

from app.auth import AuthenticatedAPIKey
from app.models import Provider, ProviderAPIKey, ProviderModel
from app.api.v1.chat.provider_selector import ProviderSelector
from app.services.encryption import decrypt_secret
from app.services.provider.capability_client import CapabilityClient
from app.services.provider.capability_resolver import resolve_capability_config

logger = logging.getLogger(__name__)


def _extract_first_embedding_vector(payload: dict[str, Any] | None) -> list[float] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return None
    item0 = data[0]
    if not isinstance(item0, dict):
        return None
    vec = item0.get("embedding")
    if not isinstance(vec, list) or not vec:
        return None
    out: list[float] = []
    for v in vec:
        if isinstance(v, (int, float)):
            out.append(float(v))
        else:
            return None
    return out


async def embed_text(
    db: DbSession,
    *,
    redis: Redis,
    client: Any,
    api_key: AuthenticatedAPIKey,
    effective_provider_ids: set[str],
    embedding_logical_model: str,
    text: str,
    idempotency_key: str,
    input_type: str | None = None,
) -> list[float] | None:
    """
    Call upstream embeddings via CapabilityClient.

    This resolves the provider/model using ProviderSelector, fetches the capability config,
    and executes the request using the unified CapabilityClient.
    """
    model = str(embedding_logical_model or "").strip()
    if not model:
        return None

    input_text = (text or "").strip()
    if not input_text:
        return None

    # 1. Select Provider/Model
    selector = ProviderSelector(client=client, redis=redis, db=db)
    try:
        selection = await selector.select(
            requested_model=model,
            lookup_model_id=model,
            api_style="openai",  # Selector requires an API style for logical model resolution
            effective_provider_ids=effective_provider_ids,
            capability="embedding",
        )
    except Exception as e:
        logger.warning(f"Embedding: Failed to select provider for model {model}: {e}")
        return None

    if not selection.ordered_candidates:
        logger.warning(f"Embedding: No candidates found for model {model}")
        return None

    # Pick the best candidate (first one)
    # TODO: Handle fallback/retry by iterating candidates if the first one fails
    candidate_score = selection.ordered_candidates[0]
    upstream = candidate_score.upstream

    # 2. Fetch Metadata & API Key
    # We need Provider and ProviderModel to get metadata_json and API key
    provider = db.scalar(
        select(Provider).where(Provider.provider_id == upstream.provider_id)
    )
    if not provider:
        logger.warning(f"Embedding: Provider {upstream.provider_id} not found in DB")
        return None

    provider_model = db.scalar(
        select(ProviderModel).where(
            ProviderModel.provider_id == provider.id,
            ProviderModel.model_id == upstream.model_id,
        )
    )

    # Resolve API Key
    provider_api_key = db.scalar(
        select(ProviderAPIKey)
        .where(ProviderAPIKey.provider_uuid == provider.id)
        .where(ProviderAPIKey.status == "active")
        .limit(1)
    )

    api_key_val = ""
    if provider_api_key and provider_api_key.encrypted_key:
        try:
            api_key_val = decrypt_secret(provider_api_key.encrypted_key)
        except Exception:
            logger.error(
                f"Embedding: Failed to decrypt API key for provider {provider.provider_id}"
            )
            return None

    # 3. Resolve Capability Config
    config = resolve_capability_config(
        provider_meta=provider.metadata_json,
        model_meta=provider_model.metadata_json if provider_model else None,
        capability="embedding",
        base_url=provider.base_url,
    )

    if not config:
        logger.warning(f"Embedding: Capability config not found for {model}")
        return None

    # 4. Prepare Request
    # Use standard OpenAI-like payload, CapabilityClient/Config handles transformation
    payload: dict[str, Any] = {
        "model": upstream.model_id,
        "input": [input_text],
    }
    if input_type:
        payload["input_type"] = input_type

    headers = {}
    if api_key_val:
        headers["Authorization"] = f"Bearer {api_key_val}"

    # 5. Execute Call
    cap_client = CapabilityClient()
    try:
        response = await cap_client.call(
            config=config,
            request=payload,
            headers=headers,
        )
    except Exception as e:
        logger.error(f"Embedding: Capability call failed: {e}")
        return None

    # 6. Extract Result
    # If response is already a list of floats (via response_map), return it
    if isinstance(response, list) and response and isinstance(response[0], (int, float)):
        return [float(x) for x in response]

    # Fallback to standard OpenAI-style response extraction
    return _extract_first_embedding_vector(response)


__all__ = ["embed_text"]
