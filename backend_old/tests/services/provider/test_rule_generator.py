"""Tests for rule generator."""

from __future__ import annotations

import pytest

from app.services.provider import RuleGenerator
from app.services.provider.rule_generator import InvalidSampleError


class TestRuleGenerator:
    """Test rule generation from sample responses."""

    def test_analyze_openai_style_response(self):
        """Test analyzing OpenAI-style /models response."""
        generator = RuleGenerator()

        sample = {
            "object": "list",
            "data": [
                {
                    "id": "gpt-4-turbo",
                    "object": "model",
                    "created": 1234567890,
                    "owned_by": "openai",
                },
                {
                    "id": "gpt-3.5-turbo",
                    "object": "model",
                    "created": 1234567890,
                    "owned_by": "openai",
                },
                {
                    "id": "text-embedding-ada-002",
                    "object": "model",
                    "created": 1234567890,
                    "owned_by": "openai",
                },
            ],
        }

        result = generator.analyze_sample(sample)

        assert result["jmespath_rule"] == "data[*]"
        assert len(result["capability_rules"]) > 0
        assert result["metadata"]["sample_model_count"] == 3

        # Check chat capability rule exists
        chat_rule = next(
            (r for r in result["capability_rules"] if r["capability"] == "chat"),
            None,
        )
        assert chat_rule is not None
        assert "patterns" in chat_rule
        assert "regex" in chat_rule["patterns"]

        # Check embedding capability rule exists
        embedding_rule = next(
            (r for r in result["capability_rules"] if r["capability"] == "embedding"),
            None,
        )
        assert embedding_rule is not None

    def test_analyze_anthropic_style_response(self):
        """Test analyzing Anthropic-style response."""
        generator = RuleGenerator()

        sample = {
            "models": [
                {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus"},
                {"id": "claude-3-sonnet-20240229", "name": "Claude 3 Sonnet"},
            ]
        }

        result = generator.analyze_sample(sample)

        assert result["jmespath_rule"] == "models[*]"
        assert result["metadata"]["sample_model_count"] == 2

    def test_analyze_invalid_sample(self):
        """Test error handling for invalid samples."""
        generator = RuleGenerator()

        # Not a dict
        with pytest.raises(InvalidSampleError, match="must be a dictionary"):
            generator.analyze_sample([])

        # No array found
        with pytest.raises(InvalidSampleError, match="No model list array"):
            generator.analyze_sample({"status": "ok"})


class TestRuleGeneratorPatternDetection:
    """Test capability pattern detection."""

    def test_detect_chat_patterns(self):
        """Test detecting chat model patterns."""
        generator = RuleGenerator()

        models = [
            {"id": "gpt-4-turbo"},
            {"id": "claude-3-opus"},
            {"id": "gemini-pro"},
        ]

        rules = generator._generate_capability_rules(models)

        chat_rule = next(
            (r for r in rules if r["capability"] == "chat"),
            None,
        )
        assert chat_rule is not None

        patterns = chat_rule["patterns"]["regex"]
        assert any("gpt" in p for p in patterns)
        assert any("claude" in p for p in patterns)
        assert any("gemini" in p for p in patterns)

    def test_detect_embedding_patterns(self):
        """Test detecting embedding model patterns."""
        generator = RuleGenerator()

        models = [
            {"id": "text-embedding-ada-002"},
            {"id": "embed-english-v3.0"},
        ]

        rules = generator._generate_capability_rules(models)

        embedding_rule = next(
            (r for r in rules if r["capability"] == "embedding"),
            None,
        )
        assert embedding_rule is not None

        patterns = embedding_rule["patterns"]["regex"]
        assert any("embedding" in p for p in patterns)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
