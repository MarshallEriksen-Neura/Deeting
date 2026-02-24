from __future__ import annotations

import hashlib
import time
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.user_document import UserDocument
from app.services.oss.asset_storage_service import StoredAsset


@pytest.mark.asyncio
async def test_user_document_mvp_lifecycle(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    task_calls: list[str] = []

    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    def fake_send_task(task_name: str, args: list[str] | None = None, **kwargs):
        assert task_name == "app.tasks.document.index_user_document_task"
        if args:
            task_calls.append(args[0])

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        fake_send_task,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Contracts", "parent_id": None},
        headers=headers,
    )
    assert folder_resp.status_code == 201
    folder_id = folder_resp.json()["id"]

    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("contract.txt", b"hello world", "text/plain")},
        data={"folder_id": folder_id},
        headers=headers,
    )
    assert upload_resp.status_code == 201
    uploaded = upload_resp.json()
    file_id = uploaded["id"]
    assert uploaded["status"] == "processing"
    assert task_calls and task_calls[0] == file_id

    tree_resp = await client.get(
        "/api/v1/documents/tree",
        params={"parent_id": folder_id},
        headers=headers,
    )
    assert tree_resp.status_code == 200
    tree_data = tree_resp.json()
    assert len(tree_data["files"]) == 1
    assert tree_data["files"][0]["id"] == file_id

    stats_resp = await client.get("/api/v1/documents/stats", headers=headers)
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["total_files"] == 1
    assert stats["total_folders"] == 1
    assert stats["used_bytes"] >= 11

    update_resp = await client.patch(
        f"/api/v1/documents/files/{file_id}",
        json={"name": "contract-v2.txt", "folder_id": None},
        headers=headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "contract-v2.txt"
    assert updated["folder_id"] is None

    retry_resp = await client.post(
        f"/api/v1/documents/files/{file_id}/retry",
        headers=headers,
    )
    assert retry_resp.status_code == 200
    assert retry_resp.json()["status"] == "processing"
    assert len(task_calls) == 2

    delete_file_resp = await client.delete(
        f"/api/v1/documents/files/{file_id}",
        headers=headers,
    )
    assert delete_file_resp.status_code == 204

    delete_folder_resp = await client.delete(
        f"/api/v1/documents/folders/{folder_id}",
        headers=headers,
    )
    assert delete_folder_resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_non_empty_folder_requires_recursive(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.qdrant_is_configured",
        lambda: False,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Need Recursive", "parent_id": None},
        headers=headers,
    )
    assert folder_resp.status_code == 201
    folder_id = folder_resp.json()["id"]

    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("notes.md", b"# hello", "text/markdown")},
        data={"folder_id": folder_id},
        headers=headers,
    )
    assert upload_resp.status_code == 201

    delete_resp = await client.delete(
        f"/api/v1/documents/folders/{folder_id}",
        headers=headers,
    )
    assert delete_resp.status_code == 409

    delete_recursive_resp = await client.delete(
        f"/api/v1/documents/folders/{folder_id}",
        params={"recursive": "true"},
        headers=headers,
    )
    assert delete_recursive_resp.status_code == 200


@pytest.mark.asyncio
async def test_copy_file_creates_new_document_and_enqueues_index_task(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    task_calls: list[str] = []

    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    def fake_send_task(task_name: str, args: list[str] | None = None, **kwargs):
        assert task_name == "app.tasks.document.index_user_document_task"
        if args:
            task_calls.append(args[0])

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        fake_send_task,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    source_folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Source", "parent_id": None},
        headers=headers,
    )
    assert source_folder_resp.status_code == 201
    source_folder_id = source_folder_resp.json()["id"]

    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("kb.txt", b"copy me", "text/plain")},
        data={"folder_id": source_folder_id},
        headers=headers,
    )
    assert upload_resp.status_code == 201
    source_file_id = upload_resp.json()["id"]
    assert len(task_calls) == 1

    copy_resp = await client.post(
        f"/api/v1/documents/files/{source_file_id}/copy",
        json={"folder_id": None},
        headers=headers,
    )
    assert copy_resp.status_code == 201
    copied = copy_resp.json()
    copied_file_id = copied["id"]
    assert copied["name"] == "kb-copy.txt"
    assert copied["status"] == "processing"
    assert copied["folder_id"] is None
    assert len(task_calls) == 2
    assert task_calls[1] == copied_file_id

    async with AsyncSessionLocal() as session:
        source_doc = await session.get(UserDocument, UUID(source_file_id))
        copied_doc = await session.get(UserDocument, UUID(copied_file_id))
        assert source_doc is not None
        assert copied_doc is not None
        assert source_doc.media_asset_id == copied_doc.media_asset_id
        assert copied_doc.meta_info.get("copied_from_doc_id") == source_file_id


