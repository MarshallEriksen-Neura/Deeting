"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export function AddServerSheet({ children }: { children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add Manual Server</SheetTitle>
          <SheetDescription>
            Configure a new MCP server manually.
          </SheetDescription>
        </SheetHeader>
        
        <Tabs defaultValue="wizard" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="wizard">Wizard</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            
            <TabsContent value="wizard" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>Name</Label>
                    <Input placeholder="e.g. My Local Tool" />
                </div>
                
                <div className="space-y-2">
                    <Label>Transport</Label>
                    <div className="flex gap-2">
                        <Button variant="outline" className="flex-1 bg-primary/5 border-primary text-primary">Stdio</Button>
                        <Button variant="outline" className="flex-1 text-muted-foreground">SSE</Button>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Command</Label>
                    <Input placeholder="e.g. npx, python, docker" />
                </div>

                <div className="space-y-2">
                    <Label>Arguments</Label>
                    <Input placeholder="e.g. -y @modelcontextprotocol/server-filesystem" />
                </div>

                <div className="space-y-2">
                    <Label>Environment Variables</Label>
                    <Textarea placeholder="KEY=VALUE" className="font-mono text-xs" />
                </div>
            </TabsContent>

            <TabsContent value="json" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>MCP Configuration JSON</Label>
                    <Textarea 
                        className="font-mono text-xs h-[300px]" 
                        placeholder='{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Desktop"]
    }
  }
}' 
                    />
                </div>
            </TabsContent>
        </Tabs>

        <SheetFooter>
            <Button type="submit" className="w-full">Save Server</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
