import {
  detectTextLanguage,
  languageDisplayName,
  languageShortLabel,
  lookupLanguageCode,
  resolveSmartTarget,
} from "./detect-text-language"

describe("detectTextLanguage", () => {
  it("identifies pure Chinese text", () => {
    expect(detectTextLanguage("今天天气真好").code).toBe("zh")
  })

  it("treats kana presence as Japanese even with kanji", () => {
    expect(detectTextLanguage("今日はいい天気です").code).toBe("ja")
  })

  it("identifies Korean Hangul", () => {
    expect(detectTextLanguage("안녕하세요").code).toBe("ko")
  })

  it("identifies Arabic", () => {
    expect(detectTextLanguage("مرحبا بالعالم").code).toBe("ar")
  })

  it("identifies Russian Cyrillic", () => {
    expect(detectTextLanguage("Привет, мир").code).toBe("ru")
  })

  it("falls back to English for plain Latin text without hint words", () => {
    expect(detectTextLanguage("Hello world").code).toBe("en")
  })

  it("identifies French via stop words", () => {
    expect(detectTextLanguage("le chat est sur la table").code).toBe("fr")
  })

  it("identifies German via stop words", () => {
    expect(detectTextLanguage("der Hund ist im Garten und schläft").code).toBe("de")
  })

  it("returns unknown for whitespace-only input", () => {
    expect(detectTextLanguage("   ").code).toBe("unknown")
  })

  it("returns unknown for digits and punctuation only", () => {
    expect(detectTextLanguage("123 !!! ###").code).toBe("unknown")
  })
})

describe("languageDisplayName", () => {
  it("returns canonical English names", () => {
    expect(languageDisplayName("zh")).toBe("Chinese")
    expect(languageDisplayName("ja")).toBe("Japanese")
    expect(languageDisplayName("unknown")).toBe("Unknown")
  })
})

describe("lookupLanguageCode", () => {
  it("resolves canonical names case-insensitively", () => {
    expect(lookupLanguageCode("Chinese")).toBe("zh")
    expect(lookupLanguageCode("english")).toBe("en")
    expect(lookupLanguageCode(" Japanese ")).toBe("ja")
  })

  it("returns null for unknown names", () => {
    expect(lookupLanguageCode("Klingon")).toBeNull()
    expect(lookupLanguageCode("")).toBeNull()
  })
})

describe("languageShortLabel", () => {
  it("returns localized short label for zh ui", () => {
    expect(languageShortLabel("zh", "zh")).toBe("中")
    expect(languageShortLabel("en", "zh")).toBe("英")
  })

  it("returns Latin short label for en ui", () => {
    expect(languageShortLabel("zh", "en")).toBe("Zh")
    expect(languageShortLabel("ja", "en")).toBe("Ja")
  })

  it("returns ? for unknown", () => {
    expect(languageShortLabel("unknown", "en")).toBe("?")
  })
})

describe("resolveSmartTarget", () => {
  it("translates to UI language when source differs and no recent targets", () => {
    expect(resolveSmartTarget("zh", "English", [])).toBe("English")
    expect(resolveSmartTarget("ja", "Chinese", [])).toBe("Chinese")
  })

  it("most-recent target wins over UI default when it differs from source", () => {
    expect(resolveSmartTarget("zh", "English", ["Japanese"])).toBe("Japanese")
    expect(resolveSmartTarget("en", "English", ["Japanese", "English"])).toBe("Japanese")
  })

  it("skips recent targets that equal the source language", () => {
    expect(resolveSmartTarget("zh", "English", ["Chinese"])).toBe("English")
    expect(resolveSmartTarget("zh", "English", ["Chinese", "French"])).toBe("French")
  })

  it("when source equals UI and no recent, swaps en/zh as a sensible default", () => {
    expect(resolveSmartTarget("en", "English", [])).toBe("Chinese")
    expect(resolveSmartTarget("zh", "Chinese", [])).toBe("English")
  })

  it("when source is unknown, prefers most recent if available", () => {
    expect(resolveSmartTarget("unknown", "English", ["Japanese"])).toBe("Japanese")
  })

  it("when source is unknown and no recent, defaults to UI language", () => {
    expect(resolveSmartTarget("unknown", "English", [])).toBe("English")
    expect(resolveSmartTarget("unknown", "Chinese", [])).toBe("Chinese")
  })
})
