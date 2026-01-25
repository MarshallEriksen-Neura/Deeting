"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { WaterfallGallery } from "@/components/image/waterfall-gallery"

interface GalleryPageClientProps {
  title: React.ReactNode
  description: React.ReactNode
  searchPlaceholder: string
}

export function GalleryPageClient({ title, description, searchPlaceholder }: GalleryPageClientProps) {
  const [searchQuery, setSearchQuery] = React.useState("")

  return (
    <div className="min-h-screen bg-muted/20 p-8 space-y-8 animate-in fade-in duration-700">
      
      {/* Hero Section */}
      <div className="text-center space-y-4 max-w-2xl mx-auto py-10 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[150%] bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 blur-3xl -z-10 opacity-50 rounded-full pointer-events-none" />
        
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <div className="text-muted-foreground text-lg">
          {description}
        </div>

        <div className="relative group max-w-lg mx-auto mt-8">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-1000"></div>
          <div className="relative flex items-center bg-background rounded-xl shadow-xl border border-border/50">
             <Search className="ml-4 text-muted-foreground" />
             <Input 
               className="border-none shadow-none focus-visible:ring-0 text-lg py-6 bg-transparent" 
               placeholder={searchPlaceholder}
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
             />
          </div>
        </div>
      </div>
      
      {/* Gallery Grid */}
      <WaterfallGallery searchQuery={searchQuery} className="pb-20" />
    </div>
  )
}
