import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // postgres.js opens raw sockets; keep it out of the bundler on Node, OpenNext
  // bundles it for Workers (cloudflare:sockets via nodejs_compat).
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
