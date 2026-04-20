import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemorySnapshotsDialog } from "@/app/[locale]/dashboard/memory/components/memory-snapshots-dialog"
import { listMemorySnapshots, rollbackMemory } from "@/lib/api/memory"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/lib/api/memory", () => ({
  listMemorySnapshots: jest.fn(),
  rollbackMemory: jest.fn(),
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockListMemorySnapshots = listMemorySnapshots as jest.Mock
const mockRollbackMemory = rollbackMemory as jest.Mock

describe("MemorySnapshotsDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("loads snapshots when opened and renders metadata diffs", async () => {
    mockListMemorySnapshots.mockResolvedValue([
      {
        id: "snap-1",
        memory_id: "memory-1",
        action: "update",
        old_content: "before content",
        new_content: "after content",
        old_metadata: { recall_when: "before-style", is_core: false },
        new_metadata: { recall_when: "after-style", is_core: true },
        created_at: "2026-03-09T10:00:00Z",
      },
    ])

    render(
      <MemorySnapshotsDialog
        memoryId="memory-1"
        open
        onOpenChange={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(mockListMemorySnapshots).toHaveBeenCalledWith("memory-1")
    })

    fireEvent.click(screen.getByRole("button", { name: /after content/i }))

    expect(await screen.findByText("snapshot.metadataTitle")).toBeInTheDocument()
    expect(screen.getAllByText("recall_when").length).toBeGreaterThan(0)
    expect(screen.getByText("before-style")).toBeInTheDocument()
    expect(screen.getByText("after-style")).toBeInTheDocument()
    expect(screen.getByText("false")).toBeInTheDocument()
    expect(screen.getByText("true")).toBeInTheDocument()
  })

  it("rolls back the selected snapshot from the dialog", async () => {
    const onOpenChange = jest.fn()
    const onRollbackSuccess = jest.fn()
    mockListMemorySnapshots.mockResolvedValue([
      {
        id: "snap-rollback",
        memory_id: "memory-1",
        action: "update",
        old_content: "before content",
        new_content: "after content",
        old_metadata: { is_boot: false },
        new_metadata: { is_boot: true },
        created_at: "2026-03-09T10:00:00Z",
      },
    ])
    mockRollbackMemory.mockResolvedValue({ success: true })

    render(
      <MemorySnapshotsDialog
        memoryId="memory-1"
        open
        onOpenChange={onOpenChange}
        onRollbackSuccess={onRollbackSuccess}
      />
    )

    await waitFor(() => {
      expect(mockListMemorySnapshots).toHaveBeenCalledWith("memory-1")
    })

    fireEvent.click(screen.getByRole("button", { name: "actions.rollback" }))
    fireEvent.click(screen.getByRole("button", { name: "actions.confirmRollback" }))

    await waitFor(() => {
      expect(mockRollbackMemory).toHaveBeenCalledWith("memory-1", "snap-rollback")
      expect(onRollbackSuccess).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})