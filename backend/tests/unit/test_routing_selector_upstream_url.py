from app.services.providers.upstream_url import build_upstream_url


def test_build_upstream_url_openai_appends_v1() -> None:
    url = build_upstream_url(
        base_url="https://api.example.com",
        upstream_path="chat/completions",
        protocol="openai",
    )
    assert url == "https://api.example.com/v1/chat/completions"


def test_build_upstream_url_openai_keeps_v1() -> None:
    url = build_upstream_url(
        base_url="https://api.example.com/v1",
        upstream_path="chat/completions",
        protocol="openai",
    )
    assert url == "https://api.example.com/v1/chat/completions"


def test_build_upstream_url_openai_versioned_base_skips_v1() -> None:
    url = build_upstream_url(
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        upstream_path="chat/completions",
        protocol="openai",
    )
    assert url == "https://ark.cn-beijing.volces.com/api/v3/chat/completions"


def test_build_upstream_url_non_openai_no_v1() -> None:
    url = build_upstream_url(
        base_url="https://api.anthropic.com",
        upstream_path="v1/messages",
        protocol="anthropic",
    )
    assert url == "https://api.anthropic.com/v1/messages"


def test_build_upstream_url_empty_path_returns_base() -> None:
    url = build_upstream_url(
        base_url="https://api.example.com/v1",
        upstream_path="",
        protocol="openai",
    )
    assert url == "https://api.example.com/v1"


def test_build_upstream_url_openai_no_append() -> None:
    url = build_upstream_url(
        base_url="https://api.example.com",
        upstream_path="chat/completions",
        protocol="openai",
        auto_append_v1=False,
    )
    assert url == "https://api.example.com/chat/completions"
