"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/stores/auth-store";
import { userService } from "@/http/user";
import { ErrorHandler } from "@/lib/errors";

interface AvatarUploadProps {
  isEditing: boolean;
}

export function AvatarUpload({ isEditing }: AvatarUploadProps) {
  const { t } = useI18n();
  const authUser = useAuthStore((state) => state.user);
  const setAuthUser = useAuthStore((state) => state.setUser);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleAvatarButtonClick = () => {
    if (!isEditing) return;
    fileInputRef.current?.click();
  };

  const handleAvatarFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!authUser) return;

    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith("image/")) {
      toast.error(t("profile.invalid_image_type"));
      return;
    }

    // 验证文件大小（最大 5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(t("profile.image_too_large"));
      return;
    }

    // 创建预览
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    setIsUploadingAvatar(true);
    try {
      const updated = await userService.uploadAvatar(file);
      setAuthUser(updated);
      toast.success(t("profile.update_avatar_success"));
    } catch (error) {
      const normalized = ErrorHandler.normalize(error);
      const message = ErrorHandler.getUserMessage(normalized, t);
      toast.error(message);
      setPreviewUrl(null);
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = "";
    }
  };

  if (!authUser) return null;

  const avatarSrc = previewUrl || authUser.avatar;

  return (
    <div className="flex items-center space-x-4">
      <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center overflow-hidden relative">
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt={authUser.display_name || authUser.email}
            className="h-full w-full object-cover"
          />
        ) : (
          <User className="w-10 h-10 text-foreground" />
        )}
      </div>
      {isEditing && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAvatarButtonClick}
            disabled={isUploadingAvatar}
          >
            {isUploadingAvatar
              ? t("profile.uploading_avatar")
              : t("profile.change_avatar")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarFileChange}
          />
        </>
      )}
    </div>
  );
}
