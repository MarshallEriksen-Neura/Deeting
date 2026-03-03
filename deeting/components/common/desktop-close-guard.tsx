"use client";

import { useCloseHandler } from "@/hooks/use-close-handler";
import { CloseConfirmDialog } from "./close-confirm-dialog";

export function DesktopCloseGuard() {
  const { showDialog, handleChoose } = useCloseHandler();
  return <CloseConfirmDialog open={showDialog} onChoose={handleChoose} />;
}
