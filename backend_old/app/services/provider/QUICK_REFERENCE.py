"""
Provider Service Package - Quick Reference

A complete guide for using the provider service package.
"""

# ============================================================================
# BASIC USAGE
# ============================================================================

# 1. Generate rules from sample response
from app.services.provider import RuleGenerator

generator = RuleGenerator()
sample = {
    "data": [
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
        {"id": "text-embedding-ada-002", "name": "Ada Embedding"}
    ]
}

result = generator.analyze_sample(sample)
# Returns: {"jmespath_rule": "data[*]", "capability_rules": [...]}


# 2. Validate rules
from app.services.provider import RuleValidator

validator = RuleValidator()
rule = {
    "jmespath_rule": "data[*]",
    "capability_rules": [
        {
            "capability": "chat",
            "patterns": {"regex": ["gpt-.*"]}
        }
    ]
}

validation = validator.validate_rule(rule, sample)
# Returns: {"valid": True, "extracted_models": [...], "matched_capabilities": {...}}


# 3. Match capabilities
from app.services.provider import CapabilityMatcher

matcher = CapabilityMatcher()
capabilities = matcher.match_capabilities("gpt-4-turbo", rule["capability_rules"])
# Returns: ["chat"]


# 4. Sync models
from app.services.provider import ModelSyncer
from sqlalchemy.orm import Session

syncer = ModelSyncer(session)
result = syncer.sync_provider_models(
    provider_slug="openai",
    created_by_id=user_id,
    dry_run=False
)
# Returns: {"success": True, "models_synced": 15, "models_created": 3, ...}


# ============================================================================
# ERROR HANDLING
# ============================================================================

from app.services.provider.rule_generator import InvalidSampleError
from app.services.provider.rule_validator import ValidationFailedError
from app.services.provider.model_syncer import (
    ProviderNotFoundError,
    MetadataNotFoundError,
    RuleValidationError,
)

try:
    syncer.sync_provider_models("provider-slug")
except RuleValidationError as e:
    # Rules failed validation - task created automatically
    print(f"Validation failed: {e.reason}")
    print(f"Issues: {e.issues}")
except ProviderNotFoundError as e:
    # Provider doesn't exist
    print(f"Provider not found: {e.provider_slug}")
except MetadataNotFoundError as e:
    # Metadata not configured
    print(f"Metadata missing for: {e.provider_slug}")


# ============================================================================
# COMMON PATTERNS
# ============================================================================

# Pattern 1: Initial setup for new provider
def setup_new_provider(session, provider_slug, sample_response):
    """Set up rule generation for a new provider."""
    generator = RuleGenerator()

    # Generate rules
    result = generator.analyze_sample(sample_response)

    # Validate before saving
    validator = RuleValidator()
    validation = validator.validate_rule(result, sample_response)

    if not validation["valid"]:
        raise ValueError(f"Generated rules failed validation: {validation['issues']}")

    # Save to database
    from app.models import ProviderMetadata
    metadata = ProviderMetadata(
        provider_slug=provider_slug,
        model_list_config={
            "endpoint": "/v1/models",
            "selector": result["jmespath_rule"]
        },
        endpoints_config={
            rule["capability"]: {"patterns": rule["patterns"]}
            for rule in result["capability_rules"]
        }
    )
    session.add(metadata)
    session.commit()

    return metadata


# Pattern 2: Scheduled sync with error recovery
def scheduled_sync(session, provider_slug):
    """Sync models with automatic error recovery."""
    syncer = ModelSyncer(session)

    try:
        result = syncer.sync_provider_models(provider_slug)
        print(f"Synced {result['models_synced']} models")
        return result
    except RuleValidationError as e:
        # Task already created by syncer
        print(f"Validation failed, regeneration task created")
        print(f"Issues: {e.issues}")
        return {"success": False, "error": str(e)}


