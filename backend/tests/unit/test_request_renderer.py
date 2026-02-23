from app.services.providers.request_renderer import request_renderer


def test_render_jinja2_accepts_python_none_test_syntax():
    rendered = request_renderer._render_jinja2(
        {"flag": "{{ 1 if input.temperature is None else 0 }}"},
        {"input": {"temperature": None}},
    )
    assert rendered["flag"] == "1"


def test_render_jinja2_accepts_python_true_test_syntax():
    rendered = request_renderer._render_jinja2(
        {"flag": "{{ 1 if input.stream is True else 0 }}"},
        {"input": {"stream": True}},
    )
    assert rendered["flag"] == "1"


def test_render_jinja2_tojson_fields_keep_native_types():
    rendered = request_renderer._render_jinja2(
        {
            "messages": "{{ input.messages | tojson }}",
            "stream": "{{ input.stream | default(false) | tojson }}",
        },
        {"input": {"messages": [{"role": "user", "content": "hi"}], "stream": False}},
    )
    assert rendered["messages"] == [{"role": "user", "content": "hi"}]
    assert rendered["stream"] is False


def test_render_jinja2_supports_input_alias_and_model_uid():
    class MockConfig:
        template_engine = "jinja2"
        request_template = {
            "prompt": "{{ input.prompt }}",
            "model": "{{ input.model or model.uid }}",
        }

    rendered = request_renderer.render(
        item_config=MockConfig(),
        internal_req={
            "model": "Qwen/Qwen-Image-Edit",
            "prompt": "hello",
        },
    )

    assert rendered["prompt"] == "hello"
    assert rendered["model"] == "Qwen/Qwen-Image-Edit"


def test_render_simple_merge_only_fills_declared_template_fields():
    class MockConfig:
        template_engine = "simple_replace"
        request_template = {
            "model": None,
            "messages": None,
            "stream": None,
        }

    rendered = request_renderer.render(
        item_config=MockConfig(),
        internal_req={
            "model": "deepseek-v3.1",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "temperature": 0.8,
        },
        extra_context={"provider": "custom"},
    )

    assert rendered == {
        "model": "deepseek-v3.1",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
    }
    assert "input" not in rendered
    assert "request" not in rendered
    assert "provider" not in rendered
    assert "temperature" not in rendered


def test_render_simple_merge_falls_back_to_request_namespace():
    rendered = request_renderer._render_simple_merge(
        {"max_tokens": None},
        {"request": {"max_tokens": 256}},
    )
    assert rendered == {"max_tokens": 256}
