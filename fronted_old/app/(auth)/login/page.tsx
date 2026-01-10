"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/stores/auth-store";

export default function LoginPage() {
    const openAuthDialog = useAuthStore((state) => state.openAuthDialog);
    const isAuthDialogOpen = useAuthStore((state) => state.isAuthDialogOpen);

    // 页面加载时自动打开登录对话框
    useEffect(() => {
        if (!isAuthDialogOpen) {
            openAuthDialog();
        }
    }, [openAuthDialog, isAuthDialogOpen]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            {/* AuthDialog 由全局 layout.tsx 渲染，这里只需要触发打开 */}
        </div>
    );
}
