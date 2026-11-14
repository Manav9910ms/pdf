import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:/ }));
    return config;
  },
};

export default nextConfig;
