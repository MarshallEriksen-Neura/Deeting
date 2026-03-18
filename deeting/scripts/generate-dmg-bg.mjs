#!/usr/bin/env node
/**
 * generate-dmg-bg.mjs
 *
 * 将 DMG 背景 SVG 转换为 PNG（标准 + Retina）。
 * 在 macOS 上执行 `tauri build` 前运行:
 *   node scripts/generate-dmg-bg.mjs
 *
 * 依赖: brew install librsvg  (提供 rsvg-convert)
 *   或:  brew install imagemagick (提供 convert)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, "../src-tauri/images");
const SVG_PATH = resolve(IMAGES_DIR, "dmg-background.svg");
const PNG_1X = resolve(IMAGES_DIR, "background.png");
const PNG_2X = resolve(IMAGES_DIR, "background@2x.png");

function tryCommand(cmd) {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasCommand(name) {
  try {
    execSync(`which ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(SVG_PATH)) {
  console.error(`SVG not found: ${SVG_PATH}`);
  process.exit(1);
}

console.log("Generating DMG background images...");

if (hasCommand("rsvg-convert")) {
  // librsvg (最佳质量)
  execSync(`rsvg-convert -w 660 -h 400 "${SVG_PATH}" -o "${PNG_1X}"`);
  execSync(`rsvg-convert -w 1320 -h 800 "${SVG_PATH}" -o "${PNG_2X}"`);
  console.log("✓ Generated via rsvg-convert");
} else if (hasCommand("convert")) {
  // ImageMagick
  execSync(`convert -background none -resize 660x400 "${SVG_PATH}" "${PNG_1X}"`);
  execSync(`convert -background none -resize 1320x800 "${SVG_PATH}" "${PNG_2X}"`);
  console.log("✓ Generated via ImageMagick");
} else if (hasCommand("sips")) {
  // macOS 内置 (先用 qlmanage 导出再 sips 调整)
  // sips 不支持 SVG，降级提示
  console.warn("⚠ sips doesn't support SVG. Install librsvg:");
  console.warn("  brew install librsvg");
  console.warn("  Then re-run this script.");
  process.exit(1);
} else {
  console.error("No SVG converter found. Install one of:");
  console.error("  brew install librsvg");
  console.error("  brew install imagemagick");
  process.exit(1);
}

console.log(`  1x: ${PNG_1X}`);
console.log(`  2x: ${PNG_2X}`);
console.log("Done!");
