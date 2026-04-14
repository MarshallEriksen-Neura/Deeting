use super::types::TaskFingerprint;

fn contains_any(normalized: &str, values: &[&str]) -> bool {
    values.iter().any(|value| normalized.contains(value))
}

pub(crate) fn build_task_fingerprint(query: &str) -> TaskFingerprint {
    let normalized = query.trim().to_lowercase();

    let goal_shape = if contains_any(
        &normalized,
        &[
            "analyze",
            "analysis",
            "investigate",
            "compare",
            "difference",
            "risk",
            "boundary",
            "diagnose",
            "diagnosis",
            "trace",
            "排查",
            "分析",
            "调查",
            "对比",
            "风险",
            "边界",
        ],
    ) {
        "investigate"
    } else if contains_any(
        &normalized,
        &[
            "fix", "repair", "debug", "failure", "error", "broken", "修复", "排错", "报错", "故障",
        ],
    ) {
        "repair"
    } else if contains_any(
        &normalized,
        &[
            "migrate",
            "refactor",
            "rename",
            "convert",
            "transform",
            "extract",
            "迁移",
            "重构",
            "改造",
            "提取",
            "转换",
        ],
    ) {
        "transform"
    } else if contains_any(
        &normalized,
        &[
            "script",
            "automation",
            "batch",
            "pipeline",
            "loop",
            "aggregate",
            "for each",
            "脚本",
            "自动化",
            "批量",
            "流水线",
            "遍历",
        ],
    ) {
        "orchestrate"
    } else if contains_any(
        &normalized,
        &[
            "build",
            "create",
            "generate",
            "implement",
            "ship",
            "produce",
            "写",
            "生成",
            "创建",
            "实现",
            "落地",
        ],
    ) {
        "produce"
    } else {
        "answer"
    }
    .to_string();

    let output_shape = if contains_any(
        &normalized,
        &[
            "json", "csv", "html", "markdown", "md", "code", "file", "artifact", "补丁", "代码",
            "文件",
        ],
    ) {
        "artifact"
    } else if contains_any(
        &normalized,
        &[
            "diagnosis",
            "root cause",
            "why",
            "reason",
            "诊断",
            "原因",
            "为什么",
        ],
    ) {
        "diagnosis"
    } else if contains_any(
        &normalized,
        &["compare", "tradeoff", "pros", "cons", "对比", "取舍"],
    ) {
        "comparison"
    } else if contains_any(
        &normalized,
        &[
            "install", "delete", "remove", "update", "change", "配置", "安装", "删除", "修改",
            "更新",
        ],
    ) {
        "changed_state"
    } else {
        "explanation"
    }
    .to_string();

    let scope_shape = if contains_any(
        &normalized,
        &[
            "all files",
            "all repos",
            "every",
            "each",
            "batch",
            "all",
            "全部",
            "每个",
            "批量",
            "遍历",
        ],
    ) {
        "batch"
    } else if contains_any(
        &normalized,
        &[
            "architecture",
            "system",
            "long term",
            "open ended",
            "broad",
            "架构",
            "系统级",
            "长期",
            "开放式",
        ],
    ) {
        "open_ended"
    } else {
        "single_target"
    }
    .to_string();

    let risk_class = if contains_any(
        &normalized,
        &[
            "delete", "drop", "remove", "revoke", "disable", "purge", "删除", "清空", "禁用",
            "撤销",
        ],
    ) {
        "destructive"
    } else if contains_any(
        &normalized,
        &[
            "token",
            "key",
            "password",
            "billing",
            "payment",
            "database",
            "provider",
            "env",
            "权限",
            "密钥",
            "支付",
            "数据库",
            "配置",
            "环境变量",
        ],
    ) {
        "approval_sensitive"
    } else if contains_any(
        &normalized,
        &[
            "prod",
            "production",
            "migrate",
            "migration",
            "部署",
            "生产",
            "迁移",
        ],
    ) {
        "high_regret"
    } else {
        "low"
    }
    .to_string();

    let execution_pressure = if contains_any(
        &normalized,
        &[
            "fix",
            "implement",
            "build",
            "create",
            "install",
            "change",
            "ship",
            "修复",
            "实现",
            "创建",
            "安装",
            "修改",
            "落地",
        ],
    ) {
        "high"
    } else if goal_shape == "investigate" || goal_shape == "transform" {
        "medium"
    } else {
        "low"
    }
    .to_string();

    let environment_dependency = if contains_any(
        &normalized,
        &[
            "desktop",
            "windows",
            "local",
            "tauri",
            "browser",
            "filesystem",
            "path",
            "provider",
            "runtime",
            "本地",
            "桌面端",
            "路径",
            "运行时",
            "文件系统",
        ],
    ) {
        "high"
    } else if contains_any(
        &normalized,
        &["code", "repo", "module", "文件", "代码", "仓库", "模块"],
    ) {
        "medium"
    } else {
        "low"
    }
    .to_string();

    let discovery_pressure = if environment_dependency == "high"
        || contains_any(
            &normalized,
            &[
                "which tool",
                "available",
                "capability",
                "current",
                "runtime truth",
                "what path",
                "哪个工具",
                "可用",
                "能力",
                "当前",
                "真实路径",
            ],
        ) {
        "high"
    } else if goal_shape == "investigate" || execution_pressure == "high" {
        "medium"
    } else {
        "low"
    }
    .to_string();

    let verification_demand = if matches!(
        risk_class.as_str(),
        "destructive" | "approval_sensitive" | "high_regret"
    ) || contains_any(
        &normalized,
        &[
            "production",
            "verify",
            "test",
            "compile",
            "build",
            "上线",
            "验证",
            "测试",
            "编译",
            "构建",
        ],
    ) {
        "strict"
    } else if execution_pressure == "high" || output_shape == "artifact" {
        "normal"
    } else {
        "weak"
    }
    .to_string();

    TaskFingerprint {
        goal_shape,
        output_shape,
        scope_shape,
        risk_class,
        execution_pressure,
        discovery_pressure,
        environment_dependency,
        verification_demand,
    }
}

#[cfg(test)]
mod tests {
    use super::build_task_fingerprint;

    #[test]
    fn build_task_fingerprint_classifies_investigation_shape() {
        let fingerprint =
            build_task_fingerprint("Investigate the desktop runtime route boundary for this task");

        assert_eq!(fingerprint.goal_shape, "investigate");
        assert_eq!(fingerprint.environment_dependency, "high");
        assert_eq!(fingerprint.discovery_pressure, "high");
    }

    #[test]
    fn build_task_fingerprint_classifies_destructive_and_strict_verification() {
        let fingerprint =
            build_task_fingerprint("Delete the old provider config and verify production behavior");

        assert_eq!(fingerprint.risk_class, "destructive");
        assert_eq!(fingerprint.verification_demand, "strict");
        assert_eq!(fingerprint.execution_pressure, "high");
    }

    #[test]
    fn build_task_fingerprint_produces_stable_key() {
        let first = build_task_fingerprint("Create a local JSON artifact");
        let second = build_task_fingerprint("Create a local JSON artifact");

        assert_eq!(first.key(), second.key());
    }
}
