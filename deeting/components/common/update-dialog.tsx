"use client";

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
import { Progress } from "@/components/ui/progress";

interface UpdateDialogProps {
  open: boolean;
  version: string;
  body: string;
  downloading: boolean;
  progress: number;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateDialog({
  open,
  version,
  body,
  downloading,
  progress,
  onInstall,
  onDismiss,
}: UpdateDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update Available — v{version}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>A new version of Deeting is available.</p>
              {body && (
                <div className="max-h-40 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                  {body}
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {downloading && (
          <div className="py-2 space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {progress}% downloaded
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss} disabled={downloading}>
            Later
          </AlertDialogCancel>
          <AlertDialogAction onClick={onInstall} disabled={downloading}>
            {downloading ? "Installing…" : "Update Now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
