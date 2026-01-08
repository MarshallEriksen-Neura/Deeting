"use client";

import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

export type ClearHistoryActionProps = {
  disabled?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  title: string;
  confirmText: string;
  cancelText: string;
  tooltip: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ClearHistoryAction({
  disabled = false,
  isBusy = false,
  onConfirm,
  title,
  confirmText,
  cancelText,
  tooltip,
  description,
  open,
  onOpenChange,
}: ClearHistoryActionProps) {
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => onOpenChange(true)}
        disabled={disabled || isBusy}
        aria-label={tooltip}
        title={tooltip}
      >
        {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{cancelText}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={isBusy}>
              {confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
