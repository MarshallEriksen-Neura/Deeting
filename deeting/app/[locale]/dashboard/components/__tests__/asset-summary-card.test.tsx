import { render, screen, waitFor } from "@testing-library/react"

import { AssetSummaryCard } from "@/app/[locale]/dashboard/components/asset-summary-card"
import { useLocalAssets } from "@/lib/swr/use-local-assets"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/lib/swr/use-local-assets", () => ({
  useLocalAssets: jest.fn(),
}))

const mockUseLocalAssets = useLocalAssets as jest.MockedFunction<typeof useLocalAssets>

describe("AssetSummaryCard", () => {
  beforeEach(() => {
    mockUseLocalAssets.mockReset()
  })

  it("shows recent and pinned asset counts", async () => {
    mockUseLocalAssets.mockReturnValue({
      data: [
        {
          asset_id: "asset-1",
          asset_kind: "render_card",
          title: "Weather Card",
          summary: "Cloudy",
          origin_session_id: "session-1",
          origin_turn_index: 3,
          source_block_id: "render-1",
          source_view_type: "html.v1",
          render_hint: "weather-card",
          template_id: "manual://weather-card",
          template_version: "v1",
          latest_snapshot_html: "<div></div>",
          latest_render_data_json: "{\"temp_c\":22}",
          refresh_spec_json: "{\"kind\":\"chat_replay\"}",
          status: "active",
          is_pinned: true,
          is_archived: false,
          created_at: "2026-03-31T00:00:00Z",
          updated_at: "2026-03-31T00:00:00Z",
          last_refreshed_at: null,
          last_opened_at: null,
        },
        {
          asset_id: "asset-2",
          asset_kind: "render_card",
          title: "Stock Card",
          summary: "AAPL latest snapshot",
          origin_session_id: "session-2",
          origin_turn_index: 4,
          source_block_id: "render-2",
          source_view_type: "html.v1",
          render_hint: "stock-card",
          template_id: "manual://stock-card",
          template_version: "v1",
          latest_snapshot_html: "<div></div>",
          latest_render_data_json: "{\"price\":180}",
          refresh_spec_json: "{\"kind\":\"chat_replay\"}",
          status: "active",
          is_pinned: false,
          is_archived: false,
          created_at: "2026-03-31T00:00:00Z",
          updated_at: "2026-03-31T00:00:00Z",
          last_refreshed_at: null,
          last_opened_at: null,
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    } as never)

    render(<AssetSummaryCard />)

    await waitFor(() => {
      expect(screen.getByText("title")).toBeInTheDocument()
    })

    expect(screen.getByText("Weather Card")).toBeInTheDocument()
    expect(screen.getByText("Stock Card")).toBeInTheDocument()
    expect(screen.getByText("sections.pinned")).toBeInTheDocument()
    expect(screen.getByText("sections.recent")).toBeInTheDocument()
  })
})
