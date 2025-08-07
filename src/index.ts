import 'dotenv/config';
import { client } from './bot/client';
import { setupScheduledJobs } from './services/scheduler';
import { logger } from './utils/logger';

async function main() {
  try {
    // Start Discord bot
    await client.login(process.env.DISCORD_TOKEN);
    logger.info('Discord bot logged in successfully');

    // Setup scheduled jobs for GitHub Actions
    setupScheduledJobs();
    logger.info('Scheduled jobs initialized');

  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

main();