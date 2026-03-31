jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

import { invoke } from "@tauri-apps/api/core"
import { listLocalAssets, saveLocalAsset, updateLocalAsset } from "@/lib/api/local-assets"

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>

describe("local assets api", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it("lists local assets through tauri", async () => {
    mockInvoke.mockResolvedValueOnce([
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
    ] as never)

    const result = await listLocalAssets({ pinnedOnly: true })

    expect(mockInvoke).toHaveBeenCalledWith("list_local_assets", {
      request: {
        limit: 50,
        pinned_only: true,
        include_archived: false,
      },
    })
    expect(result[0]?.asset_id).toBe("asset-1")
  })

  it("updates local asset flags through tauri", async () => {
    mockInvoke.mockResolvedValueOnce({
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
      is_archived: true,
      created_at: "2026-03-31T00:00:00Z",
      updated_at: "2026-03-31T00:00:00Z",
      last_refreshed_at: null,
      last_opened_at: "2026-03-31T00:00:00Z",
    } as never)

    const result = await updateLocalAsset("asset-1", {
      isArchived: true,
      markOpened: true,
    })

    expect(mockInvoke).toHaveBeenCalledWith("update_local_asset", {
      assetId: "asset-1",
      request: {
        is_pinned: undefined,
        is_archived: true,
        mark_opened: true,
      },
    })
    expect(result.is_archived).toBe(true)
  })

  it("saves a local html asset through tauri", async () => {
    mockInvoke.mockResolvedValueOnce({
      asset_id: "weather-ios18-card",
      asset_kind: "html_asset",
      title: "Weather iOS18",
      summary: "Reusable weather card",
      origin_session_id: "session-1",
      origin_turn_index: 2,
      source_block_id: "block-1",
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
    } as never)

    const result = await saveLocalAsset({
      assetId: "weather-ios18-card",
      title: "Weather iOS18",
      html: "<div>weather</div>",
      summary: "Reusable weather card",
      originSessionId: "session-1",
      originTurnIndex: 2,
      sourceBlockId: "block-1",
      renderHint: "weather-card",
      dataMode: "ai_data",
      matchHints: ["weather", "天气"],
      propsHint: ["location"],
      outputExample: { temp_c: 22 },
    })

    expect(mockInvoke).toHaveBeenCalledWith("save_local_asset", {
      request: {
        asset_id: "weather-ios18-card",
        title: "Weather iOS18",
        html: "<div>weather</div>",
        summary: "Reusable weather card",
        asset_kind: undefined,
        source_view_type: undefined,
        render_hint: "weather-card",
        template_version: undefined,
        origin_session_id: "session-1",
        origin_turn_index: 2,
        source_block_id: "block-1",
        data_mode: "ai_data",
        match_hints: ["weather", "天气"],
        props_hint: ["location"],
        output_example: { temp_c: 22 },
      },
    })
    expect(result.asset_id).toBe("weather-ios18-card")
    expect(result.html_entry).toBe("bundles/weather-ios18-card/index.html")
  })
})
