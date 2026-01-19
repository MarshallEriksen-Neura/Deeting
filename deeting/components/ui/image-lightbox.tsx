"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogTrigger, VisuallyHidden, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ZoomIn } from "lucide-react"

interface ImageLightboxProps {
  src: string
  alt?: string
  className?: string
  children?: React.ReactNode
}

export function ImageLightbox({ src, alt, className, children }: ImageLightboxProps) {
  if (!src) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children || (
          <div className={cn("relative cursor-zoom-in group overflow-hidden rounded-lg", className)}>
            <img
              src={src}
              alt={alt || "Image"}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 drop-shadow-md" />
            </div>
          </div>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[98vw] md:max-w-[90vw] max-h-[98vh] p-0 border-none bg-transparent shadow-none flex items-center justify-center z-[100]">
        <VisuallyHidden>
            <DialogTitle>{alt || "Image Preview"}</DialogTitle>
        </VisuallyHidden>
        <div className="relative w-full h-full flex items-center justify-center p-4 md:p-8">
           <img
             src={src}
             alt={alt || "Image Preview"}
             className="max-w-full max-h-[90vh] object-contain rounded-md shadow-2xl select-none"
             onClick={(e) => e.stopPropagation()}
           />
        </div>
      </DialogContent>
    </Dialog>
  )
}
