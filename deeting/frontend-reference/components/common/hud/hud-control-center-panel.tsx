'use client';

import { ModelPicker } from '@/components/models/model-picker';

interface HudControlCenterPanelProps {
  value: string;
  onChange: (value: string) => void;
  modelGroups: unknown;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  emptyText: string;
  noResultsText: string;
  disabled?: boolean;
}

export function HudControlCenterPanel({
  value,
  onChange,
  modelGroups,
  title,
  subtitle,
  searchPlaceholder,
  emptyText,
  noResultsText,
  disabled = false,
}: HudControlCenterPanelProps) {
  return (
    <>
      <ModelPicker
        value={value}
        onChange={onChange}
        modelGroups={modelGroups as any}
        title={title}
        subtitle={subtitle}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        noResultsText={noResultsText}
        disabled={disabled}
      />

      <div className="flex items-center justify-center pb-1">
        <div className="w-12 h-1 rounded-full bg-slate-200/70 dark:bg-white/10" />
      </div>
    </>
  );
}
