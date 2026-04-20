import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssetLibraryCard } from "@/app/[locale]/dashboard/assets/components/asset-library-card";
import type { LocalAsset } from "@/lib/api/local-assets";

const TEST_ASSET: LocalAsset = {
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
  html_entry: null,
  data_mode: "ai_data",
  match_hints_json: '["weather"]',
  props_hint_json: '["location"]',
  output_example_json: '{"temp_c":22}',
  latest_snapshot_html: "<div></div>",
  latest_render_data_json: '{"temp_c":22}',
  refresh_spec_json: '{"kind":"chat_replay"}',
  status: "active",
  is_pinned: false,
  is_archived: false,
  created_at: "2026-03-31T00:00:00Z",
  updated_at: "2026-03-31T00:00:00Z",
  last_refreshed_at: null,
  last_opened_at: null,
};

function createTranslator() {
  return (key: string, values?: Record<string, string | number>) => {
    switch (key) {
      case "actions.pin":
        return "Pin asset";
      case "actions.unpin":
        return "Unpin asset";
      case "actions.archive":
        return "Archive asset";
      case "actions.openConversation":
        return "Open conversation";
      case "filters.pinned":
        return "Pinned";
      case "fields.sourceSession":
        return `Session ${values?.value ?? ""}`;
      case "fields.createdLocally":
        return "Created locally";
      case "fields.updatedAt":
      case "fields.lastOpenedAt":
      case "fields.lastRefreshedAt":
        return `Updated ${values?.value ?? ""}`;
      case "dataModes.ai_data":
        return "AI data";
      case "dataModes.self_fetch":
        return "Self fetch";
      case "dataModes.unknown":
        return "Unknown";
      case "empty.summary":
        return "No summary";
      case "tooltips.pin":
        return "Keep this asset pinned at the top";
      case "tooltips.unpin":
        return "Remove this asset from pinned items";
      case "tooltips.archive":
        return "Archive this asset and remove it from the active list";
      case "archiveDialog.title":
        return "Archive this asset?";
      case "archiveDialog.description":
        return `"${values?.name ?? ""}" will be removed from the active asset library.`;
      case "archiveDialog.cancel":
        return "Cancel";
      case "archiveDialog.confirm":
        return "Archive";
      default:
        return key;
    }
  };
}

describe("AssetLibraryCard", () => {
  it("renders the pin action and toggles pin state", () => {
    const onTogglePin = jest.fn();

    render(
      <AssetLibraryCard
        asset={TEST_ASSET}
        busyAssetId={null}
        locale="en"
        onArchive={jest.fn()}
        onOpenConversation={null}
        onOpenDetails={jest.fn()}
        onTogglePin={onTogglePin}
        t={createTranslator()}
      />,
    );

    const pinButton = screen.getByRole("button", { name: "Pin asset" });
    fireEvent.click(pinButton);

    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("archives only after confirmation", async () => {
    const onArchive = jest.fn();

    render(
      <AssetLibraryCard
        asset={TEST_ASSET}
        busyAssetId={null}
        locale="en"
        onArchive={onArchive}
        onOpenConversation={null}
        onOpenDetails={jest.fn()}
        onTogglePin={jest.fn()}
        t={createTranslator()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive asset" }));

    expect(onArchive).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("Archive this asset?")).toBeInTheDocument();
    });

    expect(
      screen.getByText('"Weather Card" will be removed from the active asset library.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});
