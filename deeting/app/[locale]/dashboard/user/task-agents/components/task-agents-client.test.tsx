import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { TaskAgentsClient } from "./task-agents-client"
import {
  supportsLocalCustomTaskAgents,
  updateCustomTaskAgent,
  type CustomTaskAgentProfile,
} from "@/lib/api/custom-task-agents"

const mockMutate = jest.fn()
const mockUseSWR = jest.fn()
const mockUseChatService = jest.fn()
const mockRouterPush = jest.fn()

jest.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
    t.raw = (key: string) => key
    return t
  },
  useLocale: () => "en",
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  supportsLocalCustomTaskAgents: jest.fn(),
  listCustomTaskAgents: jest.fn(),
  getCustomTaskAgentBindingCatalog: jest.fn(),
  createCustomTaskAgent: jest.fn(),
  updateCustomTaskAgent: jest.fn(),
  deleteCustomTaskAgent: jest.fn(),
  previewCustomTaskAgent: jest.fn(),
  reindexCustomTaskAgents: jest.fn(),
}))

jest.mock("@/hooks/use-chat-service", () => ({
  useChatService: (...args: unknown[]) => mockUseChatService(...args),
}))

jest.mock("@/components/ui/page-header/page-header", () => ({
  PageHeader: ({
    title,
    description,
    actions,
  }: {
    title: string
    description?: string
    actions?: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      <div>{actions}</div>
    </div>
  ),
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (
    props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  ) => <textarea {...props} />,
}))

jest.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}))

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span />,
}))

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}))

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

jest.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

const mockSupportsLocalCustomTaskAgents =
  supportsLocalCustomTaskAgents as jest.MockedFunction<
    typeof supportsLocalCustomTaskAgents
  >
const mockUpdateCustomTaskAgent =
  updateCustomTaskAgent as jest.MockedFunction<typeof updateCustomTaskAgent>

const agents: CustomTaskAgentProfile[] = [
  {
    id: "agent-1",
    name: "Agent One",
    description: "First agent",
    task_prompt: "Do task one",
    invocation_kind: "chat",
    model_config: { model: "default" },
    callable_mcp_tool_ids: ["tool.release"],
    guidance_skill_ids: ["skill.alpha"],
    callable_skill_action_refs: [],
    preferred_for_image_generation: false,
    tags: ["ops"],
    discoverable: true,
    is_enabled: true,
    is_deleted: false,
    created_at: "2026-03-12T00:00:00Z",
    updated_at: "2026-03-12T00:00:00Z",
  },
  {
    id: "agent-2",
    name: "Agent Two",
    description: "Second agent",
    task_prompt: "Do task two",
    invocation_kind: "image_generation",
    model_config: {
      model: "Qwen-Image",
      image_generation: {
        aspect_ratio: "1:1",
      },
    },
    callable_mcp_tool_ids: [],
    guidance_skill_ids: [],
    callable_skill_action_refs: [],
    preferred_for_image_generation: true,
    tags: ["docs"],
    discoverable: true,
    is_enabled: true,
    is_deleted: false,
    created_at: "2026-03-12T00:00:00Z",
    updated_at: "2026-03-12T00:00:00Z",
  },
]

