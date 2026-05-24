pub(super) fn summarize_content(content: &str) -> Option<String> {
    let summary = content
        .split_whitespace()
        .take(32)
        .collect::<Vec<_>>()
        .join(" ");
    if summary.is_empty() {
        None
    } else {
        Some(summary)
    }
}
