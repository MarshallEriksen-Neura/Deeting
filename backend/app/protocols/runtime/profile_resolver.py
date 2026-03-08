from __future__ import annotations

from typing import Any

from app.protocols.contracts import ProtocolProfile, RuntimeHook
from app.protocols.profiles import BUILTIN_PROTOCOL_PROFILES


def resolve_profile(profile: ProtocolProfile | dict[str, Any]) -> ProtocolProfile:
    if isinstance(profile, ProtocolProfile):
        return profile
    return ProtocolProfile(**profile)


def infer_protocol_family(*, protocol: str | None, upstream_path: str | None) -> str:
    proto = (protocol or "").strip().lower()
    path = (upstream_path or "").strip().lower()

    if "anthropic" in proto or "claude" in proto:
        return "anthropic_messages"
    if "responses" in path:
        return "openai_responses"
    return "openai_chat"


def build_protocol_profile(
    *,
    provider: str,
    capability: str,
    protocol: str | None,
    upstream_path: str,
    http_method: str = "",
    template_engine: str = "",
    request_template: dict[str, Any] | str = {},
    response_transform: dict[str, Any] | None = None,
    output_mapping: dict[str, Any] | None = None,
    request_builder: dict[str, Any] | None = None,
    default_headers: dict[str, Any] | None = None,
    default_params: dict[str, Any] | None = None,
    async_config: dict[str, Any] | None = None,
) -> ProtocolProfile:
    family = infer_protocol_family(protocol=protocol, upstream_path=upstream_path)
    template_matches_family = _template_matches_family(request_template, family)
    base = BUILTIN_PROTOCOL_PROFILES[family].model_copy(deep=True)
    base.profile_id = f"{provider}:{capability}:{family}"
    base.provider = provider
    base.capability = capability  # type: ignore[assignment]
    base.transport.path = upstream_path
    base.transport.method = (http_method or base.transport.method or "POST").upper()
    if template_engine and template_matches_family:
        base.request.template_engine = template_engine
    if request_template and template_matches_family:
        base.request.request_template = request_template
    if request_builder and request_builder.get("name"):
        base.request.request_builder = RuntimeHook(
            name=str(request_builder["name"]),
            config=request_builder.get("config") or {},
        )
    if response_transform:
        base.response.response_template = response_transform
    if output_mapping:
        base.response.output_mapping = output_mapping
    if default_headers:
        base.defaults.headers.update(default_headers)
    if default_params:
        base.defaults.body.update(default_params)
    base.metadata.update(
        {
            "protocol": protocol or provider,
            "protocol_family": family,
            "async_config": async_config or {},
        }
    )
    return base


def load_protocol_profile_from_preset(
    preset: Any | None,
    capability: str,
) -> ProtocolProfile | None:
    profiles = getattr(preset, "protocol_profiles", None) or {}
    if not isinstance(profiles, dict):
        return None
    raw_profile = profiles.get(capability)
    if not isinstance(raw_profile, dict):
        return None
    return resolve_profile(raw_profile)


def resolve_effective_config_from_preset(
    preset: Any | None,
    capability: str,
) -> dict[str, Any] | None:
    profile = load_protocol_profile_from_preset(preset, capability)
    if profile is not None:
        config: dict[str, Any] = {
            "template_engine": profile.request.template_engine,
            "request_template": profile.request.request_template,
            "response_transform": profile.response.response_template,
            "output_mapping": profile.response.output_mapping,
            "http_method": profile.transport.method,
            "default_headers": profile.defaults.headers,
            "default_params": profile.defaults.body,
        }
        if profile.request.request_builder:
            config["request_builder"] = profile.request.request_builder.model_dump(
                exclude_none=True
            )
        async_config = profile.metadata.get("async_config") if isinstance(profile.metadata, dict) else {}
        if isinstance(async_config, dict):
            config["async_config"] = async_config
        return config

    return None


