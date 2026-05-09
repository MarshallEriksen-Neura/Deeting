const { loadEnvConfig } = require("@next/env")

function loadDesktopEnv(projectRoot, options = {}) {
  const { dev = false, forceReload = false } = options
  return loadEnvConfig(projectRoot, dev, console, forceReload)
}

function buildTauriEnv(baseEnv, protocPath) {
  return {
    ...baseEnv,
    NEXT_PUBLIC_IS_TAURI: "true",
    PROTOC: protocPath,
    // Increase Rust compiler stack size to avoid STATUS_STACK_BUFFER_OVERRUN
    // during compilation of heavy-generics crates (lancedb, arrow, sqlx, etc.)
    RUST_MIN_STACK: baseEnv.RUST_MIN_STACK || "8388608",
  }
}

module.exports = {
  loadDesktopEnv,
  buildTauriEnv,
}
