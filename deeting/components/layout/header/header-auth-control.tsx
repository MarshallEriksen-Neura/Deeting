"use client";

import { Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/shadcn/button";
import { useAuthWorldModel } from "@/hooks/use-auth-world-model";
import { useAuthStore } from "@/store/auth-store";
import { UserMenu } from "./user-menu";

export function HeaderAuthControl() {
  const tHeader = useTranslations("common.header");
  const tAuth = useTranslations("auth.login.form");
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { canRenderLoggedOutAction, isLaunchingLogin, launchLogin } = useAuthWorldModel();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || !canRenderLoggedOutAction) {
    return <div aria-hidden className="h-8 w-24 shrink-0" />;
  }

  if (isAuthenticated) {
    return <UserMenu />;
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="min-w-24 rounded-full"
      disabled={isLaunchingLogin}
      onClick={() => {
        void launchLogin().catch((error) => {
          const message = error instanceof Error && error.message.trim()
            ? error.message
            : tAuth("toast.error");
          toast.error(message);
        });
      }}
    >
      {isLaunchingLogin ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogIn className="size-4" />
      )}
      {tHeader("login")}
    </Button>
  );
}
