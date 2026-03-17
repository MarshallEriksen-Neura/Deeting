import { extractDocxTextFromBuffer, extractDocxTextFromXml } from "@/lib/utils/docx"

function createStoredZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const fileEntries = Object.entries(files).map(([name, content]) => ({
    nameBytes: encoder.encode(name),
    contentBytes: encoder.encode(content),
  }))

  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of fileEntries) {
    const localHeader = new Uint8Array(30)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint32(14, 0, true)
    localView.setUint32(18, entry.contentBytes.length, true)
    localView.setUint32(22, entry.contentBytes.length, true)
    localView.setUint16(26, entry.nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localChunks.push(localHeader, entry.nameBytes, entry.contentBytes)

    const centralHeader = new Uint8Array(46)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint32(16, 0, true)
    centralView.setUint32(20, entry.contentBytes.length, true)
    centralView.setUint32(24, entry.contentBytes.length, true)
    centralView.setUint16(28, entry.nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralChunks.push(centralHeader, entry.nameBytes)

    offset += localHeader.length + entry.nameBytes.length + entry.contentBytes.length
  }

  const centralDirectorySize = centralChunks.reduce((total, chunk) => total + chunk.length, 0)
  const endOfCentralDirectory = new Uint8Array(22)
  const eocdView = new DataView(endOfCentralDirectory.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, fileEntries.length, true)
  eocdView.setUint16(10, fileEntries.length, true)
  eocdView.setUint32(12, centralDirectorySize, true)
  eocdView.setUint32(16, offset, true)
  eocdView.setUint16(20, 0, true)

  const totalSize = offset + centralDirectorySize + endOfCentralDirectory.length
  const output = new Uint8Array(totalSize)
  let cursor = 0
  for (const chunk of [...localChunks, ...centralChunks, endOfCentralDirectory]) {
    output.set(chunk, cursor)
    cursor += chunk.length
  }
  return output
}

describe("docx utils", () => {
  it("extracts readable text from WordprocessingML", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" +
      "<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>DOCX</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Line</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Break</w:t></w:r></w:p>" +
      "</w:body>" +
      "</w:document>"

    expect(extractDocxTextFromXml(xml)).toBe("Hello\tDOCX\n\nLine\nBreak")
  })

  it("extracts text from a minimal stored docx archive", async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body><w:p><w:r><w:t>Offline DOCX</w:t></w:r></w:p></w:body>" +
      "</w:document>"
    const archive = createStoredZip({
      "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      "word/document.xml": xml,
    })

    await expect(extractDocxTextFromBuffer(archive)).resolves.toBe("Offline DOCX")
  })
})
