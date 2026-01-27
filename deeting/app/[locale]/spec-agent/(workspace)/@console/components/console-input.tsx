'use client'

import { memo } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'

type ConsoleInputProps = {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  onSend: () => void
}

export const ConsoleInput = memo(function ConsoleInput({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onSend,
}: ConsoleInputProps) {
  return (
    <>
      <Separator />
      <div className="flex-shrink-0 p-4">
        <div className="flex gap-2">
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 min-h-[40px] resize-none"
            rows={1}
          />
          <Button onClick={onSend} disabled={!value.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </>
  )
})
