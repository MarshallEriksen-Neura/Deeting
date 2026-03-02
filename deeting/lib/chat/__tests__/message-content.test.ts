import {
  buildMessageContent,
  parseMessageContent,
  serializeMessageContent,
} from "@/lib/chat/message-content"

describe("message-content", () => {
  it("builds mixed content blocks for image and file attachments", () => {
    const content = buildMessageContent("请帮我总结", [
      {
        id: "img-1",
        kind: "image",
        objectKey: "assets/demo.png",
        name: "demo.png",
      },
      {
        id: "file-1",
        kind: "file",
        fileId: "file-abc123",
        name: "report.pdf",
      },
    ])

    expect(content).toEqual([
      { type: "text", text: "请帮我总结" },
      {
        type: "image_url",
        image_url: { url: "asset://assets/demo.png" },
      },
      {
        type: "input_file",
        input_file: { file_id: "file-abc123", filename: "report.pdf" },
      },
    ])
  })

  it("parses input_file blocks into file attachments", () => {
    const parsed = parseMessageContent([
      { type: "text", text: "请读取附件" },
      { type: "input_file", input_file: { file_id: "file-1", filename: "a.pdf" } },
      { type: "input_file", file_id: "file-2", filename: "b.txt" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ])

    expect(parsed.text).toBe("请读取附件")
    expect(parsed.attachments).toEqual([
      {
        id: "file-2",
        kind: "file",
        fileId: "file-1",
        name: "a.pdf",
        source: "model",
      },
      {
        id: "file-3",
        kind: "file",
        fileId: "file-2",
        name: "b.txt",
        source: "model",
      },
      {
        id: "image-4",
        kind: "image",
        url: "https://example.com/a.png",
        objectKey: undefined,
      },
    ])
  })

  it("round-trips serialized file attachment content", () => {
    const serialized = serializeMessageContent("", [
      { id: "file-local", kind: "file", fileId: "file-xyz", name: "spec.pdf" },
    ])

    const parsed = parseMessageContent(serialized)
    expect(parsed.text).toBe("")
    expect(parsed.attachments).toEqual([
      {
        id: "file-1",
        kind: "file",
        fileId: "file-xyz",
        name: "spec.pdf",
        source: "model",
      },
    ])
  })
})
