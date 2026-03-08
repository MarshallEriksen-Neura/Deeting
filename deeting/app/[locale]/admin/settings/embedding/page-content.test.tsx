import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const mockMutate = jest.fn()
const mockUseSWR = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

const mockUpdateAdminEmbeddingSetting = jest.fn()
const mockFetchChatModels = jest.fn()

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminEmbeddingSetting: jest.fn(),
  updateAdminEmbeddingSetting: (...args: unknown[]) => mockUpdateAdminEmbeddingSetting(...args),
}))

jest.mock("@/lib/api/models", () => ({
  fetchChatModels: (...args: unknown[]) => mockFetchChatModels(...args),
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

jest.mock("@/components/models/model-picker", () => ({
  ModelPicker: ({
    value,
    onChange,
    modelGroups,
  }: {
    value?: string
    onChange: (value: string) => void
    modelGroups: Array<{ instance_id: string; models: Array<{ id: string; provider_model_id?: string }> }>
  }) => (
    <div data-testid="model-picker" data-value={value ?? ""}>
      {modelGroups.flatMap((group) =>
        group.models.map((model) => {
          const nextValue = model.provider_model_id ?? model.id
          return (
            <button
              key={`${group.instance_id}:${nextValue}`}
              type="button"
              onClick={() => onChange(nextValue)}
            >
              {nextValue}
            </button>
          )
        })
      )}
    </div>
  ),
}))

describe("Admin embedding settings page", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSWR.mockImplementation((key: string) => {
      if (key === "/api/v1/admin/settings/embedding") {
        return {
          data: { model_name: "nvidia/nv-embed-v1" },
          error: undefined,
          isLoading: false,
          mutate: mockMutate,
        }
      }

      if (key === "/api/v1/models?capability=embedding") {
        return {
          data: {
            instances: [
              {
                instance_id: "inst-1",
                instance_name: "NVIDIA",
                provider: "nvidia",
                models: [
                  { id: "nvidia/nv-embed-v1", provider_model_id: "nvidia/nv-embed-v1" },
                  { id: "nvidia/llama-nemotron-embed-1b-v2", provider_model_id: "nvidia/llama-nemotron-embed-1b-v2" },
                ],
              },
            ],
          },
          error: undefined,
          isLoading: false,
        }
      }

      return { data: undefined, error: undefined, isLoading: false }
    })
  })

  it("renders model picker instead of a free text input", () => {
    render(<PageContent />)

    expect(screen.queryByTestId("model-picker")).not.toBeNull()
    expect(screen.queryByPlaceholderText("admin.embeddingSettingsPage.fields.placeholder")).toBeNull()
  })

  it("saves the model selected from the picker", async () => {
    mockUpdateAdminEmbeddingSetting.mockResolvedValue({ model_name: "nvidia/llama-nemotron-embed-1b-v2" })

    render(<PageContent />)

    fireEvent.click(screen.getByRole("button", { name: "nvidia/llama-nemotron-embed-1b-v2" }))
    fireEvent.click(screen.getByRole("button", { name: /actions\.save/i }))

    await waitFor(() => {
      expect(mockUpdateAdminEmbeddingSetting).toHaveBeenCalledWith("nvidia/llama-nemotron-embed-1b-v2")
    })
  })

  it("keeps the saved model visible when it is no longer in the available list", () => {
    mockUseSWR.mockImplementation((key: string) => {
      if (key === "/api/v1/admin/settings/embedding") {
        return {
          data: { model_name: "legacy/embedding-model" },
          error: undefined,
          isLoading: false,
          mutate: mockMutate,
        }
      }

      if (key === "/api/v1/models?capability=embedding") {
        return {
          data: {
            instances: [
              {
                instance_id: "inst-1",
                instance_name: "NVIDIA",
                provider: "nvidia",
                models: [
                  { id: "nvidia/nv-embed-v1", provider_model_id: "nvidia/nv-embed-v1" },
                ],
              },
            ],
          },
          error: undefined,
          isLoading: false,
        }
      }

      return { data: undefined, error: undefined, isLoading: false }
    })

    render(<PageContent />)

    expect(screen.getByRole("button", { name: "legacy/embedding-model" })).toBeTruthy()
    expect(screen.getByText("fields.currentUnlistedHint")).toBeTruthy()
  })
})
