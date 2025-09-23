import 'dotenv/config';
import { DiscordClient } from './bot/client';
import { logger } from './utils/logger';

class PasswordManagerBot {
  private discordClient: DiscordClient;

  constructor() {
    this.discordClient = new DiscordClient();
  }

  public async start(): Promise<void> {
    try {
      logger.info('Starting Password Manager Discord Bot...');
      
      await this.discordClient.registerCommands();
      await this.discordClient.login();
      
      logger.info('Password Manager Bot started successfully');
      
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  try {
    logger.info('Initializing Password Manager Discord Bot');
    const bot = new PasswordManagerBot();
    await bot.start();
  } catch (error) {
    logger.error('Failed to initialize bot:', error);
    process.exit(1);
  }
}

export { PasswordManagerBot };

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}