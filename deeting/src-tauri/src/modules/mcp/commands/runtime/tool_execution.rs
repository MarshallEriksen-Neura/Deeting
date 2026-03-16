use super::super::{common_impl::to_string, support::*};
use super::remote_transport::{call_local_stdio_tool, call_remote_sse_tool};
use super::tool_resolution::resolve_callable_mcp_tool_by_ref;
use crate::modules::mcp::store::LocalSkillToolBindingSnapshot;
use crate::modules::skill_runtime::{
    resolve_runtime_command_for_binding, resolve_runtime_env_for_binding,
};

const TOOL_CALL_MARKER: &str = "__DEETING_TOOL_CALL_REQUEST__";
const MAX_MARKER_REEXEC: usize = 8;

fn truncate_for_skill_log(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(trimmed.len().min(max_chars));
    for ch in trimmed.chars().take(max_chars) {
        out.push(ch);
    }
    if trimmed.chars().count() > max_chars {
        out.push_str("...");
    }
    out
}

fn summarize_skill_binding_env(env: &HashMap<String, String>) -> Value {
    let mut env_keys = env.keys().cloned().collect::<Vec<_>>();
    env_keys.sort();
    serde_json::json!({
        "keys": env_keys,
        "pythonpath": env.get("PYTHONPATH"),
        "scout_service_url": env.get("SCOUT_SERVICE_URL"),
        "deeting_skill_id": env.get("DEETING_SKILL_ID"),
        "deeting_skill_action_id": env.get("DEETING_SKILL_ACTION_ID"),
        "has_skill_config_json": env.contains_key("DEETING_SKILL_CONFIG_JSON"),
        "has_runtime_context": env.contains_key("DEETING_RUNTIME_CONTEXT"),
    })
}

fn summarize_tool_arguments(arguments: &Value) -> Value {
    match arguments {
        Value::Object(map) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            serde_json::json!({
                "kind": "object",
                "keys": keys,
            })
        }
        Value::Array(items) => serde_json::json!({
            "kind": "array",
            "len": items.len(),
        }),
        Value::Null => serde_json::json!({ "kind": "null" }),
        other => serde_json::json!({
            "kind": "scalar",
            "value": other,
        }),
    }
}

fn build_skill_binding_launch_meta(
    binding: &LocalSkillToolBindingSnapshot,
    command: &str,
    args: &[String],
    skill_dir: Option<&std::path::Path>,
    env: Option<&HashMap<String, String>>,
    marker_attempt: Option<usize>,
) -> Value {
    serde_json::json!({
        "skill_id": binding.skill_id,
        "callable_name": binding.callable_name,
        "tool_name": binding.tool_name,
        "binding_kind": binding.binding_kind,
        "runtime": binding.runtime,
        "timeout_seconds": binding.timeout_seconds,
        "entry_path": binding.entry_path,
        "work_dir": skill_dir.map(|path| path.display().to_string()),
        "command": command,
        "args": args,
        "marker_attempt": marker_attempt,
        "env": env.map(summarize_skill_binding_env),
    })
}

fn log_skill_binding_launch(
    binding: &LocalSkillToolBindingSnapshot,
    command: &str,
    args: &[String],
    skill_dir: Option<&std::path::Path>,
    env: Option<&HashMap<String, String>>,
    marker_attempt: Option<usize>,
) {
    log::info!(
        "skill_binding_launch {}",
        build_skill_binding_launch_meta(binding, command, args, skill_dir, env, marker_attempt)
    );
}

fn log_skill_binding_timeout(
    binding: &LocalSkillToolBindingSnapshot,
    command: &str,
    args: &[String],
    skill_dir: Option<&std::path::Path>,
    env: Option<&HashMap<String, String>>,
    marker_attempt: Option<usize>,
) {
    log::warn!(
        "skill_binding_timeout {}",
        build_skill_binding_launch_meta(binding, command, args, skill_dir, env, marker_attempt)
    );
}

fn log_skill_binding_failure(
    binding: &LocalSkillToolBindingSnapshot,
    command: &str,
    args: &[String],
    skill_dir: Option<&std::path::Path>,
    env: Option<&HashMap<String, String>>,
    marker_attempt: Option<usize>,
    status: &std::process::ExitStatus,
    stdout: &[u8],
    stderr: &[u8],
) {
    let meta =
        build_skill_binding_launch_meta(binding, command, args, skill_dir, env, marker_attempt);
    let stdout_preview = truncate_for_skill_log(&String::from_utf8_lossy(stdout), 600);
    let stderr_preview = truncate_for_skill_log(&String::from_utf8_lossy(stderr), 600);
    log::warn!(
        "skill_binding_failure {}",
        serde_json::json!({
            "launch": meta,
            "exit_status": status.to_string(),
            "stdout_preview": stdout_preview,
            "stderr_preview": stderr_preview,
        })
    );
}

