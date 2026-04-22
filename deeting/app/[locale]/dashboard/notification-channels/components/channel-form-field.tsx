"use client"

import { Input } from "@/components/ui/shadcn/input"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { Switch } from "@/components/ui/shadcn/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select"

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
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--ink-4)]"
      >
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </label>

      {type === "switch" ? (
        <div className="flex items-center justify-between rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-3 py-2.5 shadow-[var(--ios-button-shadow-soft)]">
          <span className="text-sm text-[color:var(--ink-2)]">{placeholder || label}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
        </div>
      ) : type === "select" ? (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(nextValue) => onChange(nextValue)} disabled={disabled}>
          <SelectTrigger id={id} className="w-full rounded-2xl border-[color:var(--hairline)] bg-[color:var(--panel-bg)] shadow-[var(--ios-button-shadow-soft)]">
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
          className="rounded-2xl border-[color:var(--hairline)] bg-[color:var(--panel-bg)] shadow-[var(--ios-button-shadow-soft)]"
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-11 rounded-2xl border-[color:var(--hairline)] bg-[color:var(--panel-bg)] shadow-[var(--ios-button-shadow-soft)]"
        />
      )}

      {description ? (
        <p className="text-[11px] leading-5 text-[color:var(--ink-3)]">{description}</p>
      ) : null}
    </div>
  )
}

