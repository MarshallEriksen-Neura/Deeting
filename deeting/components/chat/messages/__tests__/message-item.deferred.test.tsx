describe("MessageItem deferred surfaces", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("does not eagerly import the compare dialog on initial message-item load", () => {
    let compareDialogLoads = 0

    jest.isolateModules(() => {
      jest.doMock("next/dynamic", () => ({
        __esModule: true,
        default: () => () => null,
      }))
      jest.doMock("@/components/chat/messages/ai-response-bubble", () => ({
        AIResponseBubble: () => null,
      }))
      jest.doMock("@/components/chat/messages/compare-response-shell", () => ({
        CompareResponseShell: () => null,
      }))
      jest.doMock("@/components/chat/messages/message-actions", () => ({
        MessageActions: () => null,
      }))
      jest.doMock("@/components/chat/markdown-viewer", () => ({
        MarkdownViewer: () => null,
      }))
      jest.doMock("@/components/ui/image-lightbox", () => ({
        ImageLightbox: () => null,
      }))
      jest.doMock("@/hooks/use-i18n", () => ({
        useI18n: () => (key: string) => key,
      }))
      jest.doMock("@/hooks/chat/use-message-tool-approval", () => ({
        useMessageToolApproval: () => undefined,
      }))
      jest.doMock("@/store/chat-store", () => ({
        useChatStore: () => null,
      }))
      jest.doMock("@/components/chat/messages/compare-model-dialog", () => {
        compareDialogLoads += 1
        return { CompareModelDialog: () => null }
      })

      require("../message-item")
    })

    expect(compareDialogLoads).toBe(0)
  })
})
