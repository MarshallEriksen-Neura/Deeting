"use client"

import * as React from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/hooks/use-i18n"

interface ChatInputProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  placeholderName: string
  errorMessage: string | null
}

export function ChatInput({
  inputValue,
  onInputChange,
  onSend,
  disabled,
  placeholderName,
  errorMessage
}: ChatInputProps) {
  const t = useI18n("chat")

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="p-4 border-t bg-background/80 backdrop-blur">
      <div className="max-w-3xl mx-auto relative flex gap-2">
        <Input 
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("input.placeholder", { name: placeholderName })}
          className="rounded-full pl-4 pr-12 py-6 shadow-sm border-muted-foreground/20 focus-visible:ring-1"
          autoFocus
          disabled={disabled}
        />
        <Button 
          size="icon" 
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-8 w-8"
          onClick={onSend}
          disabled={!inputValue.trim() || disabled}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      {errorMessage ? (
        <div className="text-center mt-2 text-xs text-red-500/80">
          {errorMessage}
        </div>
      ) : null}
      <div className="text-center mt-2 text-xs text-muted-foreground/50">
        {t("footer.disclaimer")}
      </div>
    </div>
  )
}
