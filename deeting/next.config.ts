import type { NextConfig } from "next";
import nextIntlPlugin from "next-intl/plugin";
import { createMDX } from "fumadocs-mdx/next";

const withNextIntl = nextIntlPlugin("./i18n/request.ts");
const withMDX = createMDX({
  configPath: "./source.config.ts",
  outDir: ".source",
});

const nextConfig: NextConfig = {
  output: process.env.DEETING_DESKTOP_EXPORT === "true" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
};

export default withMDX(withNextIntl(nextConfig));
