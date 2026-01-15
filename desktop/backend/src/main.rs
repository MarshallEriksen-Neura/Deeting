use std::{net::SocketAddr, path::PathBuf};

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, Router},
    Json,
};
use serde::Serialize;
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;

mod mcp;
mod state;

use crate::state::AppState;

#[derive(Serialize)]
struct HealthPayload {
    status: &'static str,
    uptime_ms: u128,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3000);

    let database_url = resolve_database_url()?;
    let store = std::sync::Arc::new(mcp::McpStore::new(&database_url).await?);
    store.init().await?;
    let _ = store.ensure_local_source().await?;

    let state = AppState {
        version: env!("CARGO_PKG_VERSION"),
        store: store.clone(),
        process_manager: mcp::ProcessManager::new(store),
    };
    let router = Router::new()
        .route("/", get(root))
        .route("/healthz", get(healthz))
        .route("/version", get(version))
        .nest("/mcp", mcp::routes::router())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("desktop-backend listening on http://{}", addr);
    axum::serve(
        axum::Server::bind(&addr),
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn root() -> impl IntoResponse {
    (StatusCode::OK, "desktop-backend ok")
}

async fn version(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "service": "desktop-backend",
        "version": state.version,
    }))
}

async fn healthz() -> impl IntoResponse {
    // TODO: plug in real checks (local index, disk space, background workers)
    let payload = HealthPayload {
        status: "ok",
        uptime_ms: app_start_time().elapsed().as_millis(),
    };
    (StatusCode::OK, Json(payload))
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("desktop_backend=info,axum=info"));
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

static APP_START: once_cell::sync::Lazy<std::time::Instant> =
    once_cell::sync::Lazy::new(std::time::Instant::now);

fn app_start_time() -> &'static std::time::Instant {
    &APP_START
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        sigterm.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

fn resolve_database_url() -> anyhow::Result<String> {
    let db_path = std::env::var("DESKTOP_DB_PATH").unwrap_or_else(|_| default_db_path());
    if db_path == ":memory:" {
        return Ok("sqlite::memory:".to_string());
    }
    if db_path.starts_with("sqlite:") {
        return Ok(db_path);
    }
    let expanded = expand_path(&db_path);
    if let Some(parent) = expanded.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(format!("sqlite://{}", expanded.to_string_lossy()))
}

fn default_db_path() -> String {
    if let Ok(home) = std::env::var("HOME") {
        return format!("{home}/.config/deeting/mcp.db");
    }
    "mcp.db".to_string()
}

fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}
