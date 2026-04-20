"use client";

import type { LocalAsset } from "@/lib/api/local-assets";

export interface CreateAssetFormState {
  assetId: string;
  title: string;
  summary: string;
  renderHint: string;
  dataMode: "ai_data" | "self_fetch";
  matchHints: string;
  propsHint: string;
  outputExample: string;
  html: string;
}

export type AssetFilter = "all" | "pinned" | "ai_data" | "self_fetch";

export type AssetPageTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export const INITIAL_CREATE_FORM: CreateAssetFormState = {
  assetId: "",
  title: "",
  summary: "",
  renderHint: "",
  dataMode: "ai_data",
  matchHints: "",
  propsHint: "",
  outputExample: "",
  html: "",
};

export function sortAssetsByActivity(assets: LocalAsset[]) {
  return [...assets].sort((left, right) => {
    const leftTime = getAssetSortTimestamp(left);
    const rightTime = getAssetSortTimestamp(right);
    return rightTime - leftTime;
  });
}

export function matchesAssetFilter(asset: LocalAsset, filter: AssetFilter) {
  if (filter === "all") return true;
  if (filter === "pinned") return asset.is_pinned;
  return asset.data_mode === filter;
}

export function matchesAssetQuery(asset: LocalAsset, query: string) {
  if (!query) return true;

  const haystacks = [
    asset.title,
    asset.summary,
    asset.render_hint,
    asset.source_view_type,
    asset.template_id,
    asset.origin_session_id,
    asset.asset_id,
    ...parseStringList(asset.match_hints_json),
    ...parseStringList(asset.props_hint_json),
  ];

  return haystacks.some((value) => value?.toLowerCase().includes(query));
}

export function getAssetActivityLabel(
  asset: LocalAsset,
  locale: string,
  t: AssetPageTranslator,
) {
  if (asset.last_opened_at) {
    return t("fields.lastOpenedAt", {
      value: formatAssetDate(asset.last_opened_at, locale),
    });
  }
  if (asset.last_refreshed_at) {
    return t("fields.lastRefreshedAt", {
      value: formatAssetDate(asset.last_refreshed_at, locale),
    });
  }

  return t("fields.updatedAt", {
    value: formatAssetDate(asset.updated_at, locale),
  });
}

export function getDataModeLabel(
  dataMode: string | null | undefined,
  t: AssetPageTranslator,
) {
  if (dataMode === "ai_data" || dataMode === "self_fetch") {
    return t(`dataModes.${dataMode}`);
  }

  return t("dataModes.unknown");
}

export function formatAssetDate(
  value: string | null | undefined,
  locale: string,
) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function parseStringList(value: string | null | undefined) {
  const parsed = safeParseJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function splitCommaSeparatedValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function safeParseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getAssetSortTimestamp(asset: LocalAsset) {
  return parseTimestamp(
    asset.last_opened_at ?? asset.last_refreshed_at ?? asset.updated_at,
  );
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
