"use client"

import { Search } from "lucide-react"
import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"

type BindingSearchBarProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  showSelectedOnly: boolean
  onToggleSelectedOnly: () => void
  selectedOnlyLabel: string
}

export function BindingSearchBar({
  value,
  onChange,
  placeholder,
  showSelectedOnly,
  onToggleSelectedOnly,
  selectedOnlyLabel,
}: BindingSearchBarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)]" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="ws-control h-9 rounded-xl border-[var(--hairline)] bg-[var(--panel-bg)]/60 pl-9 text-xs focus:ring-1 focus:ring-[var(--accent-soft)]"
        />
      </div>
      <Button
        type="button"
        variant={showSelectedOnly ? "default" : "outline"}
        onClick={onToggleSelectedOnly}
        className="ws-control h-9 shrink-0 rounded-xl px-3 text-[11px] font-bold uppercase tracking-wider"
      >
        {selectedOnlyLabel}
      </Button>
    </div>
  )
}
