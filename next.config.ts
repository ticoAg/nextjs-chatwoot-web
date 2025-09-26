import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose required envs to the client runtime
  env: {
    NEXT_PUBLIC_CHATWOOT_BASE_URL: process.env.base_url,
    NEXT_PUBLIC_CHATWOOT_INBOX_IDENTIFIER: process.env.inbox_identifier,
    NEXT_PUBLIC_CHATWOOT_USER_IDENTIFIER: process.env.user_identifier,
  },
};

export default nextConfig;
