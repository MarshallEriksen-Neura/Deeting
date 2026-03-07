from __future__ import annotations

from typing import Any

from app.protocols.canonical import CanonicalRequest
from app.protocols.contracts import ProtocolProfile
from app.protocols.runtime.profile_resolver import resolve_profile
from app.protocols.runtime.request_builder import apply_request_builder
from app.protocols.runtime.request_renderer import runtime_request_renderer
from app.protocols.runtime.transport_executor import UpstreamRequest


class ProtocolRuntimeService:
    def build_render_context(self, request: CanonicalRequest) -> dict[str, Any]:
        payload = request.model_dump(mode="python")
        return {
            **payload,
            "request": payload,
            "input": payload,
            "messages": payload.get("messages") or [],
            "input_items": payload.get("input_items") or [],
            "tools": payload.get("tools") or [],
            "metadata": payload.get("metadata") or {},
            "client_context": payload.get("client_context") or {},
            "model": {"id": request.model, "uid": request.model},
        }

    def build_upstream_request(
        self,
        request: CanonicalRequest,
        profile: ProtocolProfile | dict[str, Any],
        *,
        base_url: str,
    ) -> UpstreamRequest:
        resolved_profile = resolve_profile(profile)
        context = self.build_render_context(request)
        engine = resolved_profile.request.template_engine

        body = runtime_request_renderer.render(
            resolved_profile.request.request_template,
            engine=engine,
            context=context,
        )
        if not isinstance(body, dict):
            raise ValueError("request_template_must_render_to_object")
        body = self._merge_maps(resolved_profile.defaults.body, body)
        body = apply_request_builder(resolved_profile.request.request_builder, body, context)

        headers = runtime_request_renderer.render(
            resolved_profile.transport.header_template,
            engine=engine,
            context=context,
        )
        query = runtime_request_renderer.render(
            resolved_profile.transport.query_template,
            engine=engine,
            context=context,
        )
        if not isinstance(headers, dict):
            headers = {}
        if not isinstance(query, dict):
            query = {}
        headers = self._merge_maps(resolved_profile.defaults.headers, headers)
        query = self._merge_maps(resolved_profile.defaults.query, query)

        base = base_url.rstrip("/")
        path = resolved_profile.transport.path.lstrip("/")
        url = f"{base}/{path}" if path else base
        return UpstreamRequest(
            method=resolved_profile.transport.method.upper(),
            url=url,
            headers=headers,
            query=query,
            body=body,
        )

    def _merge_maps(
        self,
        base: dict[str, Any] | None,
        override: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged = dict(base or {})
        merged.update(override or {})
        return merged


protocol_runtime_service = ProtocolRuntimeService()
