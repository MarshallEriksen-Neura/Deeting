# Provider Service Package

Provider metadata and model synchronization services for universal provider support.

## Overview

This package implements automated rule generation and model synchronization for provider integration:

1. **RuleGenerator**: Analyzes sample /models responses to generate JMESPath extraction rules and capability patterns
2. **RuleValidator**: Validates extraction rules against sample data
3. **CapabilityMatcher**: Matches model capabilities based on regex patterns and lookup tables
4. **ModelSyncer**: Orchestrates model synchronization with rule validation and auto-regeneration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Provider Model Sync Flow                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Admin submits sample /models response                        │
│     └─> RuleGenerator.analyze_sample()                           │
│         ├─> Generate JMESPath rule (e.g., "data[*]")            │
│         └─> Generate capability rules (regex patterns)           │
│                                                                   │
│  2. Store rules in ProviderMetadata.model_list_config            │
│                                                                   │
│  3. Scheduled sync: ModelSyncer.sync_provider_models()           │
│     ├─> Fetch live /models response                              │
│     ├─> RuleValidator.validate_rule()                            │
│     │   ├─> Extract models with JMESPath                         │
│     │   └─> Match capabilities with CapabilityMatcher            │
│     │                                                             │
│     ├─> IF valid:                                                │
│     │   └─> Upsert models to ProviderModel table                 │
│     │                                                             │
│     └─> IF invalid:                                              │
│         ├─> Block database write                                 │
│         └─> Create AgentTask(RULE_GEN) for regeneration          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### RuleGenerator

Generates extraction rules from sample responses.

**Input**: Sample /models JSON response
**Output**: JMESPath rule + capability patterns

```python
from app.services.provider import RuleGenerator

generator = RuleGenerator()
sample = {
    "data": [
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
        {"id": "text-embedding-ada-002", "name": "Ada"}
    ]
}

result = generator.analyze_sample(sample)
# {
#   "jmespath_rule": "data[*]",
#   "capability_rules": [
#     {
#       "capability": "chat",
#       "patterns": {"regex": ["gpt-.*"]}
#     }
#   ],
#   "metadata": {"sample_model_count": 2, ...}
# }
```

### RuleValidator

Validates rules against sample data.

```python
from app.services.provider import RuleValidator

validator = RuleValidator()
rule = {
    "jmespath_rule": "data[*]",
    "capability_rules": [...]
}
sample = {"data": [...]}

result = validator.validate_rule(rule, sample)
# {
#   "valid": True,
#   "extracted_models": [...],
#   "matched_capabilities": {"model-id": ["chat"]},
#   "issues": []
# }
```

### CapabilityMatcher

Matches capabilities via regex or lookup table.

```python
from app.services.provider import CapabilityMatcher

matcher = CapabilityMatcher()
rules = [
    {
        "capability": "chat",
        "patterns": {"regex": ["gpt-.*", "claude-.*"]}
    }
]

capabilities = matcher.match_capabilities("gpt-4-turbo", rules)
# ["chat"]
```

### ModelSyncer

Orchestrates complete sync workflow.

```python
from app.services.provider import ModelSyncer
from sqlalchemy.orm import Session

syncer = ModelSyncer(session)
result = syncer.sync_provider_models(
    provider_slug="openai",
    created_by_id=user_id,
    dry_run=False
)
# {
#   "success": True,
#   "models_synced": 15,
#   "models_created": 3,
#   "models_updated": 12
# }
```

## Database Schema

### ProviderMetadata

```python
class ProviderMetadata:
    provider_slug: str          # Unique identifier
    base_url: str               # Base API URL
    auth_config: JSON           # Auth configuration
    model_list_config: JSON     # JMESPath rules
    endpoints_config: JSON      # Capability patterns
    version: str                # Rule version
```

**model_list_config format**:
```json
{
  "endpoint": "/v1/models",
  "selector": "data[*]",
  "fields": {
    "id": "id",
    "name": "name"
  }
}
```

**endpoints_config format** (capability patterns):
```json
{
  "chat": {
    "patterns": {
      "regex": ["gpt-.*", "claude-.*"],
      "lookup_table": {
        "custom-model": ["chat", "vision"]
      }
    }
  }
}
```

### ProviderModel

```python
class ProviderModel:
    provider_id: UUID           # FK to Provider
    model_id: str               # Model identifier
    display_name: str           # Human-readable name
    family: str                 # Model family (gpt/claude/etc)
    context_length: int         # Token limit
    capabilities: List[str]     # Matched capabilities
    metadata_json: JSON         # Raw model data
    meta_hash: str              # Change detection
```

## Error Handling

### Rule Validation Failure

When rules fail validation:
1. **Block write**: No models written to database
2. **Create task**: AgentTask with type=RULE_GEN, status=PENDING
3. **Store context**: Sample response and issues in task.config
4. **Raise error**: RuleValidationError with details

```python
try:
    syncer.sync_provider_models("provider-slug")
except RuleValidationError as e:
    # e.reason: "Rules failed validation..."
    # e.issues: [{"type": "extraction_failed", ...}]
    pass
```

### HTTP Errors

```python
try:
    syncer.sync_provider_models("provider-slug")
except ModelSyncerError as e:
    # Network errors, invalid responses, etc.
    pass
```

## Testing

```bash
# Run provider service tests
pytest tests/services/provider/ -v

# Run specific test
pytest tests/services/provider/test_rule_generator.py::TestRuleGenerator::test_analyze_openai_style_response -v
```

## Usage Patterns

### Pattern 1: Initial Setup

1. Admin provides sample /models response
2. RuleGenerator creates extraction rules
3. Rules stored in ProviderMetadata
4. Ready for automatic sync

### Pattern 2: Scheduled Sync

1. Cron job triggers sync
2. ModelSyncer fetches live data
3. Rules validated against live response
4. Models upserted on success
5. Task created on failure

### Pattern 3: Rule Regeneration

1. Sync fails validation
2. RULE_GEN task created
3. Agent analyzes new sample
4. Updated rules saved
5. Next sync uses new rules

## Integration Points

### API Endpoints (to be implemented)

```
POST /api/providers/{slug}/metadata/generate-rules
  Body: {"sample_response": {...}}
  Returns: Generated rules

POST /api/providers/{slug}/sync-models
  Triggers: Manual model sync
  Returns: Sync result

GET /api/providers/{slug}/models
  Returns: Synced models for provider
```

### Celery Tasks (to be implemented)

```python
@celery_app.task
def sync_all_providers():
    """Sync models for all active providers."""
    pass

@celery_app.task
def regenerate_provider_rules(task_id: UUID):
    """Regenerate rules for failed validation."""
    pass
```

## Future Enhancements

1. **Rule versioning**: Track rule changes over time
2. **A/B testing**: Test new rules before deployment
3. **Auto-detection**: Detect provider type from response structure
4. **ML patterns**: Learn patterns from historical data
5. **Multi-endpoint**: Support multiple model list endpoints

## See Also

- `example_usage.py`: Comprehensive usage examples
- `../provider_validation_service.py`: Provider health checks
- `../../models/provider_metadata.py`: Metadata model definition
