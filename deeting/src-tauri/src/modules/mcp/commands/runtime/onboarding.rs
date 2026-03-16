use super::super::{skill_registry_impl::*, support::*};

pub(crate) fn derive_skill_name_from_repo_url(repo_url: &str) -> String {
    let normalized_repo = repo_url.trim().trim_end_matches('/');
    let raw = normalized_repo
        .rsplit_once('/')
        .map(|(_, tail)| tail)
        .or_else(|| normalized_repo.rsplit_once(':').map(|(_, tail)| tail))
        .unwrap_or("skill")
        .trim_end_matches(".git")
        .trim();
    normalize_skill_dir_name(raw)
}

pub(crate) fn parse_skill_onboarding_payload(
    payload: &serde_json::Value,
) -> Result<(String, String), String> {
    let obj = payload
        .as_object()
        .ok_or_else(|| "skill onboarding payload must be an object".to_string())?;
    let repo_url = obj
        .get("repo_url")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "skill onboarding requires payload.repo_url".to_string())?;
    let skill_name = obj
        .get("skill_name")
        .or_else(|| obj.get("name"))
        .or_else(|| obj.get("skill_id"))
        .and_then(|value| value.as_str())
        .map(normalize_skill_dir_name)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| derive_skill_name_from_repo_url(&repo_url));

    Ok((repo_url, skill_name))
}

pub(crate) async fn install_local_skill_from_onboarding_request(
    app: &AppHandle,
    app_state: &AppState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (repo_url, skill_name) = parse_skill_onboarding_payload(payload)?;
    let result = install_skill_to_local(app, app_state, &repo_url, None, None).await?;
    Ok(serde_json::json!({
        "action": "skill_installed",
        "repo_url": repo_url,
        "skill_name": skill_name,
        "install": {
            "skill_id": result.skill_id,
            "tool_count": result.tool_count,
            "install_path": result.install_path,
        }
    }))
}
