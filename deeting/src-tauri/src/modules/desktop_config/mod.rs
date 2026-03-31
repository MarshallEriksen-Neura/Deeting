pub mod commands;
pub(crate) mod store;
pub(crate) mod store_init;

pub(crate) const MAX_AGENTIC_ROUNDS_CONFIG_KEY: &str = "max_agentic_rounds";
pub(crate) const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;

pub(crate) fn parse_max_agentic_rounds(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_AGENTIC_ROUNDS)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_max_agentic_rounds, DEFAULT_MAX_AGENTIC_ROUNDS, MAX_AGENTIC_ROUNDS_CONFIG_KEY,
    };

    #[test]
    fn parse_max_agentic_rounds_accepts_valid_positive_values() {
        assert_eq!(parse_max_agentic_rounds(Some("12")), 12);
        assert_eq!(parse_max_agentic_rounds(Some(" 7 ")), 7);
    }

    #[test]
    fn parse_max_agentic_rounds_falls_back_for_missing_or_invalid_values() {
        assert_eq!(MAX_AGENTIC_ROUNDS_CONFIG_KEY, "max_agentic_rounds");
        assert_eq!(parse_max_agentic_rounds(None), DEFAULT_MAX_AGENTIC_ROUNDS);
        assert_eq!(
            parse_max_agentic_rounds(Some("")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
        assert_eq!(
            parse_max_agentic_rounds(Some("0")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
        assert_eq!(
            parse_max_agentic_rounds(Some("nope")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
    }
}
