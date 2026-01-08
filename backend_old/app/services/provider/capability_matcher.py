"""Capability matcher for inferring model capabilities from names/metadata."""

from __future__ import annotations

import re
from typing import Any


class CapabilityMatcherError(RuntimeError):
    """Base error for capability matching operations."""


class CapabilityMatcher:
    """Matches model capabilities based on regex patterns and lookup tables."""

    def match_capabilities(
        self,
        model_name: str,
        rules: list[dict[str, Any]],
    ) -> list[str]:
        """
        Match capabilities for a model based on inference rules.

        Args:
            model_name: Model identifier (e.g., "gpt-4-turbo", "claude-3-opus")
            rules: List of capability rules with patterns

        Returns:
            List of matched capability strings (e.g., ["chat", "vision"])

        Example rules format:
            [
                {
                    "capability": "chat",
                    "patterns": {
                        "regex": ["gpt-.*", "claude-.*"],
                        "lookup_table": {"specific-model": ["chat", "embedding"]}
                    }
                }
            ]
        """
        matched = []

        for rule in rules:
            capability = rule.get("capability")
            if not capability:
                continue

            if self._matches_patterns(model_name, rule):
                matched.append(capability)

        return matched

    def _matches_patterns(self, model_name: str, rule: dict[str, Any]) -> bool:
        """Check if model_name matches any pattern in the rule."""
        patterns = rule.get("patterns", {})

        # Check regex patterns
        regex_patterns = patterns.get("regex", [])
        for pattern in regex_patterns:
            try:
                if re.match(pattern, model_name):
                    return True
            except re.error:
                continue

        # Check lookup table
        lookup_table = patterns.get("lookup_table", {})
        if model_name in lookup_table:
            # Lookup table can map to list of capabilities
            # If the capability from rule is in that list, it's a match
            capabilities = lookup_table[model_name]
            if isinstance(capabilities, list) and rule.get("capability") in capabilities:
                return True

        return False


__all__ = [
    "CapabilityMatcher",
    "CapabilityMatcherError",
]