describe("TaskAgentsClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSupportsLocalCustomTaskAgents.mockReturnValue(true)
    mockUpdateCustomTaskAgent.mockResolvedValue(agents[0])
    mockUseChatService.mockReturnValue({
      modelGroups: [
        {
          instance_id: "instance-1",
          instance_name: "Local Provider",
          provider: "custom",
          models: [
            {
              id: "default",
              provider_model_id: "provider-default",
              owned_by: "custom",
            },
            {
              id: "Qwen-Image",
              provider_model_id: "provider-image",
              owned_by: "custom",
            },
          ],
        },
      ],
      isLoadingModels: false,
    })
    mockUseSWR.mockImplementation((key: string | null) => {
      if (key === "local-custom-task-agents") {
        return {
          data: agents,
          error: undefined,
          isLoading: false,
          mutate: mockMutate,
        }
      }

      if (key === "local-custom-task-agent-binding-catalog") {
        return {
          data: {
            mcp_tools: [
              {
                id: "tool.release",
                name: "Release Notes Tool",
                description: "Draft release summaries",
                status: "healthy",
              },
              {
                id: "tool.research",
                name: "Research Tool",
                description: "Collect product evidence",
                status: "healthy",
              },
            ],
            guidance_skills: [
              {
                skill_id: "skill.alpha",
                installed_version: "1.0.0",
                is_enabled: true,
                runtime: "python",
              },
              {
                skill_id: "skill.beta",
                installed_version: "2.0.0",
                is_enabled: true,
                runtime: "node",
              },
            ],
            skill_actions: [],
          },
          error: undefined,
          isLoading: false,
          mutate: jest.fn(),
        }
      }

      return {
        data: undefined,
        error: undefined,
        isLoading: false,
        mutate: jest.fn(),
      }
    })
  })

  it("renders desktop-only fallback outside Tauri", () => {
    mockSupportsLocalCustomTaskAgents.mockReturnValue(false)

    render(<TaskAgentsClient />)

    expect(screen.getByText("unsupported.title")).not.toBeNull()
    expect(screen.getByText("unsupported.description")).not.toBeNull()
  })

  it("prompts before switching agents when the draft is dirty", async () => {
    render(<TaskAgentsClient />)

    const nameInput = await screen.findByDisplayValue("Agent One")
    fireEvent.change(nameInput, {
      target: { value: "Changed Agent Name" },
    })

    fireEvent.click(screen.getByRole("button", { name: /Agent Two/i }))

    expect(screen.getByText("discardDialog.title")).not.toBeNull()
    expect(screen.getByText("discardDialog.description")).not.toBeNull()

    fireEvent.click(screen.getByText("discardDialog.cancel"))

    expect(screen.getByDisplayValue("Changed Agent Name")).not.toBeNull()
  })

  it("does not register native beforeunload protection when there are unsaved changes", async () => {
    render(<TaskAgentsClient />)

    const nameInput = await screen.findByDisplayValue("Agent One")
    fireEvent.change(nameInput, {
      target: { value: "Changed Agent Name" },
    })

    const event = new Event("beforeunload", { cancelable: true })
    const beforeUnloadEvent = event as BeforeUnloadEvent & {
      returnValue?: string
    }

    Object.defineProperty(beforeUnloadEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    })

    window.dispatchEvent(beforeUnloadEvent)

    await waitFor(() => {
      expect(beforeUnloadEvent.defaultPrevented).toBe(false)
      expect(beforeUnloadEvent.returnValue).toBeUndefined()
    })
  })

  it("prompts before leaving the page through a same-origin link when the draft is dirty", async () => {
    render(<TaskAgentsClient />)

    const link = document.createElement("a")
    link.href = "/dashboard/notification-channels"
    link.textContent = "Leave page"
    document.body.append(link)

    const nameInput = await screen.findByDisplayValue("Agent One")
    fireEvent.change(nameInput, {
      target: { value: "Changed Agent Name" },
    })

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    })

    act(() => {
      link.dispatchEvent(clickEvent)
    })

    await waitFor(() => {
      expect(clickEvent.defaultPrevented).toBe(true)
      expect(screen.getByText("discardDialog.title")).not.toBeNull()
      expect(screen.getByText("discardDialog.description")).not.toBeNull()
    })

    fireEvent.click(screen.getByText("discardDialog.confirm"))

    expect(mockRouterPush).toHaveBeenCalledWith("/dashboard/notification-channels")

    link.remove()
  })

  it("filters tools by local binding search", () => {
    render(<TaskAgentsClient />)

    fireEvent.change(
      screen.getByPlaceholderText("bindings.searchToolsPlaceholder"),
      {
        target: { value: "Research" },
      },
    )

    expect(screen.getByText("Research Tool")).not.toBeNull()
    expect(screen.queryByText("Release Notes Tool")).toBeNull()
  })

  it("sorts selected tools before unselected tools", () => {
    render(<TaskAgentsClient />)

    const pageText = document.body.textContent ?? ""
    expect(pageText.indexOf("Release Notes Tool")).toBeLessThan(
      pageText.indexOf("Research Tool"),
    )
  })

  it("shows only selected skills when selected-only filter is enabled", () => {
    render(<TaskAgentsClient />)

    fireEvent.click(screen.getAllByRole("button", { name: "bindings.selectedOnly" })[1])

    expect(screen.getByText("skill.alpha")).not.toBeNull()
    expect(screen.queryByText("skill.beta")).toBeNull()
  })

  it("opens the type starter before creating a new agent", async () => {
    render(<TaskAgentsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.new" }))

    expect((await screen.findAllByText("starter.title")).length).toBeGreaterThan(0)
    expect(screen.getByText("starter.chat.title")).not.toBeNull()
    expect(screen.getByText("starter.image.title")).not.toBeNull()
    expect(screen.getByText("starter.voice.title")).not.toBeNull()
  })

  it("hides bindings when creating an image agent from the starter", async () => {
    render(<TaskAgentsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.new" }))
    fireEvent.click(await screen.findByRole("button", { name: "starter.image.cta" }))

    expect(await screen.findByText("editor.imageWorkspace.title")).not.toBeNull()
    expect(screen.queryByText("bindings.title")).toBeNull()
    expect(screen.getByText("editor.imageConfig.title")).not.toBeNull()
  })

  it("keeps bindings visible for chat task agents", () => {
    render(<TaskAgentsClient />)

    expect(screen.getByText("bindings.title")).not.toBeNull()
  })

  it("marks chat task agent required fields in the editor", () => {
    render(<TaskAgentsClient />)

    expect(screen.getByText("editor.requiredHint")).not.toBeNull()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "label" &&
          element.textContent === "editor.fields.name*",
      ),
    ).not.toBeNull()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "label" &&
          element.textContent === "editor.fields.taskPrompt*",
      ),
    ).not.toBeNull()
    expect(
      screen.getByDisplayValue("Agent One"),
    ).toHaveAttribute("required")
    expect(
      screen.getByDisplayValue("Do task one"),
    ).toHaveAttribute("required")
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "label" &&
          element.textContent === "editor.fields.description",
      ),
    ).not.toBeNull()
  })

  it("shows structured image config fields for image-generation agents without chat bindings", async () => {
    render(<TaskAgentsClient />)

    fireEvent.click(screen.getByRole("button", { name: /Agent Two/i }))

    expect(await screen.findByText("editor.imageConfig.title")).not.toBeNull()
    expect(screen.queryByText("bindings.title")).toBeNull()
    expect(screen.queryByText("debug.cards.bindings")).toBeNull()
    expect(screen.queryByLabelText("editor.fields.taskPrompt")).toBeNull()
    expect(screen.queryByLabelText("editor.imageConfig.fields.imageUrl")).toBeNull()
    expect(screen.getByLabelText("editor.imageConfig.fields.aspectRatio")).toBeTruthy()
    expect(screen.getByDisplayValue("1:1")).toBeTruthy()
  })

  it("saves image agents without persisting a static image_url and uses the internal prompt", async () => {
    mockUpdateCustomTaskAgent.mockResolvedValueOnce({
      ...agents[1],
      description: "Updated image agent",
      task_prompt: "Generate images from the user's current chat request and attachments.",
      model_config: {
        model: "Qwen-Image",
        image_generation: {
          aspect_ratio: "1:1",
        },
      },
      updated_at: "2026-03-13T00:00:00Z",
    })

    render(<TaskAgentsClient />)

    fireEvent.click(screen.getByRole("button", { name: /Agent Two/i }))

    fireEvent.change(screen.getByLabelText("editor.fields.description"), {
      target: { value: "Updated image agent" },
    })

    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    await waitFor(() => {
      expect(mockUpdateCustomTaskAgent).toHaveBeenCalled()
    })

    const [, payload] = mockUpdateCustomTaskAgent.mock.calls[0]
    expect(payload.task_prompt).toBe(
      "Generate images from the user's current chat request and attachments.",
    )
    expect(payload.model_config).toEqual({
      model: "Qwen-Image",
      image_generation: {
        allow_text_only: true,
        aspect_ratio: "1:1",
        max_input_images: 1,
      },
    })
  })
})
