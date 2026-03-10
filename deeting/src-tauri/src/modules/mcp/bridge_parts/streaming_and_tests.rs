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
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use tokio::time::{timeout, Duration};

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

    struct NotifyOnDrop(Option<oneshot::Sender<()>>);

    impl Drop for NotifyOnDrop {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    #[tokio::test]
    async fn stop_stream_aborts_and_removes_registered_handle() {
        let state = Arc::new(McpBridgeState::new("https://mcp.example.com".to_string()));
        let (dropped_tx, dropped_rx) = oneshot::channel();

        let handle = tauri::async_runtime::spawn(async move {
            let _guard = NotifyOnDrop(Some(dropped_tx));
            futures_util::future::pending::<()>().await;
        });

        state
            .streams
            .lock()
            .await
            .insert("tool-1".to_string(), handle);

        assert!(state.stop_stream("tool-1").await);
        assert_eq!(state.streams.lock().await.len(), 0);
        assert!(timeout(Duration::from_secs(1), dropped_rx).await.is_ok());
    }

    #[tokio::test]
    async fn stop_stream_is_noop_when_handle_is_missing() {
        let state = Arc::new(McpBridgeState::new("https://mcp.example.com".to_string()));

        assert!(!state.stop_stream("missing-tool").await);
        assert_eq!(state.streams.lock().await.len(), 0);
    }
}
