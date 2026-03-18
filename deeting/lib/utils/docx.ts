const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_COMPRESSION_STORED = 0
const ZIP_COMPRESSION_DEFLATE = 8
const ZIP_MAX_COMMENT_BYTES = 65_535

interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  )
}

function getTagLocalName(tagName: string): string {
  const segments = tagName.split(":")
  return segments[segments.length - 1] ?? tagName
}

function normalizeExtractedDocxText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      const normalized = line.replace(/\s+/g, " ").trim()
      if (!normalized) return false
      return !/^(?:HYPERLINK|PAGEREF|TOC)\b/i.test(normalized)
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizeDocxInstructionText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

function isDocxFieldInstruction(text: string | null | undefined): boolean {
  const normalized = normalizeDocxInstructionText(text)
  if (!normalized) return false
  return /\b(?:TOC|PAGEREF|HYPERLINK|REF|SEQ)\b/i.test(normalized)
}

function getDocxElementAttribute(element: Element, localName: string): string | null {
  return (
    element.getAttribute(localName) ??
    element.getAttribute(`w:${localName}`) ??
    element.getAttributeNS?.(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      localName
    ) ??
    null
  )
}

function collectDocxFieldInstructions(element: Element): string[] {
  const localName = getTagLocalName(element.tagName)
  if (localName === "instrText") {
    const instruction = normalizeDocxInstructionText(element.textContent)
    return instruction ? [instruction] : []
  }
  if (localName === "fldSimple") {
    const instruction = normalizeDocxInstructionText(
      getDocxElementAttribute(element, "instr")
    )
    return instruction ? [instruction] : []
  }
  return Array.from(element.children).flatMap((child) =>
    collectDocxFieldInstructions(child)
  )
}

function shouldSkipDocxParagraph(element: Element): boolean {
  const instructions = collectDocxFieldInstructions(element)
  return instructions.some((instruction) => /\b(?:TOC|PAGEREF)\b/i.test(instruction))
}

function findZipEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - ZIP_MAX_COMMENT_BYTES - 22)
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset
    }
  }
  throw new Error("DOCX archive is missing the ZIP central directory")
}

function parseZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(bytes)
  const centralDirectorySize = readUint32LE(bytes, eocdOffset + 12)
  const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16)
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  const decoder = new TextDecoder("utf-8")
  const entries: ZipEntry[] = []

  let offset = centralDirectoryOffset
  while (offset + 46 <= bytes.length && offset < centralDirectoryEnd) {
    const signature = readUint32LE(bytes, offset)
    if (signature !== ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error("DOCX archive central directory is invalid")
    }

    const compressionMethod = readUint16LE(bytes, offset + 10)
    const compressedSize = readUint32LE(bytes, offset + 20)
    const fileNameLength = readUint16LE(bytes, offset + 28)
    const extraFieldLength = readUint16LE(bytes, offset + 30)
    const fileCommentLength = readUint16LE(bytes, offset + 32)
    const localHeaderOffset = readUint32LE(bytes, offset + 42)
    const fileNameOffset = offset + 46
    const fileNameEnd = fileNameOffset + fileNameLength
    const name = decoder.decode(bytes.slice(fileNameOffset, fileNameEnd))

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    })

    offset = fileNameEnd + extraFieldLength + fileCommentLength
  }

  return entries
}

async function inflateZipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("当前运行环境缺少 DOCX 解压能力，请升级桌面运行时后重试")
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

async function readZipEntry(bytes: Uint8Array, entryName: string): Promise<Uint8Array> {
  const entry = parseZipEntries(bytes).find((item) => item.name === entryName)
  if (!entry) {
    throw new Error(`DOCX archive is missing ${entryName}`)
  }

  const localHeaderOffset = entry.localHeaderOffset
  if (readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`DOCX archive local header is invalid for ${entryName}`)
  }

  const fileNameLength = readUint16LE(bytes, localHeaderOffset + 26)
  const extraFieldLength = readUint16LE(bytes, localHeaderOffset + 28)
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength
  const dataEnd = dataOffset + entry.compressedSize
  const payload = bytes.slice(dataOffset, dataEnd)

  if (entry.compressionMethod === ZIP_COMPRESSION_STORED) {
    return payload
  }
  if (entry.compressionMethod === ZIP_COMPRESSION_DEFLATE) {
    return inflateZipBytes(payload)
  }
  throw new Error(`DOCX archive uses unsupported compression method ${entry.compressionMethod}`)
}

function extractNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const parentLocalName = node.parentElement
      ? getTagLocalName(node.parentElement.tagName)
      : ""
    if (parentLocalName === "instrText") {
      return ""
    }
    return node.textContent ?? ""
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ""
  }

  const element = node as Element
  const localName = getTagLocalName(element.tagName)

  if (localName === "instrText" || localName === "fldChar" || localName === "fldSimple") {
    return ""
  }
  if (localName === "t") {
    const text = element.textContent ?? ""
    return isDocxFieldInstruction(text) ? "" : text
  }
  if (localName === "tab") {
    return "\t"
  }
  if (localName === "br" || localName === "cr") {
    return "\n"
  }
  if (localName === "p") {
    if (shouldSkipDocxParagraph(element)) {
      return ""
    }
    const paragraphText = Array.from(element.childNodes).map(extractNodeText).join("")
    const normalized = normalizeExtractedDocxText(paragraphText)
    return normalized ? `${normalized}\n\n` : ""
  }
  if (localName === "tbl") {
    const rowTexts = Array.from(element.children)
      .filter((child) => getTagLocalName(child.tagName) === "tr")
      .map((row) => {
        const cellTexts = Array.from(row.children)
          .filter((child) => getTagLocalName(child.tagName) === "tc")
          .map((cell) =>
            normalizeExtractedDocxText(
              Array.from(cell.childNodes).map(extractNodeText).join("")
            )
          )
          .filter(Boolean)
        return cellTexts.join("\t")
      })
      .filter(Boolean)
    return rowTexts.length > 0 ? `${rowTexts.join("\n")}\n\n` : ""
  }

  return Array.from(element.childNodes).map(extractNodeText).join("")
}

export function extractDocxTextFromXml(xml: string): string {
  const parser = new DOMParser()
  const document = parser.parseFromString(xml, "application/xml")
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("DOCX 文档 XML 解析失败")
  }

  const body =
    Array.from(document.getElementsByTagName("*")).find(
      (element) => getTagLocalName(element.tagName) === "body"
    ) ?? document.documentElement
  const text = Array.from(body.childNodes).map(extractNodeText).join("")
  return normalizeExtractedDocxText(text)
}

export async function extractDocxTextFromBuffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const documentXmlBytes = await readZipEntry(bytes, "word/document.xml")
  const xml = new TextDecoder("utf-8").decode(documentXmlBytes)
  const text = extractDocxTextFromXml(xml)
  if (!text) {
    throw new Error("DOCX 文档内容为空")
  }
  return text
}

export async function extractDocxTextFromFile(file: File): Promise<string> {
  return extractDocxTextFromBuffer(await file.arrayBuffer())
}
