// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::var("DEETING_WECHAT_BRIDGE_MODE").ok().as_deref() == Some("1") {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("wechat bridge runtime");
        runtime.block_on(async {
            app_lib::modules::im::wechat::bridge_entry::run_stdio_bridge().await;
        });
        return;
    }

    app_lib::run();
}
