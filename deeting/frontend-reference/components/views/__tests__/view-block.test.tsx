jest.mock("@/components/views/fallback-json-view", () => ({
  FallbackJsonView: () => null,
}))

import { rendersWithoutViewCard } from "@/components/views/view-block"

describe("rendersWithoutViewCard", () => {
  it("renders html runtime views without the generic host card chrome", () => {
    expect(rendersWithoutViewCard("html.v1")).toBe(true)
  })

  it("keeps generic host card chrome for other native views", () => {
    expect(rendersWithoutViewCard("table.v1")).toBe(false)
  })
})
