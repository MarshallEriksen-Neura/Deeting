"use client";

import { useState } from "react";
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

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close Window</AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to minimize Deeting to the system tray or quit the application?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2 py-2">
          <Checkbox
            id="remember-close"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          <label htmlFor="remember-close" className="text-sm cursor-pointer">
            Remember my choice
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onChoose("minimize", remember)}>
            Minimize to Tray
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => onChoose("quit", remember)}>
            Quit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
