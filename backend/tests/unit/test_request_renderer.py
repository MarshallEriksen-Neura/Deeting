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
