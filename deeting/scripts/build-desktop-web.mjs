import { mkdirSync, renameSync, existsSync, rmSync } from "node:fs";
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

const disabledDesktopEntries = [
  "app/[locale]/@auth/[...catchAll]",
  "app/[locale]/@auth/(.)login",
  "app/[locale]/admin",
  "app/[locale]/docs",
  "app/[locale]/download",
  "app/[locale]/gallery",
  "app/[locale]/plugins",
  "app/[locale]/plugins/market",
  "app/[locale]/spec-agent",
  "app/[locale]/video",
  "app/[locale]/videos",
  "public/docs",
  "public/images/logo.svg",
  "public/images/deeting.jpeg",
];

const hiddenRoot = path.join(projectRoot, ".tmp", "desktop-export-disabled-routes");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function moveEntry(fromRelative, toRoot) {
  const fromPath = path.join(projectRoot, fromRelative);
  if (!existsSync(fromPath)) return null;
  const toPath = path.join(toRoot, fromRelative);
  ensureDir(path.dirname(toPath));
  if (existsSync(toPath)) {
    rmSync(toPath, { recursive: true, force: true });
  }
  renameSync(fromPath, toPath);
  return { fromPath, toPath };
}

function resolveNextCommand() {
  const localNext = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    isWindows ? "next.cmd" : "next"
  );
  return existsSync(localNext) ? localNext : "next";
}

const movedRoutes = [];
let exitCode = 1;

try {
  ensureDir(hiddenRoot);
  for (const routeEntry of disabledDesktopEntries) {
    const moved = moveEntry(routeEntry, hiddenRoot);
    if (moved) movedRoutes.push(moved);
  }

  const result = spawnSync(resolveNextCommand(), ["build"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DEETING_DESKTOP_EXPORT: "true",
    },
    shell: false,
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
} finally {
  for (let i = movedRoutes.length - 1; i >= 0; i -= 1) {
    const moved = movedRoutes[i];
    if (existsSync(moved.toPath)) {
      ensureDir(path.dirname(moved.fromPath));
      renameSync(moved.toPath, moved.fromPath);
    }
  }
}

process.exit(exitCode);
