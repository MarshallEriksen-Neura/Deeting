import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { TaskAgentsClient } from "./task-agents-client"
import {
  supportsLocalCustomTaskAgents,
  type CustomTaskAgentProfile,
} from "@/lib/api/custom-task-agents"

const mockMutate = jest.fn()
const mockUseSWR = jest.fn()

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "en",
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

const agents: CustomTaskAgentProfile[] = [
  {
    id: "agent-1",
    name: "Agent One",
    description: "First agent",
    task_prompt: "Do task one",
    invocation_kind: "chat",
    model_config: { model: "default" },
    bound_tool_ids: ["tool.release"],
    bound_skill_ids: ["skill.alpha"],
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
    invocation_kind: "chat",
    model_config: { model: "default" },
    bound_tool_ids: [],
    bound_skill_ids: [],
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
            tools: [
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
            skills: [
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
    const confirmSpy = jest
      .spyOn(window, "confirm")
      .mockReturnValue(false)

    render(<TaskAgentsClient />)

    const nameInput = await screen.findByDisplayValue("Agent One")
    fireEvent.change(nameInput, {
      target: { value: "Changed Agent Name" },
    })

    fireEvent.click(screen.getByRole("button", { name: /Agent Two/i }))

    expect(confirmSpy).toHaveBeenCalledWith("confirm.discardChanges")
    expect(screen.getByDisplayValue("Changed Agent Name")).not.toBeNull()
  })

  it("registers beforeunload protection when there are unsaved changes", async () => {
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
      expect(beforeUnloadEvent.defaultPrevented).toBe(true)
      expect(beforeUnloadEvent.returnValue).toBe("")
    })
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
})
