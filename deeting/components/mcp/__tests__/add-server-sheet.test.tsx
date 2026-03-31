import type { ButtonHTMLAttributes, ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { AddServerSheet } from "@/components/mcp/add-server-sheet"

const mockAddNotification = jest.fn()

jest.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = ((key: string) => key) as ((key: string) => string) & {
      raw: (key: string) => string
    }
    translate.raw = (key: string) => key
    return translate
  },
}))

jest.mock("@/components/contexts/notification-context", () => ({
  useNotifications: () => ({
    addNotification: mockAddNotification,
  }),
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const fillWizardFields = () => {
  fireEvent.change(screen.getByPlaceholderText("addServer.placeholders.name"), {
    target: { value: "filesystem" },
  })
  fireEvent.change(screen.getByPlaceholderText("addServer.placeholders.command"), {
    target: { value: "npx" },
  })
}

const createDeferred = () => {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe("AddServerSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("keeps the sheet open and shows a pending hint while the import is still running", async () => {
    const deferred = createDeferred()
    const onCreate = jest.fn(() => deferred.promise)
    const onOpenChange = jest.fn()

    render(<AddServerSheet open onOpenChange={onOpenChange} onCreate={onCreate} />)

    fillWizardFields()
    fireEvent.click(screen.getByRole("button", { name: "addServer.save" }))

    expect(onCreate).toHaveBeenCalledWith({
      config: {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: [],
            env: {},
          },
        },
      },
    })
    expect(screen.getByText("addServer.saving")).toBeInTheDocument()
    expect(screen.getByText("addServer.pendingHint")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("addServer.placeholders.name")).toBeDisabled()
    expect(onOpenChange).not.toHaveBeenCalled()

    deferred.resolve(true)

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it("keeps the sheet open when the import action reports failure", async () => {
    const onCreate = jest.fn().mockResolvedValue(false)
    const onOpenChange = jest.fn()

    render(<AddServerSheet open onOpenChange={onOpenChange} onCreate={onCreate} />)

    fillWizardFields()
    fireEvent.click(screen.getByRole("button", { name: "addServer.save" }))

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1)
    })

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "addServer.save" })).toBeEnabled()
    expect(screen.queryByText("addServer.pendingHint")).not.toBeInTheDocument()
  })
})