@pytest.mark.asyncio
async def test_share_file_returns_signed_url_with_custom_ttl(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.qdrant_is_configured",
        lambda: False,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("share.txt", b"share me", "text/plain")},
        headers=headers,
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    before = int(time.time())
    share_resp = await client.post(
        f"/api/v1/documents/files/{file_id}/share",
        json={"expires_seconds": 90},
        headers=headers,
    )
    after = int(time.time())

    assert share_resp.status_code == 200
    share_url = share_resp.json()["share_url"]
    assert "/api/v1/media/assets/" in share_url

    query = parse_qs(urlparse(share_url).query)
    assert "sig" in query
    assert "expires" in query
    expires = int(query["expires"][0])
    assert before + 80 <= expires <= after + 95


@pytest.mark.asyncio
async def test_batch_move_and_delete_files(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.qdrant_is_configured",
        lambda: False,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    source_folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Batch Source", "parent_id": None},
        headers=headers,
    )
    assert source_folder_resp.status_code == 201
    source_folder_id = source_folder_resp.json()["id"]

    target_folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Batch Target", "parent_id": None},
        headers=headers,
    )
    assert target_folder_resp.status_code == 201
    target_folder_id = target_folder_resp.json()["id"]

    upload_a = await client.post(
        "/api/v1/documents/files",
        files={"file": ("a.txt", b"batch-a", "text/plain")},
        data={"folder_id": source_folder_id},
        headers=headers,
    )
    upload_b = await client.post(
        "/api/v1/documents/files",
        files={"file": ("b.txt", b"batch-b", "text/plain")},
        data={"folder_id": source_folder_id},
        headers=headers,
    )
    assert upload_a.status_code == 201
    assert upload_b.status_code == 201
    file_ids = [upload_a.json()["id"], upload_b.json()["id"]]
    missing_id = str(uuid4())

    move_resp = await client.post(
        "/api/v1/documents/files/batch/move",
        json={"file_ids": [*file_ids, missing_id], "folder_id": target_folder_id},
        headers=headers,
    )
    assert move_resp.status_code == 200
    move_data = move_resp.json()
    moved_files = move_data["files"]
    assert len(moved_files) == 2
    assert {item["folder_id"] for item in moved_files} == {target_folder_id}
    assert len(move_data["failed"]) == 1
    assert move_data["failed"][0]["file_id"] == missing_id
    assert move_data["failed"][0]["reason"] == "not_found"

    delete_resp = await client.post(
        "/api/v1/documents/files/batch/delete",
        json={"file_ids": [*file_ids, missing_id]},
        headers=headers,
    )
    assert delete_resp.status_code == 200
    delete_data = delete_resp.json()
    assert delete_data["deleted_count"] == 2
    assert len(delete_data["failed"]) == 1
    assert delete_data["failed"][0]["file_id"] == missing_id
    assert delete_data["failed"][0]["reason"] == "not_found"

    for file_id in file_ids:
        get_resp = await client.get(
            f"/api/v1/documents/files/{file_id}",
            headers=headers,
        )
        assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_batch_retry_files_reenqueue_index_task(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    task_calls: list[str] = []

    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    def fake_send_task(task_name: str, args: list[str] | None = None, **kwargs):
        assert task_name == "app.tasks.document.index_user_document_task"
        if args:
            task_calls.append(args[0])

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        fake_send_task,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    upload_a = await client.post(
        "/api/v1/documents/files",
        files={"file": ("retry-a.txt", b"retry-a", "text/plain")},
        headers=headers,
    )
    upload_b = await client.post(
        "/api/v1/documents/files",
        files={"file": ("retry-b.txt", b"retry-b", "text/plain")},
        headers=headers,
    )
    assert upload_a.status_code == 201
    assert upload_b.status_code == 201
    file_ids = [upload_a.json()["id"], upload_b.json()["id"]]
    upload_task_count = len(task_calls)

    async with AsyncSessionLocal() as session:
        for file_id in file_ids:
            doc = await session.get(UserDocument, UUID(file_id))
            assert doc is not None
            doc.status = "failed"
            doc.error_message = "failed before retry"
            doc.chunk_count = 5
        await session.commit()

    retry_resp = await client.post(
        "/api/v1/documents/files/batch/retry",
        json={"file_ids": file_ids},
        headers=headers,
    )
    assert retry_resp.status_code == 200
    retried_files = retry_resp.json()["files"]
    assert len(retried_files) == 2
    assert all(item["status"] == "processing" for item in retried_files)
    assert len(task_calls) == upload_task_count + 2
    assert set(task_calls[-2:]) == set(file_ids)

    async with AsyncSessionLocal() as session:
        for file_id in file_ids:
            doc = await session.get(UserDocument, UUID(file_id))
            assert doc is not None
            assert doc.status == "pending"
            assert doc.error_message is None
            assert int(doc.chunk_count or 0) == 0


@pytest.mark.asyncio
async def test_batch_retry_files_partial_failure_when_processing_and_not_found(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("retry-processing.txt", b"retry", "text/plain")},
        headers=headers,
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]
    missing_id = str(uuid4())

    async with AsyncSessionLocal() as session:
        doc = await session.get(UserDocument, UUID(file_id))
        assert doc is not None
        doc.status = "processing"
        await session.commit()

    retry_resp = await client.post(
        "/api/v1/documents/files/batch/retry",
        json={"file_ids": [file_id, missing_id]},
        headers=headers,
    )
    assert retry_resp.status_code == 200
    retry_data = retry_resp.json()
    assert retry_data["files"] == []
    assert len(retry_data["failed"]) == 2
    reasons = {item["file_id"]: item["reason"] for item in retry_data["failed"]}
    assert reasons[file_id] == "already_processing"
    assert reasons[missing_id] == "not_found"


