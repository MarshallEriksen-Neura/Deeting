import type { NextConfig } from "next";
import nextIntlPlugin from "next-intl/plugin";

const withNextIntl = nextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
