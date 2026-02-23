from app.api.v1.admin.memory_route import router as admin_memory_router
from app.api.v1.memory_route import router as user_memory_router


def test_memory_route_prefixes_do_not_conflict() -> None:
    assert user_memory_router.prefix == "/memory"
    assert admin_memory_router.prefix == "/admin/memory"