@pytest.mark.asyncio
async def test_batch_share_files_returns_signed_urls(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    upload_a = await client.post(
        "/api/v1/documents/files",
        files={"file": ("share-a.txt", b"share-a", "text/plain")},
        headers=headers,
    )
    upload_b = await client.post(
        "/api/v1/documents/files",
        files={"file": ("share-b.txt", b"share-b", "text/plain")},
        headers=headers,
    )
    assert upload_a.status_code == 201
    assert upload_b.status_code == 201
    file_ids = [upload_a.json()["id"], upload_b.json()["id"]]
    missing_id = str(uuid4())

    before = int(time.time())
    share_resp = await client.post(
        "/api/v1/documents/files/batch/share",
        json={"file_ids": [*file_ids, missing_id], "expires_seconds": 120},
        headers=headers,
    )
    after = int(time.time())
    assert share_resp.status_code == 200

    share_data = share_resp.json()
    items = share_data["items"]
    assert len(items) == 2
    assert {item["file_id"] for item in items} == set(file_ids)
    assert len(share_data["failed"]) == 1
    assert share_data["failed"][0]["file_id"] == missing_id
    assert share_data["failed"][0]["reason"] == "not_found"
    for item in items:
        share_url = item["share_url"]
        assert "/api/v1/media/assets/" in share_url
        query = parse_qs(urlparse(share_url).query)
        assert "sig" in query
        assert "expires" in query
        expires = int(query["expires"][0])
        assert before + 110 <= expires <= after + 130


@pytest.mark.asyncio
async def test_batch_copy_files_preserve_folder_when_folder_not_provided(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    task_calls: list[str] = []

    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    def fake_send_task(task_name: str, args: list[str] | None = None, **kwargs):
        assert task_name == "app.tasks.document.index_user_document_task"
        if args:
            task_calls.append(args[0])

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        fake_send_task,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    folder_resp = await client.post(
        "/api/v1/documents/folders",
        json={"name": "Keep Source Folder", "parent_id": None},
        headers=headers,
    )
    assert folder_resp.status_code == 201
    folder_id = folder_resp.json()["id"]

    folder_upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("folder-file.txt", b"in-folder", "text/plain")},
        data={"folder_id": folder_id},
        headers=headers,
    )
    root_upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("root-file.txt", b"in-root", "text/plain")},
        headers=headers,
    )
    assert folder_upload_resp.status_code == 201
    assert root_upload_resp.status_code == 201
    source_ids = [folder_upload_resp.json()["id"], root_upload_resp.json()["id"]]
    missing_id = str(uuid4())
    upload_task_count = len(task_calls)

    copy_resp = await client.post(
        "/api/v1/documents/files/batch/copy",
        json={"file_ids": [*source_ids, missing_id]},
        headers=headers,
    )
    assert copy_resp.status_code == 201

    copy_data = copy_resp.json()
    copied_files = copy_data["files"]
    assert len(copied_files) == 2
    assert len(copy_data["failed"]) == 1
    assert copy_data["failed"][0]["file_id"] == missing_id
    assert copy_data["failed"][0]["reason"] == "not_found"
    copied_ids = [item["id"] for item in copied_files]
    assert all(item["status"] == "processing" for item in copied_files)
    assert len(task_calls) == upload_task_count + 2
    assert set(task_calls[-2:]) == set(copied_ids)

    async with AsyncSessionLocal() as session:
        for copied_id in copied_ids:
            copied_doc = await session.get(UserDocument, UUID(copied_id))
            assert copied_doc is not None
            source_doc_id = copied_doc.meta_info.get("copied_from_doc_id")
            assert source_doc_id is not None
            source_doc = await session.get(UserDocument, UUID(source_doc_id))
            assert source_doc is not None
            assert copied_doc.folder_id == source_doc.folder_id
            assert copied_doc.media_asset_id == source_doc.media_asset_id


