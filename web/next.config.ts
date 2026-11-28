import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// `neon env pull` writes DATABASE_URL into the repo root's .env.local (or .env).
// Read those as well as web/'s own, so `npm run dev` here talks to Neon without
// copying secrets around. Variables already set (shell, web/.env*) take precedence.
for (const name of [".env.local", ".env"]) {
  const file = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// The repo root has its own package.json (the Neon CLI's config); this app is web/.
const appRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: appRoot,
  turbopack: { root: appRoot },
  // postgres.js opens raw sockets; keep it out of the bundler on Node, OpenNext
  // bundles it for Workers (cloudflare:sockets via nodejs_compat).
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
