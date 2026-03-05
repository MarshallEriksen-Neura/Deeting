"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface CloseConfirmDialogProps {
  open: boolean;
  onChoose: (action: "minimize" | "quit", remember: boolean) => void;
}

export function CloseConfirmDialog({ open, onChoose }: CloseConfirmDialogProps) {
  const [remember, setRemember] = useState(false);
  const t = useTranslations("common.desktopClose");

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2 py-2">
          <Checkbox
            id="remember-close"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          <label htmlFor="remember-close" className="text-sm cursor-pointer">
            {t("remember")}
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onChoose("minimize", remember)}>{t("minimize")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onChoose("quit", remember)}>
            {t("quit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
