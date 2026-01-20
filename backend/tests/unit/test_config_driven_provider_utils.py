from app.services.providers.config_utils import deep_merge, extract_by_path


def test_deep_merge_merge_patch():
    base = {"headers": {"A": "1", "B": "2"}, "keep": True}
    override = {"headers": {"B": "3", "C": "4"}}
    merged = deep_merge(base, override)
    assert merged["headers"] == {"A": "1", "B": "3", "C": "4"}
    assert merged["keep"] is True


def test_deep_merge_delete_key():
    base = {"a": 1, "b": {"c": 2, "d": 3}}
    override = {"b": {"c": None}}
    merged = deep_merge(base, override)
    assert merged["b"] == {"d": 3}


def test_extract_by_path_dot_and_index():
    data = {"body": {"output": {"images": [{"url": "u1"}, {"url": "u2"}]}}}
    assert extract_by_path(data, "body.output.images.0.url") == "u1"
    assert extract_by_path(data, "body.output.images.1.url") == "u2"