fn log_skill_binding_spawn_failure(
    binding: &LocalSkillToolBindingSnapshot,
    command: &str,
    args: &[String],
    skill_dir: Option<&std::path::Path>,
    env: Option<&HashMap<String, String>>,
    marker_attempt: Option<usize>,
    error: &str,
) {
    log::warn!(
        "skill_binding_spawn_failure {}",
        serde_json::json!({
            "launch": build_skill_binding_launch_meta(binding, command, args, skill_dir, env, marker_attempt),
            "error": error,
        })
    );
}

fn log_skill_binding_lookup_start(
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    arguments: &Value,
) {
    log::info!(
        "skill_binding_lookup_start {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "arguments": summarize_tool_arguments(arguments),
        })
    );
}

fn log_skill_binding_lookup_hit(
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    binding: &LocalSkillToolBindingSnapshot,
) {
    log::info!(
        "skill_binding_lookup_hit {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "skill_id": binding.skill_id,
            "binding_id": binding.binding_id,
            "callable_name": binding.callable_name,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "binding_kind": binding.binding_kind,
        })
    );
}

fn log_skill_binding_lookup_miss(tool_id: Option<&str>, tool_name: Option<&str>) {
    log::info!(
        "skill_binding_lookup_miss {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
        })
    );
}

fn log_skill_binding_lookup_failure(tool_id: Option<&str>, tool_name: Option<&str>, error: &str) {
    log::warn!(
        "skill_binding_lookup_failure {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "error": error,
        })
    );
}

fn log_skill_binding_preflight_failure(
    binding: &LocalSkillToolBindingSnapshot,
    stage: &str,
    error: &str,
) {
    log::warn!(
        "skill_binding_preflight_failure {}",
        serde_json::json!({
            "skill_id": binding.skill_id,
            "binding_id": binding.binding_id,
            "callable_name": binding.callable_name,
            "tool_name": binding.tool_name,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "binding_kind": binding.binding_kind,
            "stage": stage,
            "error": error,
        })
    );
}

fn log_skill_binding_stage(binding: &LocalSkillToolBindingSnapshot, stage: &str, details: Value) {
    log::info!(
        "skill_binding_stage {}",
        serde_json::json!({
            "skill_id": binding.skill_id,
            "binding_id": binding.binding_id,
            "callable_name": binding.callable_name,
            "tool_name": binding.tool_name,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "binding_kind": binding.binding_kind,
            "stage": stage,
            "details": details,
        })
    );
}

fn parse_timeout_from_tool(tool: &McpTool) -> u64 {
    serde_json::from_str::<serde_json::Value>(&tool.config_json)
        .ok()
        .and_then(|v| v.get("execution")?.get("timeout_seconds")?.as_u64())
        .unwrap_or(60)
}

pub(crate) async fn resolve_skill_binding_by_ref(
    store: &crate::modules::mcp::store::McpStore,
    binding_id: Option<&str>,
    callable_name: Option<&str>,
) -> Result<Option<LocalSkillToolBindingSnapshot>, String> {
    store
        .get_enabled_local_skill_tool_binding_by_ref(binding_id, callable_name)
        .await
        .map_err(to_string)
}

fn build_skill_binding_fingerprint(binding: &LocalSkillToolBindingSnapshot) -> String {
    format!("{}:{}", binding.binding_id, binding.updated_at)
}

fn resolve_deeting_sdk_pythonpath(binding: &LocalSkillToolBindingSnapshot) -> Option<String> {
    let env_override = std::env::var("DEETING_SDK_PYTHONPATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if env_override.is_some() {
        return env_override;
    }

    let entry_path = std::path::Path::new(&binding.entry_path);
    let mut current = entry_path.parent();
    while let Some(path) = current {
        if path.file_name().and_then(|value| value.to_str()) == Some("official-skills") {
            let candidate = path
                .parent()
                .map(|parent| parent.join("deeting-sdk"))
                .filter(|candidate| candidate.exists());
            if let Some(candidate) = candidate {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        current = path.parent();
    }

    std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join("packages").join("deeting-sdk"))
        .filter(|candidate| candidate.exists())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

fn build_command_for_skill_binding(
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
) -> Result<(String, Vec<String>), String> {
    let mut cli_args = arguments
        .get("args")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    match binding.runtime.as_str() {
        "python" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok((
                if cfg!(target_os = "windows") {
                    "python".to_string()
                } else {
                    "python3".to_string()
                },
                args,
            ))
        }
        "node" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok(("node".to_string(), args))
        }
        "bash" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok(("bash".to_string(), args))
        }
        other => Err(format!(
            "unsupported skill binding runtime '{}' for {}",
            other, binding.callable_name
        )),
    }
}

