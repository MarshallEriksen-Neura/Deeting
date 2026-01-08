"""Tests for rule validator."""

from __future__ import annotations

import pytest

from app.services.provider import RuleValidator
from app.services.provider.rule_validator import ValidationFailedError


class TestRuleValidator:
    """Test rule validation against sample data."""

    def test_validate_successful_rule(self):
        """Test validating a working rule."""
        validator = RuleValidator()

        rule = {
            "jmespath_rule": "data[*]",
            "capability_rules": [
                {
                    "capability": "chat",
                    "patterns": {
                        "regex": ["gpt-.*", "claude-.*"],
                    },
                }
            ],
        }

        sample = {
            "data": [
                {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
                {"id": "claude-3-opus", "name": "Claude 3 Opus"},
            ]
        }

        result = validator.validate_rule(rule, sample)

        assert result["valid"] is True
        assert len(result["extracted_models"]) == 2
        assert len(result["matched_capabilities"]) == 2
        assert result["matched_capabilities"]["gpt-4-turbo"] == ["chat"]
        assert result["matched_capabilities"]["claude-3-opus"] == ["chat"]
        assert len(result["issues"]) == 0

    def test_validate_failed_extraction(self):
        """Test validation when JMESPath fails to extract."""
        validator = RuleValidator()

        rule = {
            "jmespath_rule": "nonexistent[*]",
            "capability_rules": [],
        }

        sample = {
            "data": [
                {"id": "gpt-4"},
            ]
        }

        result = validator.validate_rule(rule, sample)

        assert result["valid"] is False
        assert len(result["extracted_models"]) == 0
        assert any(issue["type"] == "extraction_failed" for issue in result["issues"])

    def test_validate_invalid_jmespath(self):
        """Test validation with invalid JMESPath syntax."""
        validator = RuleValidator()

        rule = {
            "jmespath_rule": "data[*",  # Invalid syntax
            "capability_rules": [],
        }

        sample = {"data": [{"id": "model-1"}]}

        with pytest.raises(ValidationFailedError, match="JMESPath execution failed"):
            validator.validate_rule(rule, sample)

    def test_validate_missing_jmespath_rule(self):
        """Test validation with missing JMESPath rule."""
        validator = RuleValidator()

        rule = {
            "capability_rules": [],
        }

        sample = {"data": []}

        with pytest.raises(ValidationFailedError, match="Missing jmespath_rule"):
            validator.validate_rule(rule, sample)

    def test_validate_no_capability_matches(self):
        """Test validation when no models match capabilities."""
        validator = RuleValidator()

        rule = {
            "jmespath_rule": "data[*]",
            "capability_rules": [
                {
                    "capability": "chat",
                    "patterns": {
                        "regex": ["gpt-.*"],
                    },
                }
            ],
        }

        sample = {
            "data": [
                {"id": "unknown-model-1"},
                {"id": "unknown-model-2"},
            ]
        }

        result = validator.validate_rule(rule, sample)

        assert result["valid"] is False
        assert len(result["extracted_models"]) == 2
        assert any(issue["type"] == "no_capability_matches" for issue in result["issues"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