@pytest.mark.asyncio
async def test_chunks_download_and_search(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    collection_calls: list[tuple[str | None, str]] = []

    async def fake_store_asset_bytes(data: bytes, **kwargs) -> StoredAsset:
        digest = hashlib.sha256(data).hexdigest()[:12]
        return StoredAsset(
            object_key=f"assets/test/{digest}-{len(data)}.txt",
            content_type="text/plain",
            size_bytes=len(data),
        )

    def fake_get_kb_user_collection_name(user_id, *, embedding_model=None):
        model = str(embedding_model).strip() if embedding_model else None
        collection_calls.append((model, str(user_id)))
        return f"kb::{model or 'none'}"

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.store_asset_bytes",
        fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.celery_app.send_task",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.get_kb_user_collection_name",
        fake_get_kb_user_collection_name,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    upload_resp = await client.post(
        "/api/v1/documents/files",
        files={"file": ("kb.txt", b"chunk a\nchunk b", "text/plain")},
        headers=headers,
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(UserDocument).where(UserDocument.id == UUID(file_id)))
        doc = result.scalar_one()
        doc.status = "indexed"
        doc.chunk_count = 2
        doc.embedding_model = "doc-embed-v1"
        await session.commit()

    async def fake_scroll_points(*args, **kwargs):
        assert kwargs["collection_name"] == "kb::doc-embed-v1"
        return (
            [
                {
                    "id": "p2",
                    "payload": {"chunk_index": 1, "text": "second chunk"},
                },
                {
                    "id": "p1",
                    "payload": {"chunk_index": 0, "text": "first chunk"},
                },
            ],
            None,
        )

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.get_qdrant_client",
        lambda: object(),
    )
    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.scroll_points",
        fake_scroll_points,
    )

    async def fake_embed_text(self, _query: str):
        self.model = "query-embed-v2"
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.EmbeddingService.embed_text",
        fake_embed_text,
    )

    chunks_resp = await client.get(
        f"/api/v1/documents/files/{file_id}/chunks",
        params={"offset": 0, "limit": 20},
        headers=headers,
    )
    assert chunks_resp.status_code == 200
    chunks_data = chunks_resp.json()
    assert chunks_data["total"] == 2
    assert chunks_data["items"][0]["index"] == 0
    assert chunks_data["items"][1]["index"] == 1

    download_resp = await client.get(
        f"/api/v1/documents/files/{file_id}/download-url",
        headers=headers,
    )
    assert download_resp.status_code == 200
    assert "download_url" in download_resp.json()

    async def fake_search_points(*args, **kwargs):
        assert kwargs["collection_name"] == "kb::query-embed-v2"
        return [
            {
                "score": 0.91,
                "payload": {
                    "text": "matched",
                    "filename": "kb.txt",
                    "page": 0,
                    "doc_id": file_id,
                },
            }
        ]

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.search_points",
        fake_search_points,
    )

    async def fake_delete_points(*args, **kwargs):
        assert kwargs["collection_name"] == "kb::doc-embed-v1"
        must_filters = kwargs["query_filter"]["must"]
        assert {"key": "doc_id", "match": {"value": file_id}} in must_filters

    monkeypatch.setattr(
        "app.services.knowledge.user_document_service.delete_points",
        fake_delete_points,
    )

    search_resp = await client.post(
        "/api/v1/documents/search",
        json={"query": "matched", "limit": 5},
        headers=headers,
    )
    assert search_resp.status_code == 200
    search_data = search_resp.json()
    assert len(search_data) == 1
    assert search_data[0]["filename"] == "kb.txt"

    delete_resp = await client.delete(
        f"/api/v1/documents/files/{file_id}",
        headers=headers,
    )
    assert delete_resp.status_code == 204
    called_models = {item[0] for item in collection_calls}
    assert "doc-embed-v1" in called_models
    assert "query-embed-v2" in called_models
