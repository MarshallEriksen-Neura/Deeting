pub(crate) fn should_run_semantic_recall(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return false;
    }

    let keyword_count = trimmed
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.chars().count() > 1)
        .take(2)
        .count();

    keyword_count >= 2 || trimmed.chars().count() >= 12
}
