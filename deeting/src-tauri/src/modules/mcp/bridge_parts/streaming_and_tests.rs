async fn stream_logs(
    client: &reqwest::Client,
    base_url: &str,
    tool_id: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let url = format!(
        "{}/mcp/tools/{}/logs/stream",
        base_url.trim_end_matches('/'),
        tool_id
    );
    let response = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("log stream http status {}", response.status()));
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(bytes) => bytes,
            Err(err) => return Err(err.to_string()),
        };
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);
        while let Some(pos) = buffer.find("\n\n") {
            let raw_event = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();
            if let Some(payload) = parse_sse_data(&raw_event, tool_id) {
                let event_name = format!("mcp-log://{}", tool_id);
                if let Err(err) = app.emit(&event_name, payload) {
                    warn!("failed to emit mcp log event: {}", err);
                }
            }
        }
    }

    Ok(())
}

fn parse_sse_data(raw_event: &str, tool_id: &str) -> Option<serde_json::Value> {
    let mut data_lines = Vec::new();
    for line in raw_event.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim());
        }
    }
    if data_lines.is_empty() {
        return None;
    }

    let data = data_lines.join("\n");
    match serde_json::from_str(&data) {
        Ok(value) => Some(value),
        Err(_) => Some(
            serde_json::to_value(LogFallbackPayload {
                tool_id: tool_id.to_string(),
                raw: data,
            })
            .ok()?,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_json_payload() {
        let raw = "data: {\"message\":\"ok\"}\n\n";
        let payload = parse_sse_data(raw, "tool-1").unwrap();
        assert_eq!(payload["message"], "ok");
    }

    #[test]
    fn parse_sse_multiline_payload() {
        let raw = "data: {\"message\":\"line1\"}\n\ndata: {\"message\":\"line2\"}\n\n";
        let payload = parse_sse_data(raw, "tool-1").unwrap();
        assert!(payload.get("raw").is_some());
    }
}
