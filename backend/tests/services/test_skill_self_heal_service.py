from app.schemas.skill_self_heal import SkillSelfHealResult


def test_self_heal_result_schema():
    payload = {
        "request": {
            "skill_id": "core.tools.docx",
            "manifest_json": {"name": "docx"},
            "logs": ["dry run failed"],
        },
        "response": {
            "status": "success",
            "summary": "added example code",
            "patches": [
                {
                    "path": "usage_spec.example_code",
                    "action": "set",
                    "value": "print('ok')",
                }
            ],
            "updated_manifest": {"name": "docx", "usage_spec": {"example_code": "print('ok')"}},
        },
    }

    result = SkillSelfHealResult(**payload)

    assert result.request.skill_id == "core.tools.docx"
    assert result.request.logs == ["dry run failed"]
    assert result.response.status == "success"
    assert result.response.patches[0].path == "usage_spec.example_code"
    assert result.response.warnings == []
