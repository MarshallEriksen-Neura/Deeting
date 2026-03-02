import { calculateFileHash, formatFileSize, isValidFileSize, isValidImageType } from "@/lib/utils/file"

describe("file utils", () => {
  it("calculates sha256 hash with fallback implementation when subtle is unavailable", async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    })

    try {
      const file = new File(["abc"], "abc.txt", { type: "text/plain" })
      const hash = await calculateFileHash(file)
      expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      })
    }
  })

  it("formats file size and validates image constraints", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(2048)).toBe("2 KB")

    const image = new File(["x"], "avatar.png", { type: "image/png" })
    const text = new File(["x"], "note.txt", { type: "text/plain" })

    expect(isValidImageType(image)).toBe(true)
    expect(isValidImageType(text)).toBe(false)
    expect(isValidFileSize(image, 1)).toBe(true)
    expect(isValidFileSize(image, 0)).toBe(false)
  })
})
