export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN!,
    clientId: process.env.DISCORD_CLIENT_ID!,
  },
  notion: {
    token: process.env.NOTION_TOKEN!,
    databaseId: process.env.NOTION_DATABASE_ID!,
  },
  bitwarden: {
    clientId: process.env.BITWARDEN_CLIENT_ID!,
    clientSecret: process.env.BITWARDEN_CLIENT_SECRET!,
    orgId: process.env.BITWARDEN_ORG_ID!,
    baseUrl: process.env.BITWARDEN_BASE_URL || 'https://vault.monashcoding.com',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Validate required environment variables
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID', 
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
  'BITWARDEN_CLIENT_ID',
  'BITWARDEN_CLIENT_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}