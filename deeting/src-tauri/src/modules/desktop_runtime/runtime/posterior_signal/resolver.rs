use super::rules::{infer_from_explicit_outcome, infer_from_feedback_score, infer_from_user_text};
use super::types::{PosteriorSignalDecision, PosteriorSignalInput, PosteriorSignalSource};
use crate::modules::desktop_runtime::runtime::sovereign::PosteriorSignalIngress;

pub(crate) fn resolve_posterior_signal(input: &PosteriorSignalInput) -> PosteriorSignalDecision {
    if let Some(decision) = infer_from_explicit_outcome(input) {
        return decision;
    }
    if let Some(decision) = infer_from_feedback_score(input) {
        return decision;
    }
    if let Some(decision) = infer_from_user_text(input) {
        return decision;
    }
    PosteriorSignalDecision::unknown()
}

pub(crate) fn resolve_posterior_signal_ingress(
    ingress: &PosteriorSignalIngress,
) -> PosteriorSignalDecision {
    resolve_posterior_signal(ingress.input())
}

pub(crate) fn should_apply_posterior_signal(decision: &PosteriorSignalDecision) -> bool {
    !matches!(decision.source, PosteriorSignalSource::Unknown)
        && decision.signal.as_str() != "unknown"
        && decision.confidence >= 0.5
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_posterior_signal, resolve_posterior_signal_ingress, should_apply_posterior_signal,
    };
    use crate::modules::desktop_runtime::runtime::posterior_signal::types::{
        PosteriorSignalKind, PosteriorSignalSource,
    };
    use crate::modules::desktop_runtime::runtime::posterior_signal::PosteriorSignalInput;
    use crate::modules::desktop_runtime::runtime::sovereign::PosteriorSignalIngress;

    #[test]
    fn resolve_posterior_signal_prefers_explicit_outcome() {
        let decision = resolve_posterior_signal(&PosteriorSignalInput {
            explicit_outcome: Some("corrected".to_string()),
            user_text: Some("looks good".to_string()),
            ..Default::default()
        });

        assert_eq!(decision.signal, PosteriorSignalKind::Corrected);
        assert_eq!(decision.source, PosteriorSignalSource::ExplicitOutcome);
        assert!(should_apply_posterior_signal(&decision));
    }

    #[test]
    fn resolve_posterior_signal_maps_negative_feedback_with_comment() {
        let decision = resolve_posterior_signal(&PosteriorSignalInput {
            feedback_score: Some(-1.0),
            feedback_comment: Some("Actually this is wrong according to the log".to_string()),
            ..Default::default()
        });

        assert_eq!(decision.signal, PosteriorSignalKind::Corrected);
        assert_eq!(decision.source, PosteriorSignalSource::TraceFeedback);
    }

    #[test]
    fn resolve_posterior_signal_returns_unknown_without_signal() {
        let decision = resolve_posterior_signal(&PosteriorSignalInput::default());

        assert_eq!(decision.signal, PosteriorSignalKind::Unknown);
        assert!(!should_apply_posterior_signal(&decision));
    }

    #[test]
    fn resolve_posterior_signal_ingress_uses_wrapped_input() {
        let ingress = PosteriorSignalIngress::new(PosteriorSignalInput {
            explicit_outcome: Some("accepted".to_string()),
            ..Default::default()
        });

        let decision = resolve_posterior_signal_ingress(&ingress);

        assert_eq!(decision.signal, PosteriorSignalKind::Accepted);
        assert_eq!(decision.source, PosteriorSignalSource::ExplicitOutcome);
    }
}
