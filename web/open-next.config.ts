// OpenNext adapter config for Cloudflare Workers. Every page and API route is
// dynamic (live warehouse reads), so no incremental cache is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
