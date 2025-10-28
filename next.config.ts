import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Improve output file tracing root to avoid monorepo detection issues
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