async fn build_command_for_skill_binding_with_store(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
) -> Result<(String, Vec<String>), String> {
    log_skill_binding_stage(
        binding,
        "build_command.start",
        serde_json::json!({
            "arguments": summarize_tool_arguments(arguments),
        }),
    );
    let mut cli_args = arguments
        .get("args")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if binding.runtime == "python" {
        let mut args = vec![binding.entry_path.clone()];
        args.append(&mut cli_args);
        if let Some(command) = resolve_runtime_command_for_binding(store, binding).await? {
            log_skill_binding_stage(
                binding,
                "build_command.done",
                serde_json::json!({
                    "command": command,
                    "args": args,
                    "runtime_command_resolved": true,
                }),
            );
            return Ok((command, args));
        }
        log_skill_binding_stage(
            binding,
            "build_command.done",
            serde_json::json!({
                "command": if cfg!(target_os = "windows") { "python" } else { "python3" },
                "args": args,
                "runtime_command_resolved": false,
            }),
        );
        return Ok((
            if cfg!(target_os = "windows") {
                "python".to_string()
            } else {
                "python3".to_string()
            },
            args,
        ));
    }

    let resolved = build_command_for_skill_binding(binding, arguments)?;
    log_skill_binding_stage(
        binding,
        "build_command.done",
        serde_json::json!({
            "command": resolved.0,
            "args": resolved.1,
            "runtime_command_resolved": false,
        }),
    );
    Ok(resolved)
}

async fn resolve_skill_binding_env(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<HashMap<String, String>>, String> {
    log_skill_binding_stage(binding, "resolve_env.start", serde_json::json!({}));
    let mut env = HashMap::new();
    env.insert("DEETING_SKILL_ID".to_string(), binding.skill_id.clone());
    env.insert(
        "DEETING_SKILL_ACTION_ID".to_string(),
        binding.tool_name.clone(),
    );
    if binding.binding_kind == "deeting_tool" && binding.runtime == "python" {
        if let Some(pythonpath) = resolve_deeting_sdk_pythonpath(binding) {
            let merged = std::env::var("PYTHONPATH")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|existing| format!("{pythonpath}:{existing}"))
                .unwrap_or(pythonpath);
            env.insert("PYTHONPATH".to_string(), merged);
        }
    }
    if binding.skill_id == "official.skills.crawler"
        || matches!(
            binding.tool_name.as_str(),
            "fetch_web_content" | "crawl_website"
        )
    {
        if let Some(override_url) = resolve_effective_desktop_scout_base_url(store)
            .await
            .map_err(to_string)?
        {
            env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), override_url);
        }
    }
    if let Some(install) = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(to_string)?
    {
        let secret_env = store
            .get_local_skill_env_secrets(&binding.skill_id)
            .await
            .map_err(to_string)?;
        env.extend(secret_env);

        if let Some(user_settings) = install.user_settings_json.as_ref() {
            if let Some(config_json) = user_settings.get("config_json") {
                env.insert(
                    "DEETING_SKILL_CONFIG_JSON".to_string(),
                    config_json.to_string(),
                );
            }
        }
    }
    if let Some(runtime_env) = resolve_runtime_env_for_binding(store, binding).await? {
        env.extend(runtime_env);
    }
    if env.is_empty() {
        log_skill_binding_stage(
            binding,
            "resolve_env.done",
            serde_json::json!({
                "env": serde_json::Value::Null,
            }),
        );
        Ok(None)
    } else {
        log_skill_binding_stage(
            binding,
            "resolve_env.done",
            serde_json::json!({
                "env": summarize_skill_binding_env(&env),
            }),
        );
        Ok(Some(env))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OfficialSkillHostToolRoute {
    DesktopCapability,
    SearchSdk,
    ShellExecute,
    Unsupported,
}

fn resolve_official_skill_host_tool_route(
    binding: &LocalSkillToolBindingSnapshot,
    tool_name: &str,
) -> OfficialSkillHostToolRoute {
    let normalized_tool_name = tool_name.trim();
    if normalized_tool_name.is_empty() {
        return OfficialSkillHostToolRoute::Unsupported;
    }

    if crate::modules::mcp::desktop_capabilities::find_official_skill_capability(
        normalized_tool_name,
    )
    .is_some()
    {
        return OfficialSkillHostToolRoute::DesktopCapability;
    }

    match normalized_tool_name {
        "search_sdk" => OfficialSkillHostToolRoute::SearchSdk,
        "shell_execute" if binding.skill_id == "official.skills.skill_manager" => {
            OfficialSkillHostToolRoute::ShellExecute
        }
        _ => OfficialSkillHostToolRoute::Unsupported,
    }
}

async fn dispatch_official_skill_search_sdk(
    store: &crate::modules::mcp::store::McpStore,
    arguments: &Value,
) -> Result<Value, String> {
    let app_state = crate::state::global_app_state()
        .ok_or_else(|| "global app state is unavailable".to_string())?;
    let query = arguments.get("query").and_then(Value::as_str).unwrap_or("");
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(8);

    Ok(
        crate::modules::mcp::commands::runtime::build_local_sdk_search_result_with_runtime(
            store,
            &app_state.providers.embedding,
            app_state.memory.service.as_ref(),
            query,
            limit,
        )
        .await,
    )
}

async fn dispatch_official_skill_shell_execute(arguments: &Value) -> Result<Value, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "desktop home directory is unavailable for shell_execute".to_string())?;
    crate::modules::shell_executor::core_tool::ShellExecuteCoreTool::new(home_dir)
        .execute(arguments.clone())
        .await
}

