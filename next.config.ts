import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "node:fs/promises": false,
      "node:module": false,
    };
    return config;
  },
};

export default nextConfig;
