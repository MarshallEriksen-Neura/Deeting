import { generateStaticParams } from "@/app/[locale]/admin/provider-presets/[slug]/page"

jest.mock("next/dynamic", () => () => () => null)
jest.mock("next-intl/server", () => ({
  getTranslations: jest.fn(async () => (key: string) => key),
  setRequestLocale: jest.fn(),
}))
jest.mock("lucide-react", () => ({
  Package2: () => null,
}))
jest.mock("@/components/admin", () => ({
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AdminSkeleton: () => <div>loading</div>,
}))

describe("ProviderPresetDetailPage desktop export", () => {
  it("provides empty static params for desktop export builds", () => {
    expect(generateStaticParams()).toEqual([])
  })
})
