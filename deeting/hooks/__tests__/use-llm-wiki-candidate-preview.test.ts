import { act, renderHook, waitFor } from "@testing-library/react"

import { useLlmWikiCandidatePreview } from "@/hooks/use-llm-wiki-candidate-preview"
import {
  previewLocalLlmWikiCandidate,
  supportsLocalLlmWiki,
  type LocalLlmWikiCandidatePreview,
} from "@/lib/api/llm-wiki"

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}))

jest.mock("@/lib/api/llm-wiki", () => ({
  previewLocalLlmWikiCandidate: jest.fn(),
  supportsLocalLlmWiki: jest.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const mockPreviewLocalLlmWikiCandidate =
  previewLocalLlmWikiCandidate as jest.MockedFunction<typeof previewLocalLlmWikiCandidate>
const mockSupportsLocalLlmWiki =
  supportsLocalLlmWiki as jest.MockedFunction<typeof supportsLocalLlmWiki>

describe("useLlmWikiCandidatePreview", () => {
  beforeEach(() => {
    mockPreviewLocalLlmWikiCandidate.mockReset()
    mockSupportsLocalLlmWiki.mockReset()
    mockSupportsLocalLlmWiki.mockReturnValue(true)
  })

  it("keeps the preview request alive across the loading state transition", async () => {
    const deferred = createDeferred<LocalLlmWikiCandidatePreview>()
    const payload = {
      sourceKind: "chat_answer",
      title: "Preview title",
      content: "Durable answer body",
    }
    mockPreviewLocalLlmWikiCandidate.mockReturnValue(deferred.promise)

    const { result } = renderHook(() =>
      useLlmWikiCandidatePreview({
        open: true,
        canPreview: true,
        payload,
        desktopOnlyMessage: "desktop only",
        unavailableMessage: "unavailable",
        previewFailedMessage: "preview failed",
      }),
    )

    await waitFor(() => {
      expect(result.current.isPreviewing).toBe(true)
    })

    await act(async () => {
      deferred.resolve({
        sourceKind: "chat_answer",
        suggestedTitle: "Preview title",
        targetRelativePath: "wiki/analyses/preview-title.md",
        sourceReferences: [],
        proposedMarkdown: "# Preview title",
        changedFiles: [],
        validationFlags: [],
        memoryImpact: "none",
        canCommit: true,
      })
      await deferred.promise
    })

    await waitFor(() => {
      expect(result.current.preview?.suggestedTitle).toBe("Preview title")
      expect(result.current.isPreviewing).toBe(false)
      expect(result.current.errorMessage).toBeNull()
    })
  })
})