# Pattern 3: Batch sync all providers
def sync_all_active_providers(session):
    """Sync all active providers."""
    from app.models import ProviderMetadata
    from sqlalchemy import select

    stmt = select(ProviderMetadata).where(ProviderMetadata.is_active == True)
    providers = session.execute(stmt).scalars().all()

    results = []
    for metadata in providers:
        try:
            result = scheduled_sync(session, metadata.provider_slug)
            results.append({"provider": metadata.provider_slug, "result": result})
        except Exception as e:
            results.append({"provider": metadata.provider_slug, "error": str(e)})

    return results


# Pattern 4: Dry-run validation before sync
def validate_before_sync(session, provider_slug):
    """Test sync without writing to database."""
    syncer = ModelSyncer(session)

    result = syncer.sync_provider_models(
        provider_slug=provider_slug,
        dry_run=True
    )

    print(f"Dry run: {result['models_synced']} models would be synced")
    return result


# ============================================================================
# RULE FORMATS
# ============================================================================

# JMESPath Rule Examples
JMESPATH_RULES = {
    "openai": "data[*]",
    "anthropic": "models[*]",
    "root_array": "[*]",
    "nested": "response.models[*]"
}

# Capability Rule Examples
CAPABILITY_RULES = {
    "chat": {
        "capability": "chat",
        "patterns": {
            "regex": ["gpt-.*", "claude-.*", "gemini-.*"],
            "lookup_table": {
                "custom-chat-v1": ["chat", "vision"]
            }
        }
    },
    "embedding": {
        "capability": "embedding",
        "patterns": {
            "regex": [".*-embedding-.*", "embed-.*"]
        }
    },
    "vision": {
        "capability": "vision",
        "patterns": {
            "regex": ["gpt-4.*", "claude-3-.*", "gemini-.*-vision.*"]
        }
    }
}


# ============================================================================
# TESTING
# ============================================================================

# Test rule generation
def test_rule_generation():
    generator = RuleGenerator()

    sample = {
        "data": [
            {"id": "model-1", "name": "Model 1"},
            {"id": "model-2", "name": "Model 2"}
        ]
    }

    result = generator.analyze_sample(sample)

    assert result["jmespath_rule"] == "data[*]"
    assert len(result["capability_rules"]) >= 0
    assert result["metadata"]["sample_model_count"] == 2


# Test validation
def test_validation():
    validator = RuleValidator()

    rule = {
        "jmespath_rule": "data[*]",
        "capability_rules": []
    }

    sample = {
        "data": [{"id": "test-model"}]
    }

    result = validator.validate_rule(rule, sample)

    assert result["valid"] == True
    assert len(result["extracted_models"]) == 1


# ============================================================================
# DEBUGGING
# ============================================================================

# Enable debug logging
import logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("app.services.provider")
logger.setLevel(logging.DEBUG)


# Check what was extracted
def debug_extraction(rule, sample):
    import jmespath

    expression = rule["jmespath_rule"]
    result = jmespath.search(expression, sample)

    print(f"Expression: {expression}")
    print(f"Extracted: {result}")
    print(f"Type: {type(result)}")

    return result


# Check capability matches
def debug_capabilities(model_id, rules):
    matcher = CapabilityMatcher()

    for rule in rules:
        matches = matcher._matches_patterns(model_id, rule)
        print(f"Rule: {rule['capability']}")
        print(f"Model: {model_id}")
        print(f"Matches: {matches}")
        print()


# ============================================================================
# PERFORMANCE TIPS
# ============================================================================

# 1. Batch operations
# Use sync_all_active_providers() for bulk syncs

# 2. Dry-run first
# Test rules with dry_run=True before production sync

# 3. Cache results
# Cache extracted models between validation and upsert

# 4. Rate limiting
# Use ModelSyncer(session, http_timeout=30) for slow providers

# 5. Error recovery
# Let syncer create tasks automatically - don't retry manually


if __name__ == "__main__":
    print(__doc__)
    print("\nSee README.md for detailed documentation")
    print("See example_usage.py for comprehensive examples")
