"use client"

import * as React from "react"
import { Keyboard, RotateCcw } from "lucide-react"
import { GlassButton } from "@/ui/common/glass-button"

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"])

function shortcutParts(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part === "CommandOrControl" ? "Ctrl" : part))
}

function keyFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null
  }
  if (event.code === "Space") {
    return "Space"
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase()
  }
  return event.key.replace(/^Arrow/, "")
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = keyFromKeyboardEvent(event)
  if (!key) {
    return null
  }

  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) {
    modifiers.push("CommandOrControl")
  }
  if (event.altKey) {
    modifiers.push("Alt")
  }
  if (event.shiftKey) {
    modifiers.push("Shift")
  }
  if (modifiers.length === 0 && !/^F\d{1,2}$/.test(key)) {
    return null
  }
  return [...modifiers, key].join("+")
}

interface ShortcutRecorderProps {
  id: string
  value: string
  defaultValue: string
  disabled: boolean
  onChange: (value: string) => void
  recordLabel: string
  recordingLabel: string
  resetLabel: string
  waitingLabel: string
}

export function ShortcutRecorder({
  id,
  value,
  defaultValue,
  disabled,
  onChange,
  recordLabel,
  recordingLabel,
  resetLabel,
  waitingLabel,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = React.useState(false)

  React.useEffect(() => {
    if (!isRecording) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        setIsRecording(false)
        return
      }

      const shortcut = shortcutFromKeyboardEvent(event)
      if (!shortcut) return
      onChange(shortcut)
      setIsRecording(false)
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [isRecording, onChange])

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10 sm:flex-row sm:items-center">
      <button
        id={id}
        type="button"
        onClick={() => setIsRecording(true)}
        disabled={disabled}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-border/40 bg-background/60 px-3 text-left transition-colors hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
        {isRecording ? (
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {waitingLabel}
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap gap-1.5">
            {shortcutParts(value).map((part) => (
              <kbd
                key={part}
                className="rounded-md border border-border/50 bg-background px-2 py-1 font-mono text-[11px] font-semibold text-foreground shadow-sm"
              >
                {part}
              </kbd>
            ))}
          </span>
        )}
      </button>
      <div className="flex shrink-0 gap-2">
        <GlassButton
          type="button"
          size="sm"
          variant={isRecording ? "default" : "secondary"}
          onClick={() => setIsRecording((value) => !value)}
          disabled={disabled}
        >
          {isRecording ? recordingLabel : recordLabel}
        </GlassButton>
        <GlassButton
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(defaultValue)}
          disabled={disabled}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {resetLabel}
        </GlassButton>
      </div>
    </div>
  )
}
