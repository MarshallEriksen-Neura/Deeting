use super::types::{
    PosteriorSignalDecision, PosteriorSignalInput, PosteriorSignalKind, PosteriorSignalSource,
};

fn build_decision(
    signal: PosteriorSignalKind,
    confidence: f64,
    source: PosteriorSignalSource,
    rationale: impl Into<Option<String>>,
) -> PosteriorSignalDecision {
    PosteriorSignalDecision {
        signal,
        confidence: confidence.clamp(0.0, 1.0),
        source,
        version: "posterior-signal/v1".to_string(),
        rationale: rationale.into(),
    }
}

pub(crate) fn infer_from_explicit_outcome(
    input: &PosteriorSignalInput,
) -> Option<PosteriorSignalDecision> {
    let explicit = input
        .explicit_outcome
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let signal = PosteriorSignalKind::from_str(explicit)?;
    Some(build_decision(
        signal,
        1.0,
        PosteriorSignalSource::ExplicitOutcome,
        Some(format!("explicit outcome '{}'", explicit)),
    ))
}

pub(crate) fn infer_from_feedback_score(
    input: &PosteriorSignalInput,
) -> Option<PosteriorSignalDecision> {
    let score = input.feedback_score?;
    if !score.is_finite() {
        return None;
    }
    if score >= 0.2 {
        return Some(build_decision(
            PosteriorSignalKind::Accepted,
            score.abs().clamp(0.85, 0.99),
            PosteriorSignalSource::TraceFeedback,
            Some(format!("feedback score {:.2} => accepted", score)),
        ));
    }
    if score <= -0.2 {
        let comment = input.feedback_comment.as_deref().unwrap_or_default();
        let negative_kind = infer_negative_text_signal(comment)
            .map(|decision| decision.signal)
            .unwrap_or(PosteriorSignalKind::Rejected);
        return Some(build_decision(
            negative_kind,
            score.abs().clamp(0.85, 0.99),
            PosteriorSignalSource::TraceFeedback,
            Some(format!(
                "feedback score {:.2} => {}",
                score,
                negative_kind.as_str()
            )),
        ));
    }
    None
}

fn infer_negative_text_signal(user_text: &str) -> Option<PosteriorSignalDecision> {
    let normalized = user_text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let corrected_markers = [
        "actually",
        "that is wrong",
        "that's wrong",
        "not correct",
        "correction",
        "you missed",
        "you are wrong",
        "based on this log",
        "according to this log",
        "不对",
        "错了",
        "不是",
        "纠正",
        "反驳",
        "补充证据",
        "根据这个日志",
    ];
    if corrected_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some(build_decision(
            PosteriorSignalKind::Corrected,
            0.82,
            PosteriorSignalSource::HeuristicRules,
            Some("matched correction markers".to_string()),
        ));
    }
    let rejected_markers = [
        "redo this",
        "try again",
        "start over",
        "重来",
        "重做",
        "不行",
        "没解决",
    ];
    if rejected_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some(build_decision(
            PosteriorSignalKind::Rejected,
            0.76,
            PosteriorSignalSource::HeuristicRules,
            Some("matched retry/reject markers".to_string()),
        ));
    }
    None
}

pub(crate) fn infer_from_user_text(
    input: &PosteriorSignalInput,
) -> Option<PosteriorSignalDecision> {
    let user_text = input.user_text.as_deref()?;
    infer_negative_text_signal(user_text)
}
