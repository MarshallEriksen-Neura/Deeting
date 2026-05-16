use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::modules::terminal::TerminalManager;

pub(super) const TERMINAL_CONTEXT_PEEK_TOOL_NAME: &str = "terminal_context_peek";
pub(super) const TERMINAL_CONTEXT_READ_TOOL_NAME: &str = "terminal_context_read";
pub(super) const TERMINAL_CONTEXT_PACK_TOOL_NAME: &str = "terminal_context_pack";
pub(super) const TERMINAL_WRITE_INPUT_TOOL_NAME: &str = "terminal_write_input";

pub(super) fn is_terminal_context_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        TERMINAL_CONTEXT_PEEK_TOOL_NAME
            | TERMINAL_CONTEXT_READ_TOOL_NAME
            | TERMINAL_CONTEXT_PACK_TOOL_NAME
            | TERMINAL_WRITE_INPUT_TOOL_NAME
    )
}

pub(super) fn execute_terminal_context_tool(
    app: &AppHandle,
    snapshot: Option<&Value>,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let Some(snapshot) = snapshot else {
        return Ok(json!({
            "available": false,
            "reason": "No terminal context snapshot was attached to this chat request."
        }));
    };

    match tool_name {
        TERMINAL_CONTEXT_PEEK_TOOL_NAME => Ok(peek(snapshot)),
        TERMINAL_CONTEXT_READ_TOOL_NAME => read(snapshot, arguments),
        TERMINAL_CONTEXT_PACK_TOOL_NAME => Ok(pack(snapshot, arguments)),
        TERMINAL_WRITE_INPUT_TOOL_NAME => write_input(app, snapshot, arguments),
        _ => Err(format!("unsupported terminal context tool '{tool_name}'")),
    }
}

fn write_input(app: &AppHandle, snapshot: &Value, arguments: &Value) -> Result<Value, String> {
    let resolved = resolve_terminal_snapshot(snapshot, arguments)?;
    let (session_id, text, payload, append_space) =
        prepare_input_payload(resolved.snapshot, arguments)?;

    let manager = app
        .try_state::<Arc<TerminalManager>>()
        .ok_or_else(|| "terminal manager is unavailable".to_string())?;

    manager
        .write(&session_id, payload.as_bytes())
        .map_err(|err| err.to_string())?;

    Ok(json!({
        "ok": true,
        "session_id": session_id,
        "text": text,
        "bytes_written": payload.len(),
        "appended_space": append_space,
        "wrote_newline": false,
    }))
}

fn prepare_input_payload(
    snapshot: &Value,
    arguments: &Value,
) -> Result<(String, String, String, bool), String> {
    let session_id = snapshot
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "terminal_write_input requires an active terminal session".to_string())?
        .to_string();

    let text = arguments
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "terminal_write_input requires a string 'text' argument".to_string())?
        .to_string();

    if text.is_empty() {
        return Err("terminal_write_input requires non-empty text".to_string());
    }

    if text.contains('\r') || text.contains('\n') {
        return Err(
            "terminal_write_input rejects newline characters because it must not execute the command"
                .to_string(),
        );
    }

    let append_space = arguments
        .get("append_space")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let payload = if append_space {
        format!("{text} ")
    } else {
        text.clone()
    };

    Ok((session_id, text, payload, append_space))
}

fn peek(snapshot: &Value) -> Value {
    if is_multi_terminal_context(snapshot) {
        return peek_multi(snapshot);
    }
    peek_single(snapshot)
}

fn peek_single(snapshot: &Value) -> Value {
    let commands = command_items(snapshot)
        .into_iter()
        .map(command_index_entry)
        .collect::<Vec<_>>();
    json!({
        "available": snapshot.get("available").and_then(Value::as_bool).unwrap_or(false),
        "session_id": snapshot.get("sessionId").and_then(Value::as_str),
        "shell": snapshot.get("shell").and_then(Value::as_str),
        "cwd": snapshot.get("cwd").and_then(Value::as_str),
        "captured_at": snapshot.get("capturedAt").and_then(Value::as_str),
        "active_process": snapshot.get("activeProcess").cloned().unwrap_or(Value::Null),
        "selection": snapshot.get("selection").map(|selection| {
            json!({
                "available": selection.get("text").and_then(Value::as_str).map(str::is_empty) == Some(false),
                "bytes": selection.get("bytes").and_then(Value::as_u64).unwrap_or(0),
            })
        }),
        "commands": commands,
    })
}

