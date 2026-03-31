import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { AssetsClient } from "@/app/[locale]/dashboard/assets/components/assets-client"
import {
  listLocalAssets,
  saveLocalAsset,
  updateLocalAsset,
  type LocalAsset,
} from "@/lib/api/local-assets"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}))

jest.mock("@/lib/api/local-assets", () => ({
  listLocalAssets: jest.fn(),
  saveLocalAsset: jest.fn(),
  updateLocalAsset: jest.fn(),
}))

const mockListLocalAssets = listLocalAssets as jest.MockedFunction<typeof listLocalAssets>
const mockSaveLocalAsset = saveLocalAsset as jest.MockedFunction<typeof saveLocalAsset>
const mockUpdateLocalAsset = updateLocalAsset as jest.MockedFunction<typeof updateLocalAsset>

describe("AssetsClient", () => {
  beforeEach(() => {
    mockListLocalAssets.mockReset()
    mockSaveLocalAsset.mockReset()
    mockUpdateLocalAsset.mockReset()
  })

  it("renders pinned and recent assets", async () => {
    mockListLocalAssets.mockResolvedValue([
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
    ])

    render(<AssetsClient />)

    await waitFor(() => {
      expect(screen.getAllByText("Weather Card")).toHaveLength(2)
    })

    expect(screen.getByText("Stock Card")).toBeInTheDocument()
    expect(screen.getByText("sections.pinned")).toBeInTheDocument()
    expect(screen.getByText("sections.recent")).toBeInTheDocument()
  })

  it("updates an asset when pin is toggled", async () => {
    mockListLocalAssets.mockResolvedValue([
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
        is_pinned: false,
        is_archived: false,
        created_at: "2026-03-31T00:00:00Z",
        updated_at: "2026-03-31T00:00:00Z",
        last_refreshed_at: null,
        last_opened_at: null,
      },
    ])
    mockUpdateLocalAsset.mockResolvedValue({
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
    })

    render(<AssetsClient />)

    await waitFor(() => {
      expect(screen.getByText("Weather Card")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "actions.pin" }))

    await waitFor(() => {
      expect(mockUpdateLocalAsset).toHaveBeenCalledWith("asset-1", { isPinned: true })
    })
  })

  it("creates a local html asset from the dashboard dialog", async () => {
    const createdAsset: LocalAsset = {
      asset_id: "weather-ios18-card",
      asset_kind: "html_asset",
      title: "Weather iOS18",
      summary: "Reusable weather card",
      origin_session_id: "",
      origin_turn_index: 0,
      source_block_id: null,
      source_view_type: "html.v1",
      render_hint: "weather-card",
      template_id: "asset://weather-ios18-card",
      template_version: "v1",
      html_entry: "bundles/weather-ios18-card/index.html",
      data_mode: "ai_data",
      match_hints_json: "[\"weather\",\"天气\"]",
      props_hint_json: "[\"location\"]",
      output_example_json: "{\"temp_c\":22}",
      latest_snapshot_html: "<div>weather</div>",
      latest_render_data_json: null,
      refresh_spec_json: null,
      status: "active",
      is_pinned: false,
      is_archived: false,
      created_at: "2026-03-31T00:00:00Z",
      updated_at: "2026-03-31T00:00:00Z",
      last_refreshed_at: null,
      last_opened_at: null,
    }
    let currentAssets: LocalAsset[] = []
    mockListLocalAssets.mockImplementation(async () => currentAssets)
    mockSaveLocalAsset.mockImplementation(async () => {
      currentAssets = [createdAsset]
      return createdAsset
    })

    render(<AssetsClient />)

    await waitFor(() => {
      expect(screen.getByText("empty.recent")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "actions.create" }))

    fireEvent.change(screen.getByLabelText("createDialog.fields.assetId"), {
      target: { value: "weather-ios18-card" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.title"), {
      target: { value: "Weather iOS18" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.summary"), {
      target: { value: "Reusable weather card" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.renderHint"), {
      target: { value: "weather-card" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.matchHints"), {
      target: { value: "weather, 天气" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.propsHint"), {
      target: { value: "location" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.outputExample"), {
      target: { value: "{\"temp_c\":22}" },
    })
    fireEvent.change(screen.getByLabelText("createDialog.fields.html"), {
      target: { value: "<div>weather</div>" },
    })

    fireEvent.click(screen.getByRole("button", { name: "createDialog.actions.save" }))

    await waitFor(() => {
      expect(mockSaveLocalAsset).toHaveBeenCalledWith({
        assetId: "weather-ios18-card",
        title: "Weather iOS18",
        html: "<div>weather</div>",
        summary: "Reusable weather card",
        renderHint: "weather-card",
        dataMode: "ai_data",
        matchHints: ["weather", "天气"],
        propsHint: ["location"],
        outputExample: { temp_c: 22 },
      })
    })

    await waitFor(() => {
      expect(screen.getByText("Weather iOS18")).toBeInTheDocument()
    })
  })

  it("opens a detail sheet when an asset card body is clicked", async () => {
    mockListLocalAssets.mockResolvedValue([
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
        latest_snapshot_html: "<div>snapshot</div>",
        latest_render_data_json: "{\"temp_c\":22}",
        refresh_spec_json: "{\"kind\":\"chat_replay\"}",
        status: "active",
        is_pinned: false,
        is_archived: false,
        created_at: "2026-03-31T00:00:00Z",
        updated_at: "2026-03-31T00:00:00Z",
        last_refreshed_at: null,
        last_opened_at: null,
      },
    ])
    mockUpdateLocalAsset.mockResolvedValue({
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
      latest_snapshot_html: "<div>snapshot</div>",
      latest_render_data_json: "{\"temp_c\":22}",
      refresh_spec_json: "{\"kind\":\"chat_replay\"}",
      status: "active",
      is_pinned: false,
      is_archived: false,
      created_at: "2026-03-31T00:00:00Z",
      updated_at: "2026-03-31T00:00:00Z",
      last_refreshed_at: null,
      last_opened_at: "2026-03-31T00:00:00Z",
    })

    render(<AssetsClient />)

    await waitFor(() => {
      expect(screen.getByText("Weather Card")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: /Weather Card/ }))

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
    expect(screen.getByTitle("Weather Card")).toBeInTheDocument()
    expect(mockUpdateLocalAsset).toHaveBeenCalledWith("asset-1", { markOpened: true })
  })
})
