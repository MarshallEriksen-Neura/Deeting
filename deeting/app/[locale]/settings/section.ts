export type SettingsSection =
  | "models"
  | "aiAccess"
  | "ecosystem"
  | "storage"
  | "agent"
  | "browser"
  | "relay"
  | "shortcuts"
  | "window"
  | "version";

const SETTINGS_SECTIONS = new Set<SettingsSection>([
  "models",
  "aiAccess",
  "ecosystem",
  "storage",
  "agent",
  "browser",
  "relay",
  "shortcuts",
  "window",
  "version",
]);

export function normalizeSettingsSection(
  value: string | null | undefined
): SettingsSection {
  if (value && SETTINGS_SECTIONS.has(value as SettingsSection)) {
    return value as SettingsSection;
  }

  return "models";
}
