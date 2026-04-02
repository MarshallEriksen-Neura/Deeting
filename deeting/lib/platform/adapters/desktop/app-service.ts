import type { IAppService } from "../../core/types";

export const desktopAppService: IAppService = {
  quit: async () => {
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch (err) {
      console.error("Desktop: quit failed", err);
    }
  },
  openExternal: async (url) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  },
  minimize: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Hide main window and show Island capsule
      await invoke("hide_main_show_island");
    } catch (err) {
      console.error("Desktop: hide-to-island failed", err);
      // Fallback: plain hide to tray
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
      } catch {
        // ignore
      }
    }
  },
  notify: async (title: string, body: string) => {
    try {
      const {
        isPermissionGranted,
        requestPermission,
        sendNotification,
      } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      if (granted) {
        sendNotification({ title, body });
      }
    } catch (err) {
      console.error("Desktop: notify failed", err);
    }
  },
};