async fn dispatch_internal_skill_host_tool(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    tool_name: &str,
    arguments: &Value,
) -> Result<Option<Value>, String> {
    match resolve_official_skill_host_tool_route(binding, tool_name) {
        OfficialSkillHostToolRoute::DesktopCapability => {
            crate::modules::mcp::desktop_capabilities::dispatch_official_skill_capability(
                tool_name, arguments,
            )
            .await
        }
        OfficialSkillHostToolRoute::SearchSdk => {
            dispatch_official_skill_search_sdk(store, arguments)
                .await
                .map(Some)
        }
        OfficialSkillHostToolRoute::ShellExecute => {
            dispatch_official_skill_shell_execute(arguments)
                .await
                .map(Some)
        }
        OfficialSkillHostToolRoute::Unsupported => Ok(None),
    }
}

async fn execute_deeting_tool_binding(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
) -> Result<Value, String> {
    log_skill_binding_stage(
        binding,
        "execute_deeting_tool_binding.enter",
        serde_json::json!({
            "arguments": summarize_tool_arguments(arguments),
        }),
    );
    let timeout_secs = binding.timeout_seconds.max(1);
    let mut tool_results: Vec<serde_json::Value> = Vec::new();
    for attempt in 0..=MAX_MARKER_REEXEC {
        let (command, args) = build_command_for_skill_binding_with_store(store, binding, arguments)
            .await
            .map_err(|err| {
                log_skill_binding_preflight_failure(binding, "build_command", &err);
                err
            })?;
        let env = resolve_skill_binding_env(store, binding)
            .await
            .map_err(|err| {
                log_skill_binding_preflight_failure(binding, "resolve_env", &err);
                err
            })?;
        let skill_dir = std::path::Path::new(&binding.entry_path)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());

        let runtime_context = serde_json::json!({
            "tool_results": tool_results,
            "max_tool_calls": MAX_MARKER_REEXEC,
        });
        let mut env_map = env.unwrap_or_default();
        env_map.insert(
            "DEETING_RUNTIME_CONTEXT".to_string(),
            serde_json::to_string(&runtime_context).unwrap_or_default(),
        );
        log_skill_binding_launch(
            binding,
            &command,
            &args,
            skill_dir.as_deref(),
            Some(&env_map),
            Some(attempt),
        );
        let mut cmd = tokio::process::Command::new(&command);
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(ref dir) = skill_dir {
            cmd.current_dir(dir);
        }
        if !env_map.is_empty() {
            cmd.envs(&env_map);
        }

        let mut child = cmd.spawn().map_err(|err| {
            log_skill_binding_spawn_failure(
                binding,
                &command,
                &args,
                skill_dir.as_deref(),
                Some(&env_map),
                Some(attempt),
                &err.to_string(),
            );
            to_string(err)
        })?;
        if let Some(mut stdin) = child.stdin.take() {
            let payload = serde_json::json!({
                "method": binding.tool_name,
                "arguments": arguments,
            });
            let payload_bytes = serde_json::to_vec(&payload).map_err(to_string)?;
            stdin.write_all(&payload_bytes).await.map_err(to_string)?;
        }
        let output = match tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            child.wait_with_output(),
        )
        .await
        {
            Ok(result) => {
                result.map_err(|err| format!("skill binding execution error: {}", err))?
            }
            Err(_) => {
                log_skill_binding_timeout(
                    binding,
                    &command,
                    &args,
                    skill_dir.as_deref(),
                    Some(&env_map),
                    Some(attempt),
                );
                return Err(format!(
                    "skill binding '{}' timed out after {}s",
                    binding.callable_name, timeout_secs
                ));
            }
        };
        if !output.status.success() {
            log_skill_binding_failure(
                binding,
                &command,
                &args,
                skill_dir.as_deref(),
                Some(&env_map),
                Some(attempt),
                &output.status,
                &output.stdout,
                &output.stderr,
            );
        }
        let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let requested_args = marker_payload
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }
            if let Some(result) =
                dispatch_internal_skill_host_tool(store, binding, &requested_tool, &requested_args)
                    .await?
            {
                tool_results.push(result);
                continue;
            }
            tool_results.push(serde_json::json!({
                "status": "error",
                "error": format!("desktop skill binding host bridge cannot resolve tool '{}'", requested_tool)
            }));
            continue;
        }
        if !output.status.success() {
            return Err(format!(
                "skill binding '{}' failed (exit={}): {}",
                binding.callable_name,
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        if output.stdout.is_empty() {
            return Ok(serde_json::json!({ "ok": true }));
        }
        return serde_json::from_slice::<Value>(&output.stdout).or_else(|_| {
            Ok(serde_json::json!({
                "ok": true,
                "raw": stdout_str,
            }))
        });
    }
    Err("skill binding marker loop exhausted".to_string())
}

async fn resolve_skill_binding_config_json(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<Value>, String> {
    let install = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(to_string)?;
    Ok(install
        .and_then(|detail| detail.user_settings_json)
        .and_then(|settings| settings.get("config_json").cloned()))
}

fn build_script_runner_payload(
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
    config_json: Option<&Value>,
) -> Value {
    let input_payload = arguments
        .get("input")
        .cloned()
        .unwrap_or_else(|| match arguments {
            Value::Object(object) => {
                let mut filtered = object.clone();
                filtered.remove("args");
                Value::Object(filtered)
            }
            _ => arguments.clone(),
        });

    let context = serde_json::json!({
        "skill_id": binding.skill_id,
        "tool_name": binding.tool_name,
        "callable_name": binding.callable_name,
        "binding_kind": binding.binding_kind,
    });

    match input_payload {
        Value::Object(mut object) => {
            if let Some(config) = config_json {
                object.insert("__deeting_config".to_string(), config.clone());
            }
            object.insert("__deeting_context".to_string(), context);
            Value::Object(object)
        }
        other => serde_json::json!({
            "input": other,
            "__deeting_config": config_json.cloned().unwrap_or_else(|| serde_json::json!({})),
            "__deeting_context": context,
        }),
    }
}

async fn execute_skill_binding(
    store: &crate::modules::mcp::store::McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &Value,
) -> Result<Value, String> {
    log_skill_binding_stage(
        binding,
        "execute_skill_binding.enter",
        serde_json::json!({
            "arguments": summarize_tool_arguments(arguments),
        }),
    );
    if binding.binding_kind == "deeting_tool" && binding.runtime == "python" {
        return execute_deeting_tool_binding(store, binding, arguments).await;
    }
    let (command, args) = build_command_for_skill_binding_with_store(store, binding, arguments)
        .await
        .map_err(|err| {
            log_skill_binding_preflight_failure(binding, "build_command", &err);
            err
        })?;
    let env = resolve_skill_binding_env(store, binding)
        .await
        .map_err(|err| {
            log_skill_binding_preflight_failure(binding, "resolve_env", &err);
            err
        })?;
    let config_json = resolve_skill_binding_config_json(store, binding).await?;

    // Resolve skill directory for working directory
    let skill_dir = std::path::Path::new(&binding.entry_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    log::info!(
        "Executing skill binding '{}' (runtime={}, timeout={}s, work_dir={})",
        binding.callable_name,
        binding.runtime,
        binding.timeout_seconds,
        skill_dir
            .as_deref()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    );
    log_skill_binding_launch(
        binding,
        &command,
        &args,
        skill_dir.as_deref(),
        env.as_ref(),
        None,
    );
    let mut cmd = tokio::process::Command::new(&command);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Set working directory to skill root for relative path resolution
    if let Some(ref dir) = skill_dir {
        cmd.current_dir(dir);
    }

    if let Some(ref env_map) = env {
        cmd.envs(env_map);
    }

    let mut child = cmd.spawn().map_err(|err| {
        log_skill_binding_spawn_failure(
            binding,
            &command,
            &args,
            skill_dir.as_deref(),
            env.as_ref(),
            None,
            &err.to_string(),
        );
        to_string(err)
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = if binding.binding_kind == "script_runner" {
            build_script_runner_payload(binding, arguments, config_json.as_ref())
        } else {
            serde_json::json!({
                "method": binding.tool_name,
                "arguments": arguments,
            })
        };
        let payload_bytes = serde_json::to_vec(&payload).map_err(to_string)?;
        if !payload_bytes.is_empty() {
            stdin.write_all(&payload_bytes).await.map_err(to_string)?;
        }
    }

    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(binding.timeout_seconds.max(1)),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|err| format!("skill binding execution error: {}", err))?,
        Err(_) => {
            log_skill_binding_timeout(
                binding,
                &command,
                &args,
                skill_dir.as_deref(),
                env.as_ref(),
                None,
            );
            return Err(format!(
                "skill binding '{}' timed out after {}s",
                binding.callable_name, binding.timeout_seconds
            ));
        }
    };

    if !output.status.success() {
        log_skill_binding_failure(
            binding,
            &command,
            &args,
            skill_dir.as_deref(),
            env.as_ref(),
            None,
            &output.status,
            &output.stdout,
            &output.stderr,
        );
        return Err(format!(
            "skill binding '{}' failed (exit={}): {}",
            binding.callable_name,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if output.stdout.is_empty() {
        return Ok(serde_json::json!({ "ok": true }));
    }
    serde_json::from_slice::<Value>(&output.stdout).or_else(|_| {
        Ok(serde_json::json!({
            "ok": true,
            "raw": String::from_utf8_lossy(&output.stdout).to_string(),
        }))
    })
}

pub(crate) async fn execute_local_mcp_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    let timeout_secs = parse_timeout_from_tool(tool);
    let mut tool_results: Vec<serde_json::Value> = Vec::new();
    for attempt in 0..=MAX_MARKER_REEXEC {
        let output =
            spawn_skill_subprocess(store, tool, arguments, &tool_results, timeout_secs).await?;
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }
            log::info!(
                "marker re-exec #{}: skill {} requests tool {}",
                attempt + 1,
                tool.name,
                requested_tool
            );
            tool_results.push(serde_json::json!({
                "status": "error",
                "error": format!("cross-tool call to '{}' not yet supported in desktop Marker mode", requested_tool)
            }));
            continue;
        }
        if output.status.success() {
            if output.stdout.is_empty() {
                return Ok(serde_json::json!({ "ok": true }));
            }
            return match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                Ok(parsed) => Ok(parsed),
                Err(_) => Ok(serde_json::json!({ "ok": true, "raw": stdout_str.to_string() })),
            };
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }
    Err("skill marker re-execution loop exhausted".to_string())
}

pub(crate) async fn execute_mcp_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    if tool.is_remote_sse() {
        let sse_url = tool
            .remote_sse_url()
            .ok_or_else(|| format!("remote tool {} is missing sse url", tool.name))?;
        let remote_tool_name = tool
            .remote_tool_name()
            .ok_or_else(|| format!("remote tool {} is missing remote tool name", tool.name))?;
        return call_remote_sse_tool(&sse_url, &remote_tool_name, arguments).await;
    }

    if tool.is_stdio_mcp_tool() {
        let command = tool
            .command
            .as_deref()
            .ok_or_else(|| format!("stdio MCP tool {} has no executable command", tool.name))?;
        let tool_name = tool
            .stdio_mcp_tool_name()
            .ok_or_else(|| format!("stdio MCP tool {} is missing tool metadata", tool.name))?;
        let env = resolve_skill_env(store, tool).await?;
        let args = tool.args.clone().unwrap_or_default();
        return call_local_stdio_tool(command, &args, env.as_ref(), &tool_name, arguments).await;
    }

    execute_local_mcp_tool(store, tool, arguments).await
}

async fn spawn_skill_subprocess(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
    tool_results: &[serde_json::Value],
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = resolve_skill_env(store, tool).await? {
        cmd.envs(env);
    }
    if !tool_results.is_empty() {
        let ctx = serde_json::json!({ "tool_results": tool_results, "max_tool_calls": MAX_MARKER_REEXEC });
        cmd.env(
            "DEETING_RUNTIME_CONTEXT",
            serde_json::to_string(&ctx).unwrap_or_default(),
        );
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(to_string)?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload_bytes =
            serde_json::to_vec(&serde_json::json!({ "method": tool.name, "arguments": arguments }))
                .map_err(to_string)?;
        stdin.write_all(&payload_bytes).await.map_err(to_string)?;
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("tool execution error: {}", e)),
        Err(_) => Err(format!("skill execution timed out after {}s", timeout_secs)),
    }
}

