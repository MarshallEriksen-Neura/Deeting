"use client";

import { useUpdateChecker } from "@/hooks/use-update-checker";
import { UpdateDialog } from "./update-dialog";

export function DesktopUpdateGuard() {
  const { updateAvailable, updateInfo, downloading, progress, installUpdate, dismiss } =
    useUpdateChecker();

  if (!updateAvailable || !updateInfo) return null;

  return (
    <UpdateDialog
      open={updateAvailable}
      version={updateInfo.version}
      body={updateInfo.body}
      downloading={downloading}
      progress={progress}
      onInstall={installUpdate}
      onDismiss={dismiss}
    />
  );
}
