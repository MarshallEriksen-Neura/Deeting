from app.schemas.bandit import BanditArmReport


def test_bandit_report_schema_accepts_scene_and_arm_id():
    item = BanditArmReport(
        instance_id="i1",
        provider_model_id="m1",
        provider="demo",
        capability="chat",
        model="gpt",
        scene="router:llm",
        arm_id="m1",
        reward_metric_type="latency_success",
        strategy="epsilon_greedy",
        epsilon=0.1,
        alpha=1.0,
        beta=1.0,
        total_trials=0,
        successes=0,
        failures=0,
        success_rate=0.0,
        selection_ratio=0.0,
        avg_latency_ms=0.0,
        latency_p95_ms=None,
        total_cost=0.0,
        last_reward=0.0,
        cooldown_until=None,
        weight=0,
        priority=0,
        version=1,
    )

    assert item.scene == "router:llm"
