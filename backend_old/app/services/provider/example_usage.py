"""
Usage Example: Provider Model Synchronization

This example demonstrates the complete workflow:
1. Generate rules from sample /models response
2. Validate rules
3. Synchronize models to database

Note: This is a documentation example. In production, run through service endpoints.
"""

from __future__ import annotations

from app.services.provider import (
    CapabilityMatcher,
    ModelSyncer,
    RuleGenerator,
    RuleValidator,
)


def example_rule_generation():
    """Example 1: Generate rules from sample response."""
    print("=== Example 1: Rule Generation ===\n")

    # Sample /models response from OpenAI-style provider
    sample_response = {
        "object": "list",
        "data": [
            {
                "id": "gpt-4-turbo-preview",
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

    generator = RuleGenerator()
    result = generator.analyze_sample(sample_response)

    print(f"Generated JMESPath rule: {result['jmespath_rule']}")
    print(f"Number of capability rules: {len(result['capability_rules'])}")
    print(f"Sample model count: {result['metadata']['sample_model_count']}")
    print("\nCapability rules:")
    for rule in result["capability_rules"]:
        print(f"  - {rule['capability']}: {rule['patterns']['regex']}")


def example_rule_validation():
    """Example 2: Validate rules against sample."""
    print("\n=== Example 2: Rule Validation ===\n")

    rule = {
        "jmespath_rule": "data[*]",
        "capability_rules": [
            {
                "capability": "chat",
                "patterns": {
                    "regex": ["gpt-.*", "claude-.*"],
                },
            },
            {
                "capability": "embedding",
                "patterns": {
                    "regex": [".*-embedding-.*"],
                },
            },
        ],
    }

    sample = {
        "data": [
            {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
            {"id": "text-embedding-ada-002", "name": "Ada Embedding"},
        ]
    }

    validator = RuleValidator()
    result = validator.validate_rule(rule, sample)

    print(f"Validation result: {'PASSED' if result['valid'] else 'FAILED'}")
    print(f"Extracted models: {result['metadata']['model_count']}")
    print(f"Models with capabilities: {result['metadata']['models_with_capabilities']}")

    if result["issues"]:
        print("\nIssues found:")
        for issue in result["issues"]:
            print(f"  - [{issue['type']}] {issue['message']}")

    print("\nCapability matches:")
    for model_id, capabilities in result["matched_capabilities"].items():
        print(f"  - {model_id}: {capabilities}")


def example_capability_matching():
    """Example 3: Match capabilities for models."""
    print("\n=== Example 3: Capability Matching ===\n")

    rules = [
        {
            "capability": "chat",
            "patterns": {
                "regex": ["gpt-.*", "claude-.*", "gemini-.*"],
            },
        },
        {
            "capability": "vision",
            "patterns": {
                "regex": ["gpt-4.*", "claude-3-.*", "gemini-.*-vision.*"],
            },
        },
        {
            "capability": "embedding",
            "patterns": {
                "regex": [".*-embedding-.*", "embed-.*"],
            },
        },
    ]

    matcher = CapabilityMatcher()

    test_models = [
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "claude-3-opus",
        "gemini-pro-vision",
        "text-embedding-ada-002",
    ]

    print("Model capability matches:")
    for model_name in test_models:
        capabilities = matcher.match_capabilities(model_name, rules)
        print(f"  - {model_name}: {capabilities}")


def example_sync_flow():
    """Example 4: Complete sync flow (pseudo-code)."""
    print("\n=== Example 4: Complete Sync Flow (Conceptual) ===\n")

    print("Step 1: Admin provides sample /models response")
    print("Step 2: RuleGenerator.analyze_sample() → generates rules")
    print("Step 3: Store rules in ProviderMetadata.model_list_config")
    print("Step 4: ModelSyncer.sync_provider_models(provider_slug)")
    print("  4a: Fetch /models response")
    print("  4b: Validate rules against response")
    print("  4c: If valid, extract models and match capabilities")
    print("  4d: Upsert models to ProviderModel table")
    print("  4e: If invalid, create RULE_GEN agent task")
    print("\nResult: Models are synchronized and ready for routing")


def example_error_handling():
    """Example 5: Error handling patterns."""
    print("\n=== Example 5: Error Handling ===\n")

    from app.services.provider.rule_generator import InvalidSampleError
    from app.services.provider.rule_validator import ValidationFailedError

    generator = RuleGenerator()

    # Test invalid sample
    try:
        generator.analyze_sample({"status": "ok"})
    except InvalidSampleError as e:
        print(f"Caught InvalidSampleError: {e.reason}")

    # Test invalid rule
    validator = RuleValidator()
    try:
        validator.validate_rule({}, {"data": []})
    except ValidationFailedError as e:
        print(f"Caught ValidationFailedError: {e.reason}")

    print("\nError handling: Graceful degradation with task generation")


if __name__ == "__main__":
    example_rule_generation()
    example_rule_validation()
    example_capability_matching()
    example_sync_flow()
    example_error_handling()

    print("\n" + "=" * 60)
    print("Provider service package implementation complete!")
    print("=" * 60)
