import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { render, screen } from "@testing-library/react"

import { IslandCollapsedView } from "../island-collapsed-view"

jest.mock("framer-motion", () => {
  type MotionDivProps = ComponentPropsWithoutRef<"div"> & {
    layout?: unknown
    whileHover?: unknown
    whileTap?: unknown
    animate?: unknown
    initial?: unknown
    exit?: unknown
    transition?: unknown
    variants?: unknown
  }

  const motionComponent = forwardRef<HTMLDivElement, MotionDivProps>(function MotionDiv(
    { children, ...props },
    ref
  ) {
    delete props.layout
    delete props.whileHover
    delete props.whileTap
    delete props.animate
    delete props.initial
    delete props.exit
    delete props.transition
    delete props.variants

    return (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  })
  return {
    motion: {
      div: motionComponent,
      span: motionComponent,
    },
  }
})

jest.mock("next-intl", () => ({
  useLocale: () => "en",
}))

jest.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}))

jest.mock("../island-context", () => ({
  useIslandContext: () => ({
    statusLabel: "Ready",
    summaryText: "Connecting to workspace",
    lastReplyAt: null,
    isBusy: false,
    expand: jest.fn(),
  }),
}))

describe("IslandCollapsedView", () => {
  it("uses denser sizing in compact mode for the desktop island window", () => {
    const { container } = render(<IslandCollapsedView compact />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("h-full")
    expect(root.className).toContain("gap-2.5")
    expect(root.className).toContain("px-3.5")
    expect(root.className).toContain("py-2")
    expect(screen.getByText("Connecting to workspace").className).toContain("max-w-[112px]")
  })

  it("keeps the default roomier sizing outside compact mode", () => {
    const { container } = render(<IslandCollapsedView />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("gap-3")
    expect(root.className).toContain("px-4")
    expect(root.className).toContain("py-2.5")
    expect(root.className).not.toContain("h-full")
    expect(screen.getByText("Connecting to workspace").className).toContain("max-w-[140px]")
  })
})
