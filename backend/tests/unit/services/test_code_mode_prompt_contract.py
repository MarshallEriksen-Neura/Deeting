from app.services.code_mode.prompt_contract import render_code_mode_capability_prompt


def test_render_code_mode_capability_prompt_replaces_allowlist_placeholder():
    prompt = render_code_mode_capability_prompt("`search_sdk`, `execute_code_plan`")

    assert "{{allowed_direct_tools}}" not in prompt
    assert "`search_sdk`" in prompt
    assert "`execute_code_plan`" in prompt
