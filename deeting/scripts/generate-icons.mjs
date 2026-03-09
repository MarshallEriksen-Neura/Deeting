import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourceIcon = path.resolve(projectRoot, "public/images/app-icon.svg");
const tauriIconsDir = path.resolve(projectRoot, "src-tauri/icons");
const publicDir = path.resolve(projectRoot, "public");
const tempDir = path.resolve(projectRoot, ".tmp/icon-build");
const isWindows = process.platform === "win32";

function resolveTauriCommand() {
  const localTauri = path.resolve(
    projectRoot,
    "node_modules",
    ".bin",
    isWindows ? "tauri.cmd" : "tauri"
  );
  return existsSync(localTauri) ? localTauri : "tauri";
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function brandBackgroundSvg(width, height) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#12081F" />
          <stop offset="55%" stop-color="#31125B" />
          <stop offset="100%" stop-color="#3F0EA8" />
        </linearGradient>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#8A2BE2" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#FFD95A" stop-opacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" rx="10" fill="url(#bg)" />
      <circle cx="${Math.round(width * 0.15)}" cy="${Math.round(height * 0.18)}" r="${Math.round(height * 0.45)}" fill="#FFFFFF" opacity="0.06" />
      <circle cx="${Math.round(width * 0.9)}" cy="${Math.round(height * 0.82)}" r="${Math.round(height * 0.35)}" fill="url(#glow)" opacity="0.12" />
    </svg>
  `);
}

function encodeBmp({ data, width, height, channels }) {
  if (channels < 3) {
    throw new Error("BMP encoding requires at least RGB channels");
  }

  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelArraySize, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let row = 0; row < height; row += 1) {
    const srcY = height - 1 - row;
    const destRowStart = 54 + row * rowSize;
    const srcRowStart = srcY * width * channels;

    for (let x = 0; x < width; x += 1) {
      const src = srcRowStart + x * channels;
      const dest = destRowStart + x * 3;
      buffer[dest] = data[src + 2];
      buffer[dest + 1] = data[src + 1];
      buffer[dest + 2] = data[src];
    }
  }

  return buffer;
}

async function writeBmp(outputPath, image) {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  writeFileSync(
    outputPath,
    encodeBmp({ data, width: info.width, height: info.height, channels: info.channels })
  );
}

async function createNsisHeader(iconPath) {
  const width = 150;
  const height = 57;
  const icon = await sharp(iconPath).resize(28, 28, { fit: "contain" }).png().toBuffer();
  const text = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="48" y="27" fill="#FFFFFF" font-size="16" font-weight="700" font-family="Arial, Helvetica, sans-serif">Deeting</text>
      <text x="48" y="42" fill="#D6C7FF" font-size="9" font-family="Arial, Helvetica, sans-serif">Desktop Setup</text>
    </svg>
  `);

  await writeBmp(
    path.join(tauriIconsDir, "nsis-header.bmp"),
    sharp(brandBackgroundSvg(width, height))
      .composite([
        { input: icon, left: 12, top: 14 },
        { input: text, left: 0, top: 0 },
      ])
      .flatten({ background: "#1B1036" })
  );
}

async function createNsisSidebar(iconPath) {
  const width = 164;
  const height = 314;
  const icon = await sharp(iconPath).resize(90, 90, { fit: "contain" }).png().toBuffer();
  const text = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="82" y="208" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="700" font-family="Arial, Helvetica, sans-serif">Deeting</text>
      <text x="82" y="232" text-anchor="middle" fill="#D6C7FF" font-size="11" font-family="Arial, Helvetica, sans-serif">AI Workspace</text>
    </svg>
  `);

  await writeBmp(
    path.join(tauriIconsDir, "nsis-sidebar.bmp"),
    sharp(brandBackgroundSvg(width, height))
      .composite([
        { input: icon, left: 37, top: 84 },
        { input: text, left: 0, top: 0 },
      ])
      .flatten({ background: "#1B1036" })
  );
}

async function main() {
  if (!existsSync(sourceIcon)) {
    throw new Error(`Source icon not found: ${sourceIcon}`);
  }

  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const tauri = resolveTauriCommand();
  runCommand(tauri, ["icon", sourceIcon, "-o", tauriIconsDir]);

  const pwaDir = path.join(tempDir, "pwa");
  mkdirSync(pwaDir, { recursive: true });
  runCommand(tauri, ["icon", sourceIcon, "-o", pwaDir, "-p", "192", "-p", "512"]);

  copyFileSync(path.join(pwaDir, "192x192.png"), path.join(publicDir, "web-app-manifest-192x192.png"));
  copyFileSync(path.join(pwaDir, "512x512.png"), path.join(publicDir, "web-app-manifest-512x512.png"));

  const iconPng = path.join(tauriIconsDir, "icon.png");
  await createNsisHeader(iconPng);
  await createNsisSidebar(iconPng);

  for (const extraPath of ["64x64.png", "android", "ios"]) {
    rmSync(path.join(tauriIconsDir, extraPath), { recursive: true, force: true });
  }

  rmSync(tempDir, { recursive: true, force: true });
  console.log("[desktop:icon] Generated desktop, PWA, and NSIS icons from public/images/app-icon.svg");
}

main().catch((error) => {
  rmSync(tempDir, { recursive: true, force: true });
  console.error(`[desktop:icon] ${error.message}`);
  process.exit(1);
});