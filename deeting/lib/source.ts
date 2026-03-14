import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";
import { docsI18n } from "./docs/i18n";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  i18n: docsI18n,
});
