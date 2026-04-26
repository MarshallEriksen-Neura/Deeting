import type { NextConfig } from "next";
import nextIntlPlugin from "next-intl/plugin";
import { createMDX } from "fumadocs-mdx/next";

const withNextIntl = nextIntlPlugin("./i18n/request.ts");
const withMDX = createMDX({
  configPath: "./source.config.ts",
  outDir: ".source",
});
const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"

const nextConfig: NextConfig = {
  output: isDesktopExport ? "export" : undefined,
  trailingSlash: isDesktopExport ? true : undefined,
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "react-icons",
      "@iconify/react",
      "date-fns",
    ],
  },
};

const withProjectPlugins = isDesktopExport ? withNextIntl : (config: NextConfig) => withMDX(withNextIntl(config))

export default withProjectPlugins(nextConfig);
