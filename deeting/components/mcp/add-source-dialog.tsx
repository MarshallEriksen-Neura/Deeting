"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function AddSourceDialog({ children }: { children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Sync Source</DialogTitle>
          <DialogDescription>
            Connect to an external MCP configuration source.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label>Source URL or Collection ID</Label>
                <Input placeholder="https://gist.github.com/... or ModelScope Collection ID" />
            </div>

            <div className="space-y-2">
                <Label>Access Token (Optional)</Label>
                <Input type="password" placeholder="For private collections" />
            </div>
        </div>

        <DialogFooter>
            <Button type="submit">Add Source</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
