import React from "react"
import { render } from "@testing-library/react"
import { ChatLayout } from "@/components/chat/core/chat-layout"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

describe("ChatLayout", () => {
  it("should render children when allowMissingAgent is true", () => {
    const { getByTestId } = render(
      <ChatLayout agent={undefined} isLoadingAssistants={false} allowMissingAgent>
        <div data-testid="child" />
      </ChatLayout>
    )
    expect(getByTestId("child")).toBeInTheDocument()
  })
})
