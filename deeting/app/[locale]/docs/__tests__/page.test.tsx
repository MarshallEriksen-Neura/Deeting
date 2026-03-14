import { render, screen } from "@testing-library/react"

jest.mock("@/lib/source", () => ({
  source: {
    getPage: jest.fn(() => ({
      data: {
        title: "Docs Home",
        description: "Public docs entry",
        toc: [],
        body: () => <div>Seed docs body</div>,
      },
      path: "content/docs/index.mdx",
    })),
  },
}))

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("notFound")
  }),
}))

jest.mock("next-intl/server", () => ({
  setRequestLocale: jest.fn(),
}))

jest.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["zh-CN", "en"],
  },
}))

jest.mock("@/components/docs/docs-page", () => ({
  DocsPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DocsTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DocsDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DocsBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe("Public docs page", () => {
  it("renders the root docs entry", async () => {
    const mod = await import("../[[...slug]]/page")
    const view = await mod.default({
      params: Promise.resolve({ locale: "en", slug: undefined }),
    })

    render(view)

    expect(screen.queryByText("Docs Home")).not.toBeNull()
    expect(screen.queryByText("Public docs entry")).not.toBeNull()
    expect(screen.queryByText("Seed docs body")).not.toBeNull()
  })
})
