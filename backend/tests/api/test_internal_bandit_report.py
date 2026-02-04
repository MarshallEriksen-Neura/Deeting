import pytest
from uuid import uuid4

from app.deps.auth import get_current_user
from app.models import User
from app.models.bandit import BanditArmState
from app.models.skill_registry import SkillRegistry
from main import app


@pytest.mark.asyncio
async def test_internal_bandit_skill_report_filters(
    client,
    AsyncSessionLocal,
):
    async def fake_user():
        return User(
            id=uuid4(),
            email="tester@example.com",
            username="tester",
            hashed_password="",
            is_active=True,
            is_superuser=True,
        )

    app.dependency_overrides[get_current_user] = fake_user
    try:
        async with AsyncSessionLocal() as session:
            session.add_all(
                [
                    SkillRegistry(
                        id="skill.active",
                        name="Active Skill",
                        status="active",
                        manifest_json={},
                        env_requirements={},
                    ),
                    SkillRegistry(
                        id="skill.disabled",
                        name="Disabled Skill",
                        status="disabled",
                        manifest_json={},
                        env_requirements={},
                    ),
                ]
            )
            session.add_all(
                [
                    BanditArmState(
                        scene="retrieval:skill",
                        arm_id="skill__skill.active",
                        total_trials=10,
                        successes=7,
                        failures=3,
                        reward_metric_type="task_success",
                    ),
                    BanditArmState(
                        scene="retrieval:skill",
                        arm_id="skill__skill.disabled",
                        total_trials=5,
                        successes=1,
                        failures=4,
                        reward_metric_type="task_success",
                    ),
                ]
            )
            await session.commit()

        resp = await client.get("/api/v1/internal/bandit/report/skills?status=active")
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["total_arms"] == 1
        assert data["items"][0]["skill_id"] == "skill.active"

        resp = await client.get("/api/v1/internal/bandit/report/skills?skill_id=skill.disabled")
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["total_arms"] == 1
        assert data["items"][0]["skill_id"] == "skill.disabled"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