def resolve_profile_defaults_from_preset(
    preset: Any | None,
    capability: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = load_protocol_profile_from_preset(preset, capability)
    if profile is not None:
        return (
            dict(profile.defaults.headers or {}),
            dict(profile.defaults.body or {}),
        )

    return ({}, {})


def build_protocol_profile_from_preset(
    *,
    preset: Any | None,
    provider: str,
    capability: str,
    protocol: str | None,
    upstream_path: str,
    http_method: str = "",
    template_engine: str = "",
    request_template: dict[str, Any] | str = {},
    response_transform: dict[str, Any] | None = None,
    output_mapping: dict[str, Any] | None = None,
    request_builder: dict[str, Any] | None = None,
    default_headers: dict[str, Any] | None = None,
    default_params: dict[str, Any] | None = None,
    async_config: dict[str, Any] | None = None,
) -> ProtocolProfile:
    stored = load_protocol_profile_from_preset(preset, capability)
    if stored is None:
        raise ValueError(
            f"preset_protocol_profile_missing capability={capability} provider={provider}"
        )
    target_family = infer_protocol_family(protocol=protocol, upstream_path=upstream_path)
    if stored.protocol_family != target_family:
        stored = _rebase_profile_family(
            profile=stored,
            target_family=target_family,
            provider=provider,
            capability=capability,
            upstream_path=upstream_path,
            http_method=http_method,
            protocol=protocol,
            default_headers=default_headers,
            default_params=default_params,
            async_config=async_config,
        )
    else:
        stored = stored.model_copy(deep=True)

    profile = stored
    profile.profile_id = stored.profile_id or f"{provider}:{capability}:{stored.protocol_family}"
    profile.provider = provider
    profile.capability = capability  # type: ignore[assignment]
    profile.transport.path = upstream_path
    profile.transport.method = (http_method or profile.transport.method or "POST").upper()
    if default_headers:
        profile.defaults.headers = {
            **(profile.defaults.headers or {}),
            **default_headers,
        }
    if default_params:
        profile.defaults.body = {
            **(profile.defaults.body or {}),
            **default_params,
        }
    profile.metadata.update(
        {
            "protocol": protocol or provider,
            "protocol_profile_source": "preset.protocol_profiles",
            "async_config": async_config or profile.metadata.get("async_config") or {},
        }
    )
    return profile


def _rebase_profile_family(
    *,
    profile: ProtocolProfile,
    target_family: str,
    provider: str,
    capability: str,
    upstream_path: str,
    http_method: str | None,
    protocol: str | None,
    default_headers: dict[str, Any] | None,
    default_params: dict[str, Any] | None,
    async_config: dict[str, Any] | None,
) -> ProtocolProfile:
    rebased = BUILTIN_PROTOCOL_PROFILES[target_family].model_copy(deep=True)
    rebased.provider = provider
    rebased.capability = capability  # type: ignore[assignment]
    rebased.transport.path = upstream_path
    rebased.transport.method = (http_method or rebased.transport.method or "POST").upper()
    if _template_matches_family(profile.request.request_template, target_family):
        rebased.request.request_template = profile.request.request_template
        rebased.request.template_engine = profile.request.template_engine
    if profile.request.request_builder and _template_matches_family(
        profile.request.request_template, target_family
    ):
        rebased.request.request_builder = profile.request.request_builder
    rebased.response.response_template = profile.response.response_template or rebased.response.response_template
    rebased.response.output_mapping = profile.response.output_mapping or rebased.response.output_mapping
    rebased.defaults.headers = {
        **(rebased.defaults.headers or {}),
        **(profile.defaults.headers or {}),
        **(default_headers or {}),
    }
    rebased.defaults.body = {
        **(rebased.defaults.body or {}),
        **(profile.defaults.body or {}),
        **(default_params or {}),
    }
    rebased.metadata.update(profile.metadata or {})
    rebased.metadata.update(
        {
            "protocol": protocol or provider,
            "protocol_profile_source": "preset.protocol_profiles",
            "async_config": async_config or profile.metadata.get("async_config") or {},
            "rebased_from_family": profile.protocol_family,
        }
    )
    return rebased


def _template_matches_family(
    request_template: dict[str, Any] | str,
    protocol_family: str,
) -> bool:
    if not isinstance(request_template, dict):
        return True
    keys = {str(key) for key in request_template.keys()}
    if protocol_family == "openai_responses":
        return "input" in keys
    if protocol_family in {"openai_chat", "anthropic_messages"}:
        return "messages" in keys
    return True
