"use client"

import * as React from "react"
import { Calendar, MapPin, ExternalLink, Camera } from "lucide-react"
import { useTranslations } from "next-intl"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useUserProfile } from "@/hooks/use-user"
import { ImageCropDialog, CropResult } from "@/components/chat/input"
import { initAssetUpload, completeAssetUpload } from "@/lib/api/media-assets"
import { calculateFileHash } from "@/lib/utils/file"
import { toast } from "sonner"

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-CA") // YYYY-MM-DD format
}

function formatUid(id: string): string {
  const short = id.replace(/-/g, "").slice(0, 8).toUpperCase()
  return `${short.slice(0, 4)}-${short.slice(4, 6)}-${short.slice(6, 8)}`
}

function getUserRole(isSuperuser: boolean, permissionFlags: Record<string, number>): string {
  if (isSuperuser) return "ADMIN"
  const hasProFeatures = Object.values(permissionFlags).some(v => v > 0)
  return hasProFeatures ? "PRO PILOT" : "PILOT"
}

export function UserProfileSidebar() {
  const t = useTranslations("profile")
  const { profile, isLoading, updateProfile } = useUserProfile()

  // Avatar crop dialog state
  const [cropDialogOpen, setCropDialogOpen] = React.useState(false)
  const [selectedImage, setSelectedImage] = React.useState<string>("")
  const [previewAvatar, setPreviewAvatar] = React.useState<string>("")
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Handle file selection
  const handleFileSelect = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith("image/")) {
      toast.error(t("idCard.invalidImageType"))
      return
    }
    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("idCard.imageTooLarge"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSelectedImage(reader.result as string)
      setCropDialogOpen(true)
    }
    reader.readAsDataURL(file)
    // Reset input so same file can be selected again
    e.target.value = ""
  }, [t])

  // Handle crop complete and upload
  const handleCropComplete = React.useCallback(async (result: CropResult) => {
    setPreviewAvatar(result.base64)
    setIsUploading(true)
    
    try {
      // Convert base64 to blob
      const response = await fetch(result.base64)
      const blob = await response.blob()
      const file = new File([blob], "avatar.png", { type: "image/png" })
      
      // Calculate file hash
      const contentHash = await calculateFileHash(file)
      
      // Step 1: Initialize upload with public bucket
      const initResult = await initAssetUpload({
        content_hash: contentHash,
        size_bytes: file.size,
        content_type: file.type,
        kind: "avatar",
      }, "public")
      
      // Step 2: Upload to OSS if not deduped
      if (!initResult.deduped && initResult.upload_url) {
        const uploadResponse = await fetch(initResult.upload_url, {
          method: "PUT",
          body: file,
          headers: initResult.upload_headers || { "Content-Type": file.type },
        })
        if (!uploadResponse.ok) {
          throw new Error("Upload failed")
        }
      }
      
      // Step 3: Complete upload
      const completeResult = await completeAssetUpload({
        object_key: initResult.object_key,
        content_hash: contentHash,
        size_bytes: file.size,
        content_type: file.type,
      }, "public")
      
      // Step 4: Update user profile with new avatar object_key
      await updateProfile({
        avatar_object_key: completeResult.object_key,
        avatar_storage_type: "public",
      })
      
      toast.success(t("idCard.avatarUpdated"))
    } catch (error) {
      console.error("Avatar upload failed:", error)
      toast.error(t("idCard.avatarUploadFailed"))
    } finally {
      setIsUploading(false)
    }
  }, [updateProfile, t])

  // Trigger file input
  const handleUploadClick = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  if (isLoading) {
    return (
      <aside className="w-full lg:w-1/3 lg:sticky lg:top-8">
        <Skeleton className="h-96 w-full rounded-3xl" />
      </aside>
    )
  }

  if (!profile) {
    return null
  }

  const user = {
    name: profile.username ?? profile.email.split("@")[0],
    uid: formatUid(profile.id),
    role: getUserRole(profile.is_superuser, profile.permission_flags),
    status: profile.is_active ? "ONLINE" : "OFFLINE",
    registeredAt: formatDate(profile.created_at),
    region: "—",
    avatar: profile.avatar_url ?? "",
  }

  return (
    <aside className="w-full lg:w-1/3 lg:sticky lg:top-8">
      <div className="relative group">
        {/* Ambient Background Glow */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-teal-accent rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
        
        <GlassCard 
          className="relative overflow-hidden border-white/20 dark:border-white/10"
          padding="none"
          hover="glow"
        >
          {/* Dynamic Background Effect */}
          <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-primary/10 to-transparent opacity-50" />
          
          <div className="pt-12 pb-8 flex flex-col items-center text-center relative z-10 px-6">

            {/* Avatar Container with AI Glow */}
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse-slow"></div>
              <Avatar className="w-32 h-32 border-4 border-background shadow-2xl relative z-10">
                <AvatarImage src={previewAvatar || user.avatar} />
                <AvatarFallback>{user.name.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>

              {/* Upload Avatar Trigger */}
              <button
                onClick={handleUploadClick}
                disabled={isUploading}
                className="absolute bottom-0 left-0 bg-muted text-muted-foreground p-2.5 rounded-full hover:scale-110 hover:bg-muted/80 transition-all shadow-lg z-20 group/upload disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("idCard.uploadAvatar")}
              >
                {isUploading ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={16} className="group-hover/upload:scale-110 transition-transform" />
                )}
              </button>

              {/* TODO: AI Generation Trigger - uncomment when AI avatar generation is implemented */}
              {/* <button
                className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2.5 rounded-full hover:scale-110 transition-all shadow-lg z-20 group/ai"
                title={t("idCard.regenerateAvatar")}
              >
                <Sparkles size={16} className="group-hover/ai:rotate-12 transition-transform" />
              </button> */}
            </div>

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">{user.name}</h2>
              <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">{t("idCard.uid")}: {user.uid}</p>
            </div>
            
            <div className="mt-6 flex gap-2 justify-center">
               <Badge variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1">
                  {user.role}
               </Badge>
               <Badge variant="outline" className="border-teal-accent text-teal-accent bg-teal-accent/5 px-3 py-1">
                  {user.status}
               </Badge>
            </div>

            <Separator className="my-8 opacity-20" />

            <div className="w-full space-y-4">
               <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar size={14} />
                    <span>{t("idCard.registered")}</span>
                  </div>
                  <span className="font-mono font-medium">{user.registeredAt}</span>
               </div>
               <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin size={14} />
                    <span>{t("idCard.region")}</span>
                  </div>
                  <span className="font-medium">{user.region}</span>
               </div>
            </div>

            <GlassButton className="w-full mt-8 group" variant="outline">
              <span>{t("idCard.viewPublic")}</span>
              <ExternalLink size={14} className="ml-2 opacity-50 group-hover:opacity-100 transition-opacity" />
            </GlassButton>
          </div>
          
          {/* Card Footer Decoration */}
          <div className="h-1.5 w-full bg-gradient-to-r from-primary via-teal-accent to-primary opacity-50" />
        </GlassCard>
      </div>

      {/* Image Crop Dialog */}
      <ImageCropDialog
        open={cropDialogOpen}
        onOpenChange={setCropDialogOpen}
        imageSrc={selectedImage}
        aspectRatio={1}
        title={t("idCard.cropAvatar")}
        onCropComplete={handleCropComplete}
      />
    </aside>
  )
}
