from __future__ import annotations

import json
import logging

from app.services.skill_registry.evidence_pack import EvidencePack

logger = logging.getLogger(__name__)


class SkillManifestGenerator:
    async def generate(self, evidence: EvidencePack, runtime: str) -> dict:
        from app.services.providers.llm import llm_service

        prompt = _build_prompt(evidence, runtime)
        response = await llm_service.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        return _parse_json_response(response)


def _build_prompt(evidence: EvidencePack, runtime: str) -> str:
    readme = (evidence.readme or "").strip()
    if len(readme) > 4000:
        readme = readme[:4000].rstrip()
    deps = ", ".join(evidence.dependencies[:20])
    entrypoints = ", ".join(evidence.entrypoints[:10])
    return f"""
You are a Skill Manifest Builder for Deeting OS.
Based on the evidence below, generate a JSON manifest for a library-first skill.

Rules:
1. Return ONLY valid JSON (no markdown).
2. Required fields: name, description, capabilities, usage_spec.example_code.
3. Keep description under 300 chars.
4. capabilities should be a list of short keywords.

Runtime: {runtime}

Evidence:
- Dependencies: {deps or "none"}
- Entrypoints: {entrypoints or "none"}
- README:
{readme or "none"}

Return JSON like:
{{
  "name": "...",
  "description": "...",
  "capabilities": ["..."],
  "usage_spec": {{
    "example_code": "..."
  }}
}}
""".strip()


def _parse_json_response(response: str) -> dict:
    text = response.strip()
    if text.startswith("```json"):
        text = text.replace("```json", "").replace("```", "").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        logger.error("manifest_generator_invalid_json: %s", exc)
        raise RuntimeError(f"Invalid JSON from LLM: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Manifest must be a JSON object")
    return payload
