from app.services.workflow.steps.upstream_call import StreamTokenAccumulator


def test_stream_token_accumulator_collects_assistant_text() -> None:
    acc = StreamTokenAccumulator()

    acc.parse_sse_chunk(b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    acc.parse_sse_chunk(b'data: {"choices":[{"delta":{"content":" World"}}]}\n\n')

    assert acc.assistant_text == "Hello World"
