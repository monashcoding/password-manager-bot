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
    userClientId: process.env.USER_CLIENT_ID!,
    userClientSecret: process.env.USER_CLIENT_SECRET!,
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
  'USER_CLIENT_ID',
  'USER_CLIENT_SECRET',
  'BITWARDEN_ORG_ID'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}