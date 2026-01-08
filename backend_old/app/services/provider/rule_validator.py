"""Rule validator for verifying extraction rules against sample data."""

from __future__ import annotations

from typing import Any

import jmespath


class RuleValidatorError(RuntimeError):
    """Base error for rule validation operations."""


class ValidationFailedError(RuleValidatorError):
    """Raised when rule validation fails."""

    def __init__(self, reason: str, details: dict[str, Any] | None = None):
        super().__init__(f"Validation failed: {reason}")
        self.reason = reason
        self.details = details or {}


class RuleValidator:
    """Validates extraction rules against sample data."""

    def validate_rule(
        self,
        rule: dict[str, Any],
        sample: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Validate that a rule can correctly extract data from sample.

        Args:
            rule: Rule dictionary containing jmespath_rule and capability_rules
            sample: Sample /models response to validate against

        Returns:
            Dict containing:
                - valid: Boolean indicating if validation passed
                - extracted_models: Models extracted by the rule
                - matched_capabilities: Capabilities matched for each model
                - issues: List of validation issues found

        Raises:
            ValidationFailedError: If validation encounters critical errors
        """
        issues = []
        extracted_models = []
        matched_capabilities = {}

        # Validate JMESPath rule
        jmespath_rule = rule.get("jmespath_rule")
        if not jmespath_rule:
            raise ValidationFailedError("Missing jmespath_rule in rule definition")

        try:
            extracted = jmespath.search(jmespath_rule, sample)
            if not extracted:
                issues.append({
                    "type": "extraction_failed",
                    "message": f"JMESPath rule '{jmespath_rule}' extracted nothing",
                })
            elif not isinstance(extracted, list):
                issues.append({
                    "type": "invalid_result_type",
                    "message": f"JMESPath result is {type(extracted).__name__}, expected list",
                })
            else:
                extracted_models = extracted
        except Exception as e:
            raise ValidationFailedError(
                f"JMESPath execution failed: {e}",
                {"rule": jmespath_rule, "error": str(e)},
            ) from e

        # Validate capability rules if models were extracted
        if extracted_models:
            capability_rules = rule.get("capability_rules", [])
            matched_capabilities = self._validate_capability_rules(
                extracted_models,
                capability_rules,
            )

            # Check if at least some models have capabilities
            models_with_caps = sum(1 for caps in matched_capabilities.values() if caps)
            if models_with_caps == 0 and capability_rules:
                issues.append({
                    "type": "no_capability_matches",
                    "message": "No models matched any capability rules",
                })

        # Determine overall validity
        valid = len(issues) == 0 and len(extracted_models) > 0

        return {
            "valid": valid,
            "extracted_models": extracted_models,
            "matched_capabilities": matched_capabilities,
            "issues": issues,
            "metadata": {
                "model_count": len(extracted_models),
                "models_with_capabilities": sum(
                    1 for caps in matched_capabilities.values() if caps
                ),
            },
        }

    def _validate_capability_rules(
        self,
        models: list[dict[str, Any]],
        capability_rules: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """
        Validate capability rules against extracted models.

        Returns dict mapping model_id -> list of matched capabilities.
        """
        from .capability_matcher import CapabilityMatcher

        matcher = CapabilityMatcher()
        matched = {}

        for model in models:
            if not isinstance(model, dict):
                continue

            model_id = model.get("id") or model.get("model") or model.get("name")
            if not model_id:
                continue

            # Match capabilities for this model
            capabilities = []
            for rule in capability_rules:
                capability = rule.get("capability")
                if not capability:
                    continue

                if matcher._matches_patterns(str(model_id), rule):
                    capabilities.append(capability)

            matched[str(model_id)] = capabilities

        return matched


__all__ = [
    "RuleValidator",
    "RuleValidatorError",
    "ValidationFailedError",
]