pub(crate) async fn resolve_skill_env(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
) -> Result<Option<HashMap<String, String>>, String> {
    let mut env = tool.env.clone().unwrap_or_default();
    let is_official_crawler_tool = tool
        .identifier
        .as_deref()
        .map(|id| id.starts_with("official.skills.crawler/"))
        .unwrap_or(false)
        || matches!(tool.name.as_str(), "fetch_web_content" | "crawl_website");
    if is_official_crawler_tool {
        env.remove(SCOUT_SERVICE_URL_ENV_KEY);
        let override_url = resolve_effective_desktop_scout_base_url(store)
            .await
            .map_err(to_string)?;
        if let Some(normalized) = override_url {
            env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), normalized);
        }
    }
    if env.is_empty() {
        Ok(None)
    } else {
        Ok(Some(env))
    }
}

fn extract_tool_call_marker(stdout: &str) -> Option<serde_json::Value> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix(TOOL_CALL_MARKER) {
            let json_str = json_str.trim();
            if json_str.is_empty() {
                return Some(serde_json::json!({}));
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(parsed);
            }
            return Some(serde_json::json!({}));
        }
    }
    None
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn execute_or_queue_mcp_tool_call(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        None,
        store,
        pending_tool_calls,
        tool_name,
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_assessment: Option<&crate::modules::mcp::ToolRiskAssessment>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_tool_ref(
        approval_context,
        risk_assessment,
        runtime_state,
        store,
        pending_tool_calls,
        None,
        Some(tool_name),
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_assessment: Option<&crate::modules::mcp::ToolRiskAssessment>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<String>,
    tool_name: Option<String>,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    log_skill_binding_lookup_start(tool_id.as_deref(), tool_name.as_deref(), &arguments);
    let resolved_binding =
        resolve_skill_binding_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
            .await
            .map_err(|err| {
                log_skill_binding_lookup_failure(tool_id.as_deref(), tool_name.as_deref(), &err);
                err
            })?;
    if let Some(binding) = resolved_binding {
        log_skill_binding_lookup_hit(tool_id.as_deref(), tool_name.as_deref(), &binding);
        let tool_fingerprint = build_skill_binding_fingerprint(&binding);
        let approval_grant_key =
            risk_assessment.and_then(|risk| risk.session_grant_key(&tool_fingerprint));
        let approved_by_grant = if require_approval {
            if let (Some(runtime), Some(key)) = (runtime_state, approval_grant_key.as_ref()) {
                runtime
                    .session_approval_grants
                    .read()
                    .await
                    .contains_key(key)
            } else {
                false
            }
        } else {
            false
        };

        if require_approval && !approved_by_grant {
            log_skill_binding_stage(
                &binding,
                "approval.required",
                serde_json::json!({
                    "require_approval": require_approval,
                    "approved_by_grant": approved_by_grant,
                    "has_runtime_state": runtime_state.is_some(),
                    "has_risk_assessment": risk_assessment.is_some(),
                }),
            );
            let approval_token = Uuid::new_v4().to_string();
            let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            let pending = crate::modules::mcp::PendingToolCall {
                tool_id: Some(binding.binding_id.clone()),
                tool_name: binding.callable_name.clone(),
                arguments: arguments.clone(),
                call_id: approval_context.call_id.clone(),
                execution_token: approval_context.execution_token.clone(),
                tool_fingerprint,
                approval_grant_key,
                created_at_unix_ms: now as i128,
                expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
            };
            pending_tool_calls
                .write()
                .await
                .insert(approval_token.clone(), pending);
            return Ok(serde_json::json!({
                "status": "REQUIRES_APPROVAL",
                "approval_token": approval_token,
                "tool_id": binding.binding_id,
                "tool_name": binding.callable_name,
                "arguments": arguments,
                "description": binding.description,
                "risk_level": risk_assessment.map(|risk| risk.risk_level).unwrap_or("MEDIUM"),
                "risk_reasons": risk_assessment.map(|risk| risk.reasons.clone()).unwrap_or_default(),
                "risk_profile": risk_assessment.map(|risk| risk.metadata_json()),
                "expires_in_ms": 5 * 60 * 1000,
            }));
        }
        log_skill_binding_stage(
            &binding,
            "execute_via_skill_binding.dispatch",
            serde_json::json!({
                "require_approval": require_approval,
                "approved_by_grant": approved_by_grant,
            }),
        );
        return execute_skill_binding(store, &binding, &arguments).await;
    }
    log_skill_binding_lookup_miss(tool_id.as_deref(), tool_name.as_deref());

    let tool = resolve_callable_mcp_tool_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
        .await
        .map_err(|err| err.to_string())?;
    let tool_fingerprint = runtime_state
        .map(|runtime| runtime.tool_fingerprint(&tool))
        .unwrap_or_else(|| tool.config_hash.clone());
    let approval_grant_key =
        risk_assessment.and_then(|risk| risk.session_grant_key(&tool_fingerprint));
    let approved_by_grant = if require_approval {
        if let (Some(runtime), Some(key)) = (runtime_state, approval_grant_key.as_ref()) {
            runtime
                .session_approval_grants
                .read()
                .await
                .contains_key(key)
        } else {
            false
        }
    } else {
        false
    };

    if require_approval && !approved_by_grant {
        let approval_token = Uuid::new_v4().to_string();
        let pending = if let Some(runtime) = runtime_state {
            runtime.build_pending_tool_call(
                Some(tool.id.clone()),
                tool.name.clone(),
                arguments.clone(),
                tool_fingerprint,
                approval_grant_key,
                approval_context.clone(),
            )
        } else {
            let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            crate::modules::mcp::PendingToolCall {
                tool_id: Some(tool.id.clone()),
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                call_id: approval_context.call_id.clone(),
                execution_token: approval_context.execution_token.clone(),
                tool_fingerprint,
                approval_grant_key,
                created_at_unix_ms: now as i128,
                expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
            }
        };
        let expires_in_ms = runtime_state
            .map(|runtime| runtime.pending_tool_call_ttl_ms())
            .unwrap_or(5 * 60 * 1000);
        pending_tool_calls
            .write()
            .await
            .insert(approval_token.clone(), pending);
        return Ok(serde_json::json!({
            "status": "REQUIRES_APPROVAL", "approval_token": approval_token,
            "tool_id": tool.id, "tool_name": tool.name,
            "arguments": arguments, "description": tool.description, "risk_level": risk_assessment.map(|risk| risk.risk_level).unwrap_or("HIGH"),
            "risk_reasons": risk_assessment.map(|risk| risk.reasons.clone()).unwrap_or_default(), "risk_profile": risk_assessment.map(|risk| risk.metadata_json()), "expires_in_ms": expires_in_ms,
        }));
    }
    execute_mcp_tool(store, &tool, &arguments).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    approve_mcp_tool_inner_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        approval_token,
    )
    .await
}

