"use client"

import { Input } from "@/components/ui/shadcn/input"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { Switch } from "@/components/ui/switch"
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
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </label>

      {type === "switch" ? (
        <div className="flex items-center justify-between rounded-xl border bg-background px-3 py-2">
          <span className="text-sm">{placeholder || label}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
        </div>
      ) : type === "select" ? (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(nextValue) => onChange(nextValue)} disabled={disabled}>
          <SelectTrigger id={id} className="w-full rounded-xl">
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
          className="rounded-xl"
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-10 rounded-xl"
        />
      )}

      {description ? <p className="mt-1 text-[11px] text-muted-foreground/80">{description}</p> : null}
    </div>
  )
}
