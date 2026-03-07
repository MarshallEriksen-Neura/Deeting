from __future__ import annotations

from typing import Any

from jinja2 import BaseLoader, Environment

from app.services.providers.request_renderer import SilentUndefined


class RuntimeRequestRenderer:
    def __init__(self):
        self.jinja_env = Environment(loader=BaseLoader(), undefined=SilentUndefined)

    def render(self, template: Any, *, engine: str, context: dict[str, Any]) -> Any:
        if engine == "jinja2":
            return self._render_jinja(template, context)
        return self._render_simple(template, context)

    def _render_jinja(self, template: Any, context: dict[str, Any]) -> Any:
        if isinstance(template, str):
            if "{{" not in template and "{%" not in template:
                return template
            rendered = self.jinja_env.from_string(template).render(**context)
            normalized = rendered.strip()
            if normalized in {"true", "false"}:
                return normalized == "true"
            if normalized in {"null", "none", ""}:
                return None if normalized != "" else rendered
            if normalized.isdigit():
                return int(normalized)
            return rendered
        if isinstance(template, dict):
            return {
                key: self._render_jinja(value, context)
                for key, value in template.items()
                if self._render_jinja(value, context) is not None
            }
        if isinstance(template, list):
            rendered_items = [self._render_jinja(value, context) for value in template]
            return [value for value in rendered_items if value is not None]
        return template

    def _render_simple(self, template: Any, context: dict[str, Any]) -> Any:
        if template is None:
            return None
        if isinstance(template, dict):
            rendered: dict[str, Any] = {}
            for key, value in template.items():
                if value is None:
                    resolved = self._lookup_value(key, context)
                else:
                    resolved = self._render_simple(value, context)
                if resolved is not None:
                    rendered[key] = resolved
            return rendered
        if isinstance(template, list):
            rendered_items = [self._render_simple(value, context) for value in template]
            return [value for value in rendered_items if value is not None]
        return template

    def _lookup_value(self, key: str, context: dict[str, Any]) -> Any:
        candidate_keys = [key]
        normalized = key.strip().lower().replace("-", "_")
        if normalized not in candidate_keys:
            candidate_keys.append(normalized)
        if normalized.startswith("x_"):
            stripped = normalized[2:]
            if stripped and stripped not in candidate_keys:
                candidate_keys.append(stripped)

        request = context.get("request") or {}
        if isinstance(request, dict):
            for candidate in candidate_keys:
                if candidate in request:
                    return request[candidate]
        for candidate in candidate_keys:
            if candidate in context:
                return context[candidate]
        client_context = context.get("client_context") or {}
        if isinstance(client_context, dict):
            for candidate in candidate_keys:
                if candidate in client_context:
                    return client_context[candidate]
        return None


runtime_request_renderer = RuntimeRequestRenderer()