pub(crate) async fn approve_mcp_tool_inner_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let pending = pending_tool_calls.read().await.get(approval_token).cloned();
    let Some(pending) = pending else {
        return Err("pending tool call not found".to_string());
    };
    if pending.expires_at_unix_ms <= now as i128 {
        pending_tool_calls.write().await.remove(approval_token);
        return Err("approval token expired; please retry the action".to_string());
    }
    if let Some(expected_call_id) = pending.call_id.as_deref() {
        if approval_context.call_id.as_deref() != Some(expected_call_id) {
            return Err("approval context mismatch (call_id)".to_string());
        }
    }
    if let Some(expected_execution_token) = pending.execution_token.as_deref() {
        if approval_context.execution_token.as_deref() != Some(expected_execution_token) {
            return Err("approval context mismatch (execution_token)".to_string());
        }
    }
    if let Some(binding) = resolve_skill_binding_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await?
    {
        if build_skill_binding_fingerprint(&binding) != pending.tool_fingerprint {
            pending_tool_calls.write().await.remove(approval_token);
            return Err(
                "skill binding changed after approval prompt; request was cancelled".to_string(),
            );
        }
        if pending_tool_calls
            .write()
            .await
            .remove(approval_token)
            .is_none()
        {
            return Err("pending tool call already consumed".to_string());
        }
        let result = execute_skill_binding(store, &binding, &pending.arguments).await?;
        if let (Some(runtime), Some(key)) = (runtime_state, pending.approval_grant_key.as_deref()) {
            if let Some(grant) =
                crate::modules::mcp::SessionApprovalGrant::from_key(key, now as i128)
            {
                runtime
                    .session_approval_grants
                    .write()
                    .await
                    .insert(grant.key.clone(), grant);
            }
        }
        return Ok(result);
    }

    let tool = resolve_callable_mcp_tool_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await
    .map_err(|err| err.to_string())?;
    if let Some(runtime) = runtime_state {
        let current_fingerprint = runtime.tool_fingerprint(&tool);
        if current_fingerprint != pending.tool_fingerprint {
            pending_tool_calls.write().await.remove(approval_token);
            return Err(
                "tool configuration changed after approval prompt; request was cancelled"
                    .to_string(),
            );
        }
    }
    if pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_none()
    {
        return Err("pending tool call already consumed".to_string());
    }
    let result = execute_mcp_tool(store, &tool, &pending.arguments).await?;
    if let (Some(runtime), Some(key)) = (runtime_state, pending.approval_grant_key.as_deref()) {
        if let Some(grant) = crate::modules::mcp::SessionApprovalGrant::from_key(key, now as i128) {
            runtime
                .session_approval_grants
                .write()
                .await
                .insert(grant.key.clone(), grant);
        }
    }
    Ok(result)
}

