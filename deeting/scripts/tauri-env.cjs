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
  }
}

module.exports = {
  loadDesktopEnv,
  buildTauriEnv,
}
