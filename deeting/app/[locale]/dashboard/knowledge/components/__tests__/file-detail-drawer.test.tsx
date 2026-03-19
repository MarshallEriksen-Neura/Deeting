import { render } from "@testing-library/react"

import { FileDetailDrawer } from "@/app/[locale]/dashboard/knowledge/components/file-detail-drawer"
import type { KnowledgeChunk, KnowledgeFile } from "@/types/knowledge"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="sheet-content" className={className}>
      {children}
    </div>
  ),
  SheetHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="sheet-header" className={className}>
      {children}
    </div>
  ),
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="sheet-title" className={className}>
      {children}
    </div>
  ),
  SheetDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="sheet-description" className={className}>
      {children}
    </div>
  ),
}))

jest.mock("@/components/ui/status-pill", () => ({
  StatusPill: ({ text }: { text: string }) => <span>{text}</span>,
}))

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

function makeFile(overrides: Partial<KnowledgeFile> = {}): KnowledgeFile {
  return {
    id: "file-1",
    name: "Long Knowledge File",
    type: "pdf",
    size: 2048,
    status: "active",
    chunks: 2,
    folderId: null,
    createdAt: "2026-03-18T10:00:00.000Z",
    updatedAt: "2026-03-18T10:00:00.000Z",
    ...overrides,
  }
}

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: "chunk-1",
    fileId: "file-1",
    index: 0,
    content: "Chunk preview content",
    tokenCount: 128,
    ...overrides,
  }
}

describe("FileDetailDrawer", () => {
  it("keeps the drawer body constrained so long previews can scroll", () => {
    const { container } = render(
      <FileDetailDrawer
        open
        onOpenChange={jest.fn()}
        file={makeFile()}
        chunks={[makeChunk(), makeChunk({ id: "chunk-2", index: 1 })]}
      />
    )

    const sheetContent = container.querySelector('[data-slot="sheet-content"]') as HTMLElement | null
    const scrollBody = container.querySelector(
      '[data-testid="file-detail-drawer-scroll-body"]'
    ) as HTMLElement | null

    expect(sheetContent).not.toBeNull()
    expect(scrollBody).not.toBeNull()
    expect(sheetContent?.className).toContain("overflow-hidden")
    expect(scrollBody?.className).toContain("flex-1")
    expect(scrollBody?.className).toContain("min-h-0")
    expect(scrollBody?.className).toContain("overflow-y-auto")
  })
})
