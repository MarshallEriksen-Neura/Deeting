import { act, fireEvent, render, screen } from "@testing-library/react"
import HtmlRuntimeView from "@/components/views/html-runtime-view"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("HtmlRuntimeView", () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const first = args[0]
      if (typeof first === "string" && first.includes("not wrapped in act")) {
        return
      }
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("renders fallback summary when snapshot html is missing", () => {
    render(
      <HtmlRuntimeView
        data={{ summary: "Weather fallback" }}
        metadata={{ render_hint: "weather-card" }}
      />
    )

    expect(screen.getByText("Weather fallback")).toBeInTheDocument()
  })

  it("posts init and data updates to the iframe for interactive views", () => {
    const { rerender } = render(
      <HtmlRuntimeView
        data={{
          snapshot_html: "<div>snapshot</div>",
          initial_data: { temp_c: 22 },
        }}
        metadata={{
          render_hint: "weather-card",
          runtime_mode: "html_interactive",
          live_channel_id: "weather-feed",
          allow_live_updates: true,
        }}
      />
    )

    const iframe = document.querySelector("iframe") as HTMLIFrameElement
    const postMessage = jest.fn()
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage },
    })

    act(() => {
      fireEvent.load(iframe)
    })

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DEETING_RENDER_INIT",
        payload: { temp_c: 22 },
      }),
      "*"
    )

    rerender(
      <HtmlRuntimeView
        data={{
          snapshot_html: "<div>snapshot</div>",
          initial_data: { temp_c: 24 },
        }}
        metadata={{
          render_hint: "weather-card",
          runtime_mode: "html_interactive",
          live_channel_id: "weather-feed",
          allow_live_updates: true,
        }}
      />
    )

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DEETING_RENDER_UPDATE",
        payload: { temp_c: 24 },
      }),
      "*"
    )
  })
})
