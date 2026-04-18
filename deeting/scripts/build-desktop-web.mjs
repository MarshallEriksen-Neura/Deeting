import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { postprocessDesktopExport } = require("./desktop-export-postprocess.cjs");
const isWindows = process.platform === "win32";

function resolveNextCommand() {
  const localNextCandidates = isWindows
    ? ["next.exe", "next.cmd"]
    : ["next"];

  for (const candidate of localNextCandidates) {
    const localNext = path.join(projectRoot, "node_modules", ".bin", candidate);
    if (existsSync(localNext)) {
      return localNext;
    }
  }

  return "next";
}

let exitCode = 1;
const nextCommand = resolveNextCommand();
const nextUseShell =
  isWindows && (nextCommand === "next" || nextCommand.endsWith(".cmd"));

const result = spawnSync(nextCommand, ["build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DEETING_DESKTOP_EXPORT: "true",
  },
  shell: nextUseShell,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[build-desktop-web] failed to execute next build: ${result.error.message}`);
  exitCode = 1;
} else {
  exitCode = result.status ?? 1;
}

if (exitCode === 0) {
  try {
    const { defaultLocale, copiedPaths } = postprocessDesktopExport(projectRoot);

    if (copiedPaths.length > 0) {
      console.log(
        `[build-desktop-web] mirrored ${copiedPaths.length} ${defaultLocale} export file(s) into unprefixed desktop paths.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[build-desktop-web] desktop export postprocess failed: ${message}`);
    exitCode = 1;
  }
}

process.exit(exitCode);
