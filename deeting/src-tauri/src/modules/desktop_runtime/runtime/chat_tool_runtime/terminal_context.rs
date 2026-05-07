use serde_json::{json, Value};

pub(super) const TERMINAL_CONTEXT_PEEK_TOOL_NAME: &str = "terminal_context_peek";
pub(super) const TERMINAL_CONTEXT_READ_TOOL_NAME: &str = "terminal_context_read";
pub(super) const TERMINAL_CONTEXT_PACK_TOOL_NAME: &str = "terminal_context_pack";

pub(super) fn is_terminal_context_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        TERMINAL_CONTEXT_PEEK_TOOL_NAME
            | TERMINAL_CONTEXT_READ_TOOL_NAME
            | TERMINAL_CONTEXT_PACK_TOOL_NAME
    )
}

pub(super) fn execute_terminal_context_tool(
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
        _ => Err(format!("unsupported terminal context tool '{tool_name}'")),
    }
}

fn peek(snapshot: &Value) -> Value {
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
        "last_failed_command" | "last_error" => commands.iter().rev().copied().find(|command| {
            command
                .get("exitCode")
                .and_then(Value::as_i64)
                .is_some_and(|value| value != 0)
                || command
                    .get("hasErrorLikeOutput")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        }),
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
    fn slice_text_respects_utf8_byte_budget() {
        assert_eq!(slice_text("中文abcdef", "head", 7), "中文");
        assert_eq!(slice_text("abcdef中文", "tail", 7), "文");
    }
}
