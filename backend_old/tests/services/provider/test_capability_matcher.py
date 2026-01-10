"""Tests for capability matcher."""

from __future__ import annotations

import pytest

from app.services.provider import CapabilityMatcher


class TestCapabilityMatcher:
    """Test capability matching logic."""

    def test_match_chat_capabilities(self):
        """Test matching chat capabilities via regex."""
        matcher = CapabilityMatcher()

        rules = [
            {
                "capability": "chat",
                "patterns": {
                    "regex": ["gpt-.*", "claude-.*", "gemini-.*"],
                },
            }
        ]

        assert matcher.match_capabilities("gpt-4-turbo", rules) == ["chat"]
        assert matcher.match_capabilities("claude-3-opus", rules) == ["chat"]
        assert matcher.match_capabilities("gemini-pro", rules) == ["chat"]
        assert matcher.match_capabilities("unknown-model", rules) == []

    def test_match_multiple_capabilities(self):
        """Test matching multiple capabilities."""
        matcher = CapabilityMatcher()

        rules = [
            {
                "capability": "chat",
                "patterns": {
                    "regex": ["gpt-4.*"],
                },
            },
            {
                "capability": "vision",
                "patterns": {
                    "regex": ["gpt-4.*"],
                },
            },
        ]

        capabilities = matcher.match_capabilities("gpt-4-turbo", rules)
        assert "chat" in capabilities
        assert "vision" in capabilities
        assert len(capabilities) == 2

    def test_match_via_lookup_table(self):
        """Test matching via lookup table."""
        matcher = CapabilityMatcher()

        rules = [
            {
                "capability": "chat",
                "patterns": {
                    "lookup_table": {
                        "custom-model-v1": ["chat", "embedding"],
                    },
                },
            },
            {
                "capability": "embedding",
                "patterns": {
                    "lookup_table": {
                        "custom-model-v1": ["chat", "embedding"],
                    },
                },
            },
        ]

        capabilities = matcher.match_capabilities("custom-model-v1", rules)
        assert "chat" in capabilities
        assert "embedding" in capabilities

    def test_match_combined_patterns(self):
        """Test matching with both regex and lookup table."""
        matcher = CapabilityMatcher()

        rules = [
            {
                "capability": "chat",
                "patterns": {
                    "regex": ["gpt-.*"],
                    "lookup_table": {
                        "special-model": ["chat"],
                    },
                },
            }
        ]

        assert matcher.match_capabilities("gpt-4", rules) == ["chat"]
        assert matcher.match_capabilities("special-model", rules) == ["chat"]
        assert matcher.match_capabilities("unknown", rules) == []

    def test_invalid_regex_handling(self):
        """Test that invalid regex patterns are skipped gracefully."""
        matcher = CapabilityMatcher()

        rules = [
            {
                "capability": "chat",
                "patterns": {
                    "regex": ["[invalid(regex"],  # Invalid regex
                },
            }
        ]

        # Should not raise, just return empty list
        assert matcher.match_capabilities("gpt-4", rules) == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
