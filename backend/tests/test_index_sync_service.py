from app.services.indexing.index_sync_service import compute_delta, stable_fingerprint


def test_compute_delta_upsert_and_delete():
    old_items = [
        {"name": "a", "value": 1},
        {"name": "b", "value": 2},
    ]
    new_items = [
        {"name": "a", "value": 1},
        {"name": "c", "value": 3},
    ]

    delta = compute_delta(
        old_items,
        new_items,
        key_fn=lambda item: item["name"],
        fingerprint_fn=lambda item: stable_fingerprint(item),
    )

    assert [item["name"] for item in delta.to_upsert] == ["c"]
    assert [item["name"] for item in delta.to_delete] == ["b"]


def test_compute_delta_detects_modified_item():
    old_items = [{"name": "a", "value": 1}]
    new_items = [{"name": "a", "value": 2}]

    delta = compute_delta(
        old_items,
        new_items,
        key_fn=lambda item: item["name"],
        fingerprint_fn=lambda item: stable_fingerprint(item),
    )

    assert [item["name"] for item in delta.to_upsert] == ["a"]
    assert delta.to_delete == []
