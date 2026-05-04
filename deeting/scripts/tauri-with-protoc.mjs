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
    path.resolve(projectRoot, "..", ".codex-cache", "protoc-33.2", "bin", protocBinary),
    path.resolve(projectRoot, ".codex-cache", "protoc-33.2", "bin", protocBinary),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveProtoc() {
  const protocFromEnv = process.env.PROTOC;
  if (protocFromEnv && existsSync(protocFromEnv)) {
    return protocFromEnv;
  }

  const localProtoc = resolveLocalProtoc();
  if (localProtoc) {
    return localProtoc;
  }

  if (commandExists("protoc")) {
    return "protoc";
  }

  return "";
}

function resolveTauriCommand() {
  const binDir = path.resolve(projectRoot, "node_modules", ".bin");

  // On Windows, spawning `.cmd` directly with `shell: false` fails (EINVAL).
  // Prefer the native binary if present, otherwise fall back to the shim.
  const candidates = isWindows
    ? ["tauri.exe", "tauri.cmd"]
    : ["tauri"];

  for (const candidate of candidates) {
    const resolved = path.resolve(binDir, candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
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
    "[tauri-with-protoc] Install protoc or place it at .codex-cache/protoc-33.2/bin and retry."
  );
  process.exit(1);
}

const tauriCommand = resolveTauriCommand();
const tauriUseShell =
  isWindows && (tauriCommand === "tauri" || tauriCommand.endsWith(".cmd"));

const tauriResult = spawnSync(tauriCommand, args, {
  cwd: projectRoot,
  env: buildTauriEnv(
    {
      ...process.env,
      ...(args[0] === "build" ? { DEETING_DESKTOP_EXPORT: "true" } : {}),
    },
    protocPath
  ),
  shell: tauriUseShell,
  stdio: "inherit",
});

if (tauriResult.error) {
  console.error(
    `[tauri-with-protoc] failed to execute tauri CLI: ${tauriResult.error.message}`
  );
  if (isWindows && tauriResult.error.code === "EINVAL") {
    console.error(
      "[tauri-with-protoc] On Windows, .cmd shims require running under a shell. Prefer node_modules/.bin/tauri.exe or rerun with dependencies installed."
    );
  } else {
    console.error(
      "[tauri-with-protoc] Install dependencies first (npm install / bun install) so @tauri-apps/cli is available."
    );
  }
  process.exit(1);
}

process.exit(tauriResult.status ?? 1);
