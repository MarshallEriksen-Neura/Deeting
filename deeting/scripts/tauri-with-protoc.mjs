import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tauriEnv from "./tauri-env.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const { loadDesktopEnv, buildTauriEnv } = tauriEnv;

const isWindows = process.platform === "win32";
const protocBinary = isWindows ? "protoc.exe" : "protoc";
const commandChecker = isWindows ? "where" : "which";

function commandExists(command) {
  const result = spawnSync(commandChecker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function resolveLocalProtoc() {
  const candidates = [
    path.resolve(projectRoot, "..", ".tmp", "protoc", "bin", protocBinary),
    path.resolve(projectRoot, ".tmp", "protoc", "bin", protocBinary),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveProtoc() {
  const protocFromEnv = process.env.PROTOC;
  if (protocFromEnv && existsSync(protocFromEnv)) {
    return protocFromEnv;
  }

  if (commandExists("protoc")) {
    return "protoc";
  }

  return resolveLocalProtoc() || "";
}

function resolveTauriCommand() {
  const localTauri = path.resolve(
    projectRoot,
    "node_modules",
    ".bin",
    isWindows ? "tauri.cmd" : "tauri"
  );
  if (existsSync(localTauri)) {
    return localTauri;
  }
  return "tauri";
}

loadDesktopEnv(projectRoot, {
  dev: args[0] === "dev",
});

const protocPath = resolveProtoc();
if (!protocPath) {
  console.error("[tauri-with-protoc] protoc not found. Rust build will fail.");
  console.error(
    "[tauri-with-protoc] Install protoc or place it at .tmp/protoc/bin and retry."
  );
  process.exit(1);
}

const tauriResult = spawnSync(resolveTauriCommand(), args, {
  cwd: projectRoot,
  env: buildTauriEnv(
    {
      ...process.env,
      ...(args[0] === "build" ? { DEETING_DESKTOP_EXPORT: "true" } : {}),
    },
    protocPath
  ),
  shell: false,
  stdio: "inherit",
});

if (tauriResult.error) {
  console.error(
    `[tauri-with-protoc] failed to execute tauri CLI: ${tauriResult.error.message}`
  );
  console.error(
    "[tauri-with-protoc] Install dependencies first (npm install / bun install) so @tauri-apps/cli is available."
  );
  process.exit(1);
}

process.exit(tauriResult.status ?? 1);
