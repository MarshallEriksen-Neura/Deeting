#[test]
fn desktop_capability_lookup_is_available() {
    let spec =
        crate::modules::desktop_runtime::desktop_capabilities::find_official_skill_capability(
            "memory.append",
        );
    assert!(spec.is_some());
}
