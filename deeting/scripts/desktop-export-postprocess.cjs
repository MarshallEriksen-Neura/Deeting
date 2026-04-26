const fs = require("node:fs")
const path = require("node:path")

function readDesktopDefaultLocale(projectRoot) {
  const routingPath = path.join(projectRoot, "i18n", "routing.ts")
  const routingSource = fs.readFileSync(routingPath, "utf8")
  const match = routingSource.match(/defaultLocale:\s*["'`]([^"'`]+)["'`]/)

  if (!match) {
    throw new Error(
      `[desktop-export-postprocess] Unable to resolve defaultLocale from ${routingPath}`
    )
  }

  return match[1]
}

function copyFile(sourcePath, targetPath, copiedPaths, outDir, options = {}) {
  const { overwrite = false } = options

  if (!fs.existsSync(sourcePath) || (!overwrite && fs.existsSync(targetPath))) {
    return
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  copiedPaths.push(path.relative(outDir, targetPath).split(path.sep).join("/"))
}

function mirrorMissingDirectoryEntries(sourceDir, targetDir, copiedPaths, outDir) {
  if (!fs.existsSync(sourceDir)) {
    return
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      mirrorMissingDirectoryEntries(sourcePath, targetPath, copiedPaths, outDir)
      continue
    }

    copyFile(sourcePath, targetPath, copiedPaths, outDir)
  }
}

function mirrorDefaultLocaleExport(outDir, defaultLocale) {
  const copiedPaths = []
  const localeDir = path.join(outDir, defaultLocale)
  const localeHtml = path.join(outDir, `${defaultLocale}.html`)
  const localeText = path.join(outDir, `${defaultLocale}.txt`)

  if (fs.existsSync(localeDir) && fs.statSync(localeDir).isDirectory()) {
    mirrorMissingDirectoryEntries(localeDir, outDir, copiedPaths, outDir)
  }

  copyFile(localeHtml, path.join(outDir, "index.html"), copiedPaths, outDir, {
    overwrite: true,
  })
  copyFile(localeText, path.join(outDir, "index.txt"), copiedPaths, outDir, {
    overwrite: true,
  })

  return copiedPaths
}

function postprocessDesktopExport(projectRoot) {
  const outDir = path.join(projectRoot, "out")

  if (!fs.existsSync(outDir)) {
    throw new Error(
      `[desktop-export-postprocess] Export output not found at ${outDir}`
    )
  }

  const defaultLocale = readDesktopDefaultLocale(projectRoot)
  const copiedPaths = mirrorDefaultLocaleExport(outDir, defaultLocale)

  return {
    defaultLocale,
    copiedPaths,
  }
}

module.exports = {
  readDesktopDefaultLocale,
  mirrorDefaultLocaleExport,
  postprocessDesktopExport,
}
