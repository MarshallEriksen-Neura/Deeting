"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ChannelFormField({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  required,
  description,
  options,
  disabled = false,
}: {
  id: string
  label: string
  placeholder: string
  value: string | boolean
  onChange: (v: string | boolean) => void
  type?: "text" | "number" | "password" | "textarea" | "switch" | "select"
  required?: boolean
  description?: string
  options?: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
        {label}
        {required ? <span className="text-red-400">*</span> : null}
      </Label>

      {type === "switch" ? (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2">
          <span className="text-sm text-[var(--foreground)]">{placeholder || label}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
        </div>
      ) : type === "select" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(nextValue) => onChange(nextValue)}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-sm text-[var(--foreground)]"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : type === "textarea" ? (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={4}
          disabled={disabled}
          className="rounded-xl border-white/10 bg-[var(--foreground)]/[0.03] text-[var(--foreground)] placeholder:text-[var(--muted)]/40"
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-10 rounded-xl border-white/10 bg-[var(--foreground)]/[0.03] text-[var(--foreground)] placeholder:text-[var(--muted)]/40"
        />
      )}

      {description ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]/80">{description}</p>
      ) : null}
    </div>
  )
}

