import type { IModelService } from "../../core/types";

export const desktopModelService: IModelService = {
  connect: async (id) => {
    console.log("Desktop: Connecting provider", id);
  },
  getList: async () => {
    return [];
  },
};