fn peek_multi(snapshot: &Value) -> Value {
    let active_session_id = active_session_id(snapshot);
    let sessions = terminal_session_entries(snapshot)
        .into_iter()
        .filter_map(|entry| {
            let context = terminal_session_context(entry)?;
            let session_id = terminal_session_id(entry).or_else(|| {
                context
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            let active = session_id.as_deref() == active_session_id.as_deref();
            let commands = command_items(context);
            let failed_command_count = commands
                .iter()
                .filter(|command| is_failed_or_error_like_command(command))
                .count();
            let running_command_count = commands
                .iter()
                .filter(|command| command.get("state").and_then(Value::as_str) == Some("running"))
                .count();
            let last_command = commands.last().copied().map(command_index_entry);
            let last_failed_command = commands
                .iter()
                .rev()
                .copied()
                .find(|command| is_failed_or_error_like_command(command))
                .map(command_index_entry);
            Some(json!({
                "session_id": session_id,
                "title": entry.get("title").and_then(Value::as_str),
                "status": entry.get("status").and_then(Value::as_str),
                "active": active,
                "summary": {
                    "command_count": commands.len(),
                    "failed_command_count": failed_command_count,
                    "running_command_count": running_command_count,
                    "has_selection": context
                        .get("selection")
                        .and_then(|selection| selection.get("text"))
                        .and_then(Value::as_str)
                        .map(|text| !text.trim().is_empty())
                        .unwrap_or(false),
                    "last_command": last_command,
                    "last_failed_command": last_failed_command,
                },
                "index": peek_single(context),
            }))
        })
        .collect::<Vec<_>>();

    json!({
        "available": !sessions.is_empty(),
        "active_session_id": active_session_id,
        "captured_at": snapshot.get("capturedAt").or_else(|| snapshot.get("captured_at")).and_then(Value::as_str),
        "sessions": sessions,
    })
}

fn is_failed_or_error_like_command(command: &Value) -> bool {
    command
        .get("exitCode")
        .and_then(Value::as_i64)
        .is_some_and(|value| value != 0)
        || command
            .get("hasErrorLikeOutput")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn command_index_entry(command: &Value) -> Value {
    json!({
        "id": command.get("id").and_then(Value::as_str),
        "command": command.get("command").and_then(Value::as_str),
        "state": command.get("state").and_then(Value::as_str),
        "exit_code": command.get("exitCode").and_then(Value::as_i64),
        "stream": command.get("stream").and_then(Value::as_str),
        "output_bytes": command.get("outputBytes").and_then(Value::as_u64).unwrap_or(0),
        "output_summary": command.get("outputSummary").and_then(Value::as_str).unwrap_or(""),
        "has_error_like_output": command.get("hasErrorLikeOutput").and_then(Value::as_bool).unwrap_or(false),
        "started_line": command.get("startedLine").and_then(Value::as_i64),
        "ended_line": command.get("endedLine").and_then(Value::as_i64),
    })
}

fn read(snapshot: &Value, arguments: &Value) -> Result<Value, String> {
    let resolved = resolve_terminal_snapshot(snapshot, arguments)?;
    let mut result = read_single(resolved.snapshot, arguments)?;
    if let Some(session_id) = resolved.session_id {
        if let Some(object) = result.as_object_mut() {
            object.insert("session_id".to_string(), json!(session_id));
        }
    }
    Ok(result)
}

fn read_single(snapshot: &Value, arguments: &Value) -> Result<Value, String> {
    let target = arguments
        .get("target")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("last_command");
    let range = arguments
        .get("range")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tail");
    let max_bytes = arguments
        .get("max_bytes")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(256, 24_000) as usize)
        .unwrap_or(8_000);

    if target == "selection" {
        let text = snapshot
            .get("selection")
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("");
        return Ok(json!({
            "target": "selection",
            "range": range,
            "content": slice_text(text, range, max_bytes),
            "bytes": text.len(),
            "truncated": text.len() > max_bytes,
        }));
    }

    let command = resolve_command_target(snapshot, target)
        .ok_or_else(|| format!("terminal context target '{target}' was not found"))?;
    let output = command.get("output").and_then(Value::as_str).unwrap_or("");
    Ok(json!({
        "target": command.get("id").and_then(Value::as_str).unwrap_or(target),
        "range": range,
        "command": command.get("command").and_then(Value::as_str),
        "state": command.get("state").and_then(Value::as_str),
        "exit_code": command.get("exitCode").and_then(Value::as_i64),
        "content": slice_text(output, range, max_bytes),
        "bytes": output.len(),
        "truncated": output.len() > max_bytes,
    }))
}

fn pack(snapshot: &Value, arguments: &Value) -> Value {
    let resolved = match resolve_terminal_snapshot(snapshot, arguments) {
        Ok(resolved) => resolved,
        Err(error) => {
            return json!({
                "available": false,
                "error": error,
                "index": peek(snapshot),
                "selected_context": [],
            });
        }
    };
    let mut result = pack_single(resolved.snapshot, arguments);
    if let Some(session_id) = resolved.session_id {
        if let Some(object) = result.as_object_mut() {
            object.insert("session_id".to_string(), json!(session_id));
        }
    }
    result
}

fn pack_single(snapshot: &Value, arguments: &Value) -> Value {
    let goal = arguments
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("answer the user's current question");
    let max_bytes = arguments
        .get("max_bytes")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(512, 32_000) as usize)
        .unwrap_or(12_000);

    let mut selected = Vec::new();
    if let Some(selection) = snapshot
        .get("selection")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        selected.push(json!({
            "kind": "selection",
            "content": slice_text(selection, "full", max_bytes / 2),
        }));
    }

    if selected.is_empty() {
        if let Some(command) = select_relevant_command(snapshot) {
            let output = command.get("output").and_then(Value::as_str).unwrap_or("");
            selected.push(json!({
                "kind": "command",
                "id": command.get("id").and_then(Value::as_str),
                "command": command.get("command").and_then(Value::as_str),
                "state": command.get("state").and_then(Value::as_str),
                "exit_code": command.get("exitCode").and_then(Value::as_i64),
                "content": slice_text(output, "tail", max_bytes),
            }));
        }
    }

    json!({
        "goal": goal,
        "terminal": {
            "available": snapshot.get("available").and_then(Value::as_bool).unwrap_or(false),
            "session_id": snapshot.get("sessionId").and_then(Value::as_str),
            "shell": snapshot.get("shell").and_then(Value::as_str),
            "cwd": snapshot.get("cwd").and_then(Value::as_str),
            "captured_at": snapshot.get("capturedAt").and_then(Value::as_str),
            "active_process": snapshot.get("activeProcess").cloned().unwrap_or(Value::Null),
        },
        "selected_context": selected,
        "index": peek(snapshot),
    })
}

