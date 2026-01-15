mod mcp_bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .manage(crate::mcp_bridge::McpBridgeState::new(
      "http://127.0.0.1:3000".to_string(),
    ))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      crate::mcp_bridge::set_mcp_backend_url,
      crate::mcp_bridge::start_mcp_log_stream,
      crate::mcp_bridge::stop_mcp_log_stream
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
