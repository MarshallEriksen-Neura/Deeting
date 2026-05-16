import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tauriEnv from "./tauri-env.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const { loadDesktopEnv, buildTauriEnv } = tauriEnv;
const isDevCommand = args[0] === "dev";
const isHelpRequest = args.includes("--help") || args.includes("-h");

const isWindows = process.platform === "win32";
const protocBinary = isWindows ? "protoc.exe" : "protoc";
const commandChecker = isWindows ? "where" : "which";
const desktopDevUrl = "http://localhost:3000";
const desktopDevConfig = "src-tauri/tauri.desktop-dev.conf.json";

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
  dev: isDevCommand,
});

function buildDesktopEnv(protocPath) {
  return buildTauriEnv(
    {
      ...process.env,
    },
    protocPath
  );
}

function requestUrl(targetUrl) {
  const client = targetUrl.startsWith("https:") ? https : http;

  return new Promise((resolve) => {
    const request = client.get(targetUrl, (response) => {
      response.resume();
      resolve(response.statusCode ? response.statusCode < 500 : true);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await requestUrl(targetUrl)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function hasConfigArg(cliArgs) {
  return cliArgs.some((arg, index) => {
    if (arg.startsWith("--config=")) {
      return true;
    }
    return arg === "--config" && index < cliArgs.length - 1;
  });
}

function ensureDesktopDevConfig(cliArgs) {
  if (!isDevCommand || isHelpRequest || hasConfigArg(cliArgs)) {
    return cliArgs;
  }

  return [...cliArgs, "--config", desktopDevConfig];
}

function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (isWindows) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

async function ensureDesktopDevServer(protocPath) {
  if (!isDevCommand || isHelpRequest) {
    return null;
  }

  if (await waitForUrl(desktopDevUrl, 1500)) {
    return null;
  }

  const child = spawn("bun", ["run", "dev", "--", "--port", "3000"], {
    cwd: projectRoot,
    env: buildDesktopEnv(protocPath),
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  child.on("error", (error) => {
    console.error(`[tauri-with-protoc] desktop web dev server failed to start: ${error.message}`);
  });

  const ready = await waitForUrl(desktopDevUrl, 60000);
  if (!ready) {
    killProcessTree(child.pid);
    console.error("[tauri-with-protoc] desktop web dev server did not become ready on http://localhost:3000 within 60s.");
    process.exit(1);
  }

  return child;
}

async function main() {
  const protocPath = resolveProtoc();
  if (!protocPath) {
    console.error("[tauri-with-protoc] protoc not found. Rust build will fail.");
    console.error(
      "[tauri-with-protoc] Install protoc or place it at .codex-cache/protoc-33.2/bin and retry."
    );
    process.exit(1);
  }

  const devServerChild = await ensureDesktopDevServer(protocPath);
  const tauriArgs = ensureDesktopDevConfig(args);
  const tauriCommand = resolveTauriCommand();
  const tauriUseShell =
    isWindows && (tauriCommand === "tauri" || tauriCommand.endsWith(".cmd"));

  const tauriResult = spawnSync(tauriCommand, tauriArgs, {
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

  if (devServerChild) {
    killProcessTree(devServerChild.pid);
  }

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
}

await main();