pub(crate) async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::{resolve_official_skill_host_tool_route, OfficialSkillHostToolRoute};
    use crate::modules::mcp::store::LocalSkillToolBindingSnapshot;

    fn sample_binding(skill_id: &str) -> LocalSkillToolBindingSnapshot {
        LocalSkillToolBindingSnapshot {
            binding_id: "binding-demo".to_string(),
            binding_kind: "deeting_tool".to_string(),
            skill_id: skill_id.to_string(),
            callable_name: "demo.callable".to_string(),
            tool_name: "demo_tool".to_string(),
            description: "demo".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: "packages/official-skills/demo/main.py".to_string(),
            runtime: "python".to_string(),
            timeout_seconds: 30,
            updated_at: "2026-03-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn capability_bridge_registry_exposes_desktop_official_skill_capabilities() {
        let specs = [
            "skill_registry.refresh",
            "memory.append",
            "memory.search",
            "monitor.create",
            "monitor.list",
            "provider_preset.list",
            "provider_preset.upsert",
            "provider.verify",
            "cloud.provider_preset.list",
            "cloud.provider_preset.upsert",
        ];

        for capability_id in specs {
            let spec = crate::modules::mcp::desktop_capabilities::find_official_skill_capability(
                capability_id,
            )
            .unwrap_or_else(|| {
                panic!("missing desktop official-skill capability: {capability_id}")
            });
            assert_eq!(spec.id, capability_id);
            assert!(spec.callable_from_official_skill);
            if capability_id.starts_with("cloud.") {
                assert!(spec.admin_only);
            }
        }
    }

    #[test]
    fn capability_bridge_registry_does_not_treat_legacy_host_tool_names_as_contract() {
        assert!(
            crate::modules::mcp::desktop_capabilities::find_official_skill_capability(
                "register_local_skills",
            )
            .is_none()
        );
        assert!(
            crate::modules::mcp::desktop_capabilities::find_official_skill_capability(
                "list_user_memories",
            )
            .is_none()
        );
        assert!(
            crate::modules::mcp::desktop_capabilities::find_official_skill_capability(
                "create_monitor",
            )
            .is_none()
        );
    }

    #[test]
    fn official_skill_host_tool_route_allows_search_sdk_for_official_skills() {
        let binding = sample_binding("official.skills.expert_network");
        assert_eq!(
            resolve_official_skill_host_tool_route(&binding, "search_sdk"),
            OfficialSkillHostToolRoute::SearchSdk
        );
    }

    #[test]
    fn official_skill_host_tool_route_limits_shell_execute_to_skill_manager() {
        let skill_manager_binding = sample_binding("official.skills.skill_manager");
        assert_eq!(
            resolve_official_skill_host_tool_route(&skill_manager_binding, "shell_execute"),
            OfficialSkillHostToolRoute::ShellExecute
        );

        let other_binding = sample_binding("official.skills.expert_network");
        assert_eq!(
            resolve_official_skill_host_tool_route(&other_binding, "shell_execute"),
            OfficialSkillHostToolRoute::Unsupported
        );
    }

    #[test]
    fn official_skill_host_tool_route_preserves_desktop_capability_dispatch() {
        let binding = sample_binding("official.skills.monitor");
        assert_eq!(
            resolve_official_skill_host_tool_route(&binding, "monitor.list"),
            OfficialSkillHostToolRoute::DesktopCapability
        );
    }
}
