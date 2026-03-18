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
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      // The desktop close flow uses "minimize" to mean "hide to tray".
      await getCurrentWindow().hide();
    } catch (err) {
      console.error("Desktop: hide-to-tray failed", err);
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
