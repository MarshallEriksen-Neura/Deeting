"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DesktopWindowCloseAction } from "@/lib/api/desktop-config";

interface CloseConfirmDialogProps {
  open: boolean;
  onChoose: (action: DesktopWindowCloseAction, remember: boolean) => void;
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
        <AlertDialogFooter className="sm:grid sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onChoose("show_island", remember)}
          >
            {t("showIsland")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChoose("minimize", remember)}
          >
            {t("minimize")}
          </Button>
          <Button type="button" onClick={() => onChoose("quit", remember)}>
            {t("quit")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