struct ResolvedTerminalSnapshot<'a> {
    session_id: Option<String>,
    snapshot: &'a Value,
}

fn resolve_terminal_snapshot<'a>(
    snapshot: &'a Value,
    arguments: &Value,
) -> Result<ResolvedTerminalSnapshot<'a>, String> {
    let requested_session_id = requested_session_id(arguments);
    if !is_multi_terminal_context(snapshot) {
        let session_id = snapshot
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let (Some(requested), Some(actual)) =
            (requested_session_id.as_deref(), session_id.as_deref())
        {
            if requested != actual {
                return Err(format!("terminal session '{requested}' was not found"));
            }
        }
        return Ok(ResolvedTerminalSnapshot {
            session_id,
            snapshot,
        });
    }

    let active_session_id = active_session_id(snapshot);
    let target_session_id = requested_session_id.or(active_session_id);
    let entries = terminal_session_entries(snapshot);
    let selected = if let Some(target_session_id) = target_session_id.as_deref() {
        entries.into_iter().find(|entry| {
            terminal_session_id(entry)
                .as_deref()
                .is_some_and(|session_id| session_id == target_session_id)
                || terminal_session_context(entry)
                    .and_then(|context| context.get("sessionId"))
                    .and_then(Value::as_str)
                    .is_some_and(|session_id| session_id == target_session_id)
        })
    } else {
        entries.into_iter().next()
    };

    let Some(entry) = selected else {
        return Err(match target_session_id {
            Some(session_id) => format!("terminal session '{session_id}' was not found"),
            None => "no terminal session context is available".to_string(),
        });
    };
    let context = terminal_session_context(entry)
        .ok_or_else(|| "selected terminal session has no context".to_string())?;
    let session_id = terminal_session_id(entry).or_else(|| {
        context
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    Ok(ResolvedTerminalSnapshot {
        session_id,
        snapshot: context,
    })
}

fn is_multi_terminal_context(snapshot: &Value) -> bool {
    snapshot.get("version").and_then(Value::as_i64) == Some(2)
        || snapshot.get("sessions").and_then(Value::as_array).is_some()
}

fn requested_session_id(arguments: &Value) -> Option<String> {
    arguments
        .get("session_id")
        .or_else(|| arguments.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn active_session_id(snapshot: &Value) -> Option<String> {
    snapshot
        .get("activeSessionId")
        .or_else(|| snapshot.get("active_session_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn terminal_session_entries(snapshot: &Value) -> Vec<&Value> {
    snapshot
        .get("sessions")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn terminal_session_context(entry: &Value) -> Option<&Value> {
    entry.get("context").filter(|value| value.is_object())
}

fn terminal_session_id(entry: &Value) -> Option<String> {
    entry
        .get("sessionId")
        .or_else(|| entry.get("session_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn command_items(snapshot: &Value) -> Vec<&Value> {
    snapshot
        .get("commands")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn resolve_command_target<'a>(snapshot: &'a Value, target: &str) -> Option<&'a Value> {
    let commands = command_items(snapshot);
    match target {
        "last_command" => commands.last().copied(),
        "active_process" | "running" => commands
            .iter()
            .rev()
            .copied()
            .find(|command| command.get("state").and_then(Value::as_str) == Some("running")),
        "last_failed_command" | "last_error" => commands
            .iter()
            .rev()
            .copied()
            .find(|command| is_failed_or_error_like_command(command)),
        _ => commands
            .into_iter()
            .find(|command| command.get("id").and_then(Value::as_str) == Some(target)),
    }
}

fn select_relevant_command(snapshot: &Value) -> Option<&Value> {
    resolve_command_target(snapshot, "last_failed_command")
        .or_else(|| resolve_command_target(snapshot, "active_process"))
        .or_else(|| resolve_command_target(snapshot, "last_command"))
}

fn slice_text(value: &str, range: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    match range {
        "head" | "full" => take_utf8_prefix(value, max_bytes),
        _ => take_utf8_suffix(value, max_bytes),
    }
}

fn take_utf8_prefix(value: &str, max_bytes: usize) -> String {
    let mut end = 0;
    for (index, char) in value.char_indices() {
        let next = index + char.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    value[..end].to_string()
}

fn take_utf8_suffix(value: &str, max_bytes: usize) -> String {
    let mut start = value.len();
    let mut used = 0;
    for (index, char) in value.char_indices().rev() {
        let next = used + char.len_utf8();
        if next > max_bytes {
            break;
        }
        used = next;
        start = index;
    }
    value[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_selects_last_failed_command() {
        let snapshot = json!({
            "available": true,
            "commands": [
                {"id": "cmd_1", "command": "echo ok", "state": "completed", "exitCode": 0, "output": "ok"},
                {"id": "cmd_2", "command": "bun dev", "state": "completed", "exitCode": 1, "output": "error failed"}
            ]
        });

        let result = read(
            &snapshot,
            &json!({"target": "last_failed_command", "range": "tail", "max_bytes": 1000}),
        )
        .expect("read result");

        assert_eq!(result["target"], json!("cmd_2"));
        assert_eq!(result["content"], json!("error failed"));
    }

    #[test]
    fn pack_prefers_selection_over_command_output() {
        let snapshot = json!({
            "available": true,
            "selection": {"text": "selected error", "bytes": 14},
            "commands": [
                {"id": "cmd_1", "command": "bun dev", "state": "completed", "exitCode": 1, "output": "full output"}
            ]
        });

        let result = pack(&snapshot, &json!({"goal": "diagnose"}));

        assert_eq!(result["selected_context"][0]["kind"], json!("selection"));
        assert_eq!(
            result["selected_context"][0]["content"],
            json!("selected error")
        );
    }

    #[test]
    fn peek_indexes_multi_terminal_context() {
        let snapshot = json!({
            "version": 2,
            "activeSessionId": "term-2",
            "sessions": [
                {
                    "sessionId": "term-1",
                    "title": "Terminal 1",
                    "status": "ready",
                    "context": {"available": true, "sessionId": "term-1", "commands": []}
                },
                {
                    "sessionId": "term-2",
                    "title": "Terminal 2",
                    "status": "ready",
                    "context": {"available": true, "sessionId": "term-2", "selection": {"text": "selected", "bytes": 8}, "commands": [
                        {"id": "cmd_1", "command": "pwd", "state": "completed", "exitCode": 0, "output": "D:/repo"},
                        {"id": "cmd_2", "command": "bun test", "state": "completed", "exitCode": 1, "output": "failed", "outputSummary": "failed"}
                    ]}
                }
            ]
        });

        let result = peek(&snapshot);

        assert_eq!(result["active_session_id"], json!("term-2"));
        assert_eq!(result["sessions"].as_array().unwrap().len(), 2);
        assert_eq!(result["sessions"][1]["active"], json!(true));
        assert_eq!(
            result["sessions"][1]["index"]["session_id"],
            json!("term-2")
        );
        assert_eq!(result["sessions"][1]["summary"]["command_count"], json!(2));
        assert_eq!(
            result["sessions"][1]["summary"]["failed_command_count"],
            json!(1)
        );
        assert_eq!(
            result["sessions"][1]["summary"]["has_selection"],
            json!(true)
        );
        assert_eq!(
            result["sessions"][1]["summary"]["last_failed_command"]["id"],
            json!("cmd_2")
        );
    }

    #[test]
    fn read_can_target_specific_terminal_session() {
        let snapshot = json!({
            "version": 2,
            "activeSessionId": "term-1",
            "sessions": [
                {
                    "sessionId": "term-1",
                    "context": {"available": true, "sessionId": "term-1", "commands": [
                        {"id": "cmd_1", "command": "echo one", "state": "completed", "exitCode": 0, "output": "one"}
                    ]}
                },
                {
                    "sessionId": "term-2",
                    "context": {"available": true, "sessionId": "term-2", "commands": [
                        {"id": "cmd_1", "command": "echo two", "state": "completed", "exitCode": 0, "output": "two"}
                    ]}
                }
            ]
        });

        let result = read(
            &snapshot,
            &json!({"session_id": "term-2", "target": "last_command"}),
        )
        .expect("read result");

        assert_eq!(result["session_id"], json!("term-2"));
        assert_eq!(result["command"], json!("echo two"));
        assert_eq!(result["content"], json!("two"));
    }

    #[test]
    fn slice_text_respects_utf8_byte_budget() {
        assert_eq!(slice_text("中文abcdef", "head", 7), "中文");
        assert_eq!(slice_text("abcdef中文", "tail", 7), "文");
    }

    #[test]
    fn prepare_input_payload_rejects_newline_characters() {
        let error = prepare_input_payload(
            &json!({"sessionId": "session-1"}),
            &json!({"text": "npm test\n"}),
        )
        .expect_err("newline should be rejected");

        assert!(error.contains("must not execute the command"));
    }

    #[test]
    fn prepare_input_payload_requires_active_session() {
        let error = prepare_input_payload(&json!({}), &json!({"text": "npm test"}))
            .expect_err("missing session should be rejected");

        assert!(error.contains("active terminal session"));
    }

    #[test]
    fn prepare_input_payload_can_append_trailing_space_without_newline() {
        let (session_id, text, payload, append_space) = prepare_input_payload(
            &json!({"sessionId": "session-1"}),
            &json!({"text": "git status", "append_space": true}),
        )
        .expect("payload should be prepared");

        assert_eq!(session_id, "session-1");
        assert_eq!(text, "git status");
        assert_eq!(payload, "git status ");
        assert!(append_space);
    }
}
