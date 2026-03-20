type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs")
type PdfJsWorkerModule = typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs")

let pdfJsModulePromise: Promise<PdfJsModule> | null = null

async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]).then(([module, workerModule]) => {
    ;(
      globalThis as typeof globalThis & {
        pdfjsWorker?: PdfJsWorkerModule
      }
    ).pdfjsWorker = workerModule
    return module
  })
  return pdfJsModulePromise
}

function normalizePdfPageText(items: Array<{ str?: unknown }>): string {
  return items
    .map((item) => (typeof item.str === "string" ? item.str.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim()
}

export async function extractPdfTextFromFile(file: File): Promise<string> {
  try {
    const pdfjs = await loadPdfJs()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: false,
      isEvalSupported: false,
    })
    const document = await loadingTask.promise
    const pageTexts: string[] = []
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const textContent = await page.getTextContent()
        const pageText = normalizePdfPageText(textContent.items as Array<{ str?: unknown }>)
        if (pageText) {
          pageTexts.push(pageText)
        }
      }
      return pageTexts.join("\n\n").trim()
    } finally {
      await document.destroy()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PDF text extraction failed: ${message}`)
  }
}
