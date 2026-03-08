from app.models.provider_preset import ProviderPreset


def test_provider_preset_model_exposes_only_v2_protocol_fields():
    column_names = {column.name for column in ProviderPreset.__table__.columns}

    assert "protocol_schema_version" in column_names
    assert "protocol_profiles" in column_names

    assert "template_engine" not in column_names
    assert "response_transform" not in column_names
    assert "default_headers" not in column_names
    assert "default_params" not in column_names
    assert "capability_configs" not in column_names
