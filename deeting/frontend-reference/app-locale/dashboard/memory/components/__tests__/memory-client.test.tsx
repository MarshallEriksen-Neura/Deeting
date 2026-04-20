import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryClient } from "@/app/[locale]/dashboard/memory/components/memory-client"
import { clearAllMemories, updateMemory } from "@/lib/api/memory"
import { useMemories, useMemorySearch } from "@/lib/swr"
import type { MemoryItem } from "@/types/memory"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/lib/swr", () => ({
  useMemories: jest.fn(),
  useMemorySearch: jest.fn(),
}))

jest.mock("@/lib/api/memory", () => ({
  updateMemory: jest.fn(),
  deleteMemory: jest.fn(),
  clearAllMemories: jest.fn(),
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="skeleton" {...props} />,
}))

jest.mock("@/components/ui/input", () => ({
  Input: ({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock("@/components/ui/textarea", () => ({
  Textarea: ({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))

jest.mock("@/components/ui/infinite-list", () => ({
  InfiniteList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <button role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>
      {String(checked)}
    </button>
  ),
}))

jest.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

jest.mock("@/app/[locale]/dashboard/memory/components/memory-card", () => ({
  MemoryCard: ({ item, onEdit, onHistory }: { item: MemoryItem; onEdit: (item: MemoryItem) => void; onHistory: (id: string) => void }) => (
    <div>
      <span>{item.content}</span>
      <button onClick={() => onEdit(item)}>edit-{item.id}</button>
      <button onClick={() => onHistory(item.id)}>history-{item.id}</button>
    </div>
  ),
}))

jest.mock("@/app/[locale]/dashboard/memory/components/memory-snapshots-dialog", () => ({
  MemorySnapshotsDialog: ({ open, onRollbackSuccess }: { open: boolean; onRollbackSuccess?: () => void }) =>
    open ? <button onClick={() => onRollbackSuccess?.()}>rollback-success</button> : null,
}))

const mockUseMemories = useMemories as jest.Mock
const mockUseMemorySearch = useMemorySearch as jest.Mock
const mockUpdateMemory = updateMemory as jest.Mock
const mockClearAllMemories = clearAllMemories as jest.Mock

function makeMemory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: "memory-1",
    content: "memory content",
    payload: {},
    ...overrides,
  }
}

describe("MemoryClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    mockUseMemorySearch.mockReturnValue({
      results: [],
      isSearching: false,
      mutate: jest.fn(),
    })
    mockUpdateMemory.mockResolvedValue({ success: true })
    mockClearAllMemories.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("renders governance groups in boot-core-episodic-standard order", () => {
    mockUseMemories.mockReturnValue({
      memories: [
        makeMemory({ id: "standard", content: "standard memory" }),
        makeMemory({ id: "episodic", content: "episodic memory", memory_tier: "episodic" }),
        makeMemory({ id: "boot", content: "boot memory", is_boot: true }),
        makeMemory({ id: "core", content: "core memory", is_core: true }),
      ],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate: jest.fn(),
      loadMore: jest.fn(),
    })

    render(<MemoryClient />)

    expect(screen.getByText("boot memory")).toBeInTheDocument()
    expect(screen.getByText("core memory")).toBeInTheDocument()
    expect(screen.getByText("episodic memory")).toBeInTheDocument()
    expect(screen.getByText("standard memory")).toBeInTheDocument()

    const headings = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual([
      "groups.boot.title",
      "groups.core.title",
      "groups.episodic.title",
      "groups.standard.title",
    ])
  })

  it("submits governance fields from the edit dialog", async () => {
    mockUseMemories.mockReturnValue({
      memories: [
        makeMemory({
          id: "core-memory",
          content: "remember my architecture preference",
          memory_tier: "core",
          is_core: true,
          recall_when: "architecture discussions",
        }),
      ],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate: jest.fn(),
      loadMore: jest.fn(),
    })

    render(<MemoryClient />)

    fireEvent.click(screen.getByRole("button", { name: "edit-core-memory" }))
    fireEvent.change(screen.getByLabelText("fields.content"), {
      target: { value: "remember my updated architecture preference" },
    })
    fireEvent.change(screen.getByLabelText("fields.recallWhen"), {
      target: { value: "when discussing system design" },
    })

    const switches = screen.getAllByRole("switch")
    fireEvent.click(switches[1])
    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    await waitFor(() => {
      expect(mockUpdateMemory).toHaveBeenCalledWith("core-memory", {
        content: "remember my updated architecture preference",
        recall_when: "when discussing system design",
        memory_tier: "core",
        is_core: true,
        is_boot: true,
      })
    })
  })

  it("uses search results with category filtering once the query is debounced", async () => {
    jest.useFakeTimers()

    mockUseMemories.mockReturnValue({
      memories: [makeMemory({ id: "local-fact", content: "local fact memory", category: "fact" })],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate: jest.fn(),
      loadMore: jest.fn(),
    })
    mockUseMemorySearch.mockReturnValue({
      results: [
        makeMemory({ id: "search-preference", content: "preference search memory", category: "preference", is_core: true }),
        makeMemory({ id: "search-fact", content: "fact search memory", category: "fact" }),
      ],
      isSearching: false,
      mutate: jest.fn(),
    })

    render(<MemoryClient />)

    const [categorySelect] = screen.getAllByRole("combobox")
    fireEvent.change(categorySelect, { target: { value: "preference" } })
    fireEvent.change(screen.getByPlaceholderText("search.placeholder"), { target: { value: "arch" } })

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() => {
      expect(mockUseMemorySearch).toHaveBeenLastCalledWith("arch", 20, { category: "preference" })
    })

    expect(screen.getByText("preference search memory")).toBeInTheDocument()
    expect(screen.queryByText("fact search memory")).not.toBeInTheDocument()
    expect(screen.queryByText("local fact memory")).not.toBeInTheDocument()
  })

  it("filters the regular memory list by category when search is inactive", () => {
    mockUseMemories.mockReturnValue({
      memories: [
        makeMemory({ id: "fact-memory", content: "fact memory", category: "fact" }),
        makeMemory({ id: "preference-memory", content: "preference memory", category: "preference" }),
      ],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate: jest.fn(),
      loadMore: jest.fn(),
    })

    render(<MemoryClient />)

    const [categorySelect] = screen.getAllByRole("combobox")
    fireEvent.change(categorySelect, { target: { value: "preference" } })

    expect(screen.getByText("preference memory")).toBeInTheDocument()
    expect(screen.queryByText("fact memory")).not.toBeInTheDocument()
  })

  it("returns to the regular memory list after clearing the search input", async () => {
    jest.useFakeTimers()

    mockUseMemories.mockReturnValue({
      memories: [makeMemory({ id: "local-memory", content: "local memory", category: "fact" })],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate: jest.fn(),
      loadMore: jest.fn(),
    })
    mockUseMemorySearch.mockReturnValue({
      results: [makeMemory({ id: "search-memory", content: "search memory", category: "fact" })],
      isSearching: false,
      mutate: jest.fn(),
    })

    render(<MemoryClient />)

    fireEvent.change(screen.getByPlaceholderText("search.placeholder"), { target: { value: "arch" } })

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(screen.getByText("search memory")).toBeInTheDocument()
    expect(screen.queryByText("local memory")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(screen.getByText("local memory")).toBeInTheDocument()
    expect(screen.queryByText("search memory")).not.toBeInTheDocument()
  })

  it("refreshes list and search caches after rollback succeeds", async () => {
    const mutate = jest.fn().mockResolvedValue(undefined)
    const mutateSearch = jest.fn().mockResolvedValue(undefined)

    mockUseMemories.mockReturnValue({
      memories: [makeMemory({ id: "memory-with-history", content: "memory with history" })],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate,
      loadMore: jest.fn(),
    })
    mockUseMemorySearch.mockReturnValue({
      results: [],
      isSearching: false,
      mutate: mutateSearch,
    })

    render(<MemoryClient />)

    fireEvent.click(screen.getByRole("button", { name: "history-memory-with-history" }))
    fireEvent.click(screen.getByRole("button", { name: "rollback-success" }))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1)
      expect(mutateSearch).toHaveBeenCalledTimes(1)
    })
  })

  it("refreshes list and search caches after clearing all memories", async () => {
    const mutate = jest.fn().mockResolvedValue(undefined)
    const mutateSearch = jest.fn().mockResolvedValue(undefined)

    mockUseMemories.mockReturnValue({
      memories: [makeMemory({ id: "memory-a", content: "memory a" })],
      isLoading: false,
      isLoadingMore: false,
      isReachedEnd: true,
      mutate,
      loadMore: jest.fn(),
    })
    mockUseMemorySearch.mockReturnValue({
      results: [],
      isSearching: false,
      mutate: mutateSearch,
    })

    render(<MemoryClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.clearAll" }))
    fireEvent.click(screen.getAllByRole("button", { name: "actions.clearAll" })[1])

    await waitFor(() => {
      expect(mockClearAllMemories).toHaveBeenCalledTimes(1)
      expect(mutate).toHaveBeenCalledTimes(1)
      expect(mutateSearch).toHaveBeenCalledTimes(1)
    })
  })
})