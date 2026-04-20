import React from "react"
import { render, screen } from "@testing-library/react"

import AudioResultPanel from "../audio-result-panel"

jest.mock("@/lib/api/desktop-object-storage", () => ({
  prepareDesktopObjectStorageRead: jest.fn(async () => ({
    asset_url: "https://example.com/audio.mp3",
  })),
}))

describe("AudioResultPanel", () => {
  it("renders basic audio metadata and player", async () => {
    const { container } = render(
      <AudioResultPanel
        payload={{
          source_url: "https://example.com/audio.mp3",
          model: "tts-1",
          voice: "alloy",
          duration_ms: 32000,
          prompt_text: "Read this text",
        }}
      />,
    )

    expect(screen.getByText("Audio Output")).toBeInTheDocument()
    expect(screen.getByText("Model: tts-1")).toBeInTheDocument()
    expect(screen.getByText("Voice: alloy")).toBeInTheDocument()
    expect(screen.getByText("Duration: 0:32")).toBeInTheDocument()
    expect(screen.getByText("Prompt")).toBeInTheDocument()
    expect(screen.getByText("Read this text")).toBeInTheDocument()
    expect(container.querySelector("audio")).not.toBeNull()
  })
})
