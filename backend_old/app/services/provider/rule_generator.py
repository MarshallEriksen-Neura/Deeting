"""Rule generator for extracting model lists and capabilities from provider responses."""

from __future__ import annotations

import re
from typing import Any

import jmespath


class RuleGeneratorError(RuntimeError):
    """Base error for rule generation operations."""


class InvalidSampleError(RuleGeneratorError):
    """Raised when sample JSON is invalid or cannot be parsed."""

    def __init__(self, reason: str):
        super().__init__(f"Invalid sample: {reason}")
        self.reason = reason


class RuleGenerator:
    """Generates JMESPath and capability rules from sample /models responses."""

    def analyze_sample(self, sample_json: dict[str, Any]) -> dict[str, Any]:
        """
        Analyze sample /models response and generate extraction rules.

        Args:
            sample_json: Sample response from provider's /models endpoint

        Returns:
            Dict containing:
                - jmespath_rule: JMESPath expression to extract model list
                - capability_rules: List of capability inference rules
                - metadata: Additional metadata about the generation

        Raises:
            InvalidSampleError: If sample cannot be analyzed
        """
        if not isinstance(sample_json, dict):
            raise InvalidSampleError("Sample must be a dictionary")

        # Detect model list location
        jmespath_rule = self._generate_jmespath_rule(sample_json)

        # Test the rule
        try:
            models = jmespath.search(jmespath_rule, sample_json)
            if not models or not isinstance(models, list):
                raise InvalidSampleError(
                    f"Generated rule '{jmespath_rule}' did not extract a list"
                )
        except Exception as e:
            raise InvalidSampleError(f"JMESPath rule failed: {e}") from e

        return {
            "jmespath_rule": jmespath_rule,
            # 能力映射暂不在 Agent 层生成，保持空列表
            "capability_rules": [],
            "metadata": {
                "sample_model_count": len(models),
                "detected_fields": self._detect_fields(models),
                "version": "1.0.0",
            },
        }

    def _generate_jmespath_rule(self, sample: dict[str, Any]) -> str:
        """
        Generate JMESPath expression to extract model list.

        Common patterns:
        - data[*]: OpenAI-style with data array
        - models[*]: Direct models array
        - [*]: Root-level array
        """
        # Pattern 1: data array
        if "data" in sample and isinstance(sample["data"], list):
            return "data[*]"

        # Pattern 2: models array
        if "models" in sample and isinstance(sample["models"], list):
            return "models[*]"

        # Pattern 3: root-level array
        if isinstance(sample, list):
            return "[*]"

        # Pattern 4: first array found
        for key, value in sample.items():
            if isinstance(value, list) and value:
                return f"{key}[*]"

        raise InvalidSampleError("No model list array found in sample")

    def _generate_capability_rules(self, models: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Generate capability inference rules from sample models.

        Returns list of rules in format:
        {
            "capability": "chat",
            "patterns": {
                "regex": ["gpt-.*", "claude-.*"],
                "lookup_table": {"specific-model": ["chat", "embedding"]}
            }
        }
        """
        if not models:
            return []

        # Analyze model IDs for pattern detection
        model_ids = []
        for model in models:
            if isinstance(model, dict):
                model_id = model.get("id") or model.get("model") or model.get("name")
                if model_id:
                    model_ids.append(str(model_id))

        if not model_ids:
            return []

        # Generate capability rules based on common patterns
        rules = []

        # Chat capability patterns
        chat_patterns = self._detect_patterns(
            model_ids,
            [
                r"gpt-.*",
                r"claude-.*",
                r"gemini-.*",
                r".*-chat.*",
                r".*-turbo.*",
                r"qwen.*",
                r"llama.*",
            ],
        )
        if chat_patterns:
            rules.append({
                "capability": "chat",
                "patterns": {"regex": chat_patterns},
            })

        # Embedding capability patterns
        embedding_patterns = self._detect_patterns(
            model_ids,
            [
                r".*-embedding.*",
                r"text-embedding-.*",
                r"embed-.*",
            ],
        )
        if embedding_patterns:
            rules.append({
                "capability": "embedding",
                "patterns": {"regex": embedding_patterns},
            })

        # Vision capability patterns
        vision_patterns = self._detect_patterns(
            model_ids,
            [
                r".*-vision.*",
                r"gpt-4.*",
                r"claude-3-.*",
                r"gemini-.*-vision.*",
            ],
        )
        if vision_patterns:
            rules.append({
                "capability": "vision",
                "patterns": {"regex": vision_patterns},
            })

        return rules

    def _detect_patterns(self, model_ids: list[str], candidate_patterns: list[str]) -> list[str]:
        """Detect which regex patterns match the given model IDs."""
        matched = []
        for pattern in candidate_patterns:
            try:
                regex = re.compile(pattern)
                if any(regex.match(mid) for mid in model_ids):
                    matched.append(pattern)
            except re.error:
                continue
        return matched

    def _detect_fields(self, models: list[dict[str, Any]]) -> list[str]:
        """Detect common fields across model entries."""
        if not models or not isinstance(models[0], dict):
            return []

        # Get union of all fields
        all_fields = set()
        for model in models[:5]:  # Sample first 5
            if isinstance(model, dict):
                all_fields.update(model.keys())

        return sorted(all_fields)


__all__ = [
    "InvalidSampleError",
    "RuleGenerator",
    "RuleGeneratorError",
]
