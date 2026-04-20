import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CopyablePre } from "@/components/chat/copyable-pre"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("CopyablePre", () => {
  it("copies the full rendered content", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    render(
      <CopyablePre>
        {"{\n  \"slug\": \"volcengine-ark\",\n  \"provider\": \"volcengine\"\n}"}
      </CopyablePre>
    )

    fireEvent.click(screen.getByLabelText("codeBlock.copy"))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })

    expect(writeText).toHaveBeenCalledWith(
      "{\n  \"slug\": \"volcengine-ark\",\n  \"provider\": \"volcengine\"\n}"
    )
    expect(screen.getByLabelText("codeBlock.copied")).toBeInTheDocument()
  })
})
