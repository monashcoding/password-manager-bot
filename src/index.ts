import 'dotenv/config';
import { DiscordClient } from './bot/client';
import { logger } from './utils/logger';
import { config } from './utils/config';

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Main application class
 */
class PasswordManagerBot {
  private discordClient: DiscordClient;
  private isShuttingDown: boolean = false;

  constructor() {
    this.discordClient = new DiscordClient();
    this.setupGracefulShutdown();
  }

  /**
   * Start the bot
   */
  public async start(): Promise<void> {
    try {
      logger.info('🚀 Starting Password Manager Discord Bot...');
      logger.info('===============================================');
      
      // Log configuration (without sensitive data)
      this.logConfiguration();
      
      // Register slash commands with Discord
      await this.discordClient.registerCommands();
      
      // Login to Discord
      await this.discordClient.login();
      
      logger.info('===============================================');
      logger.info('✅ Password Manager Bot started successfully!');
      logger.info('🔐 Ready to handle vault access requests');
      
    } catch (error) {
      logger.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  /**
   * Log current configuration (without sensitive values)
   */
  private logConfiguration(): void {
    logger.info('📋 Bot Configuration:');
    logger.info(`   Discord Client ID: ${config.discord.clientId}`);
    logger.info(`   Notion Database ID: ${config.notion.databaseId}`);
    logger.info(`   Vaultwarden URL: ${config.bitwarden.baseUrl}`);
    logger.info(`   Environment: ${config.nodeEnv}`);
    logger.info(`   Node Version: ${process.version}`);
    logger.info(`   Platform: ${process.platform}`);
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach((signal) => {
      process.on(signal, async () => {
        if (this.isShuttingDown) {
          logger.warn(`⚠️  Received ${signal} again, forcing shutdown...`);
          process.exit(1);
        }
        
        this.isShuttingDown = true;
        logger.info(`📡 Received ${signal}, starting graceful shutdown...`);
        
        await this.shutdown();
      });
    });
  }

  /**
   * Gracefully shutdown the bot
   */
  public async shutdown(): Promise<void> {
    try {
      logger.info('🛑 Shutting down Password Manager Bot...');
      
      // Shutdown Discord client
      await this.discordClient.shutdown();
      
      // Give some time for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      logger.info('✅ Password Manager Bot shut down successfully');
      process.exit(0);
      
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get bot health status
   */
  public getHealthStatus(): {
    status: 'healthy' | 'unhealthy';
    uptime: number;
    memory: NodeJS.MemoryUsage;
    discord: any;
  } {
    const stats = this.discordClient.getStats();
    
    return {
      status: stats.ready ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      discord: stats
    };
  }
}

/**
 * Health check endpoint (for monitoring)
 */
function setupHealthCheck(bot: PasswordManagerBot): void {
  // Simple HTTP health check server (optional)
  const http = require('http');
  
  const server = http.createServer((req: any, res: any) => {
    if (req.url === '/health') {
      const health = bot.getHealthStatus();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  
  const port = process.env.HEALTH_CHECK_PORT || 3000;
  server.listen(port, () => {
    logger.info(`🏥 Health check server listening on port ${port}`);
    logger.info(`   Health endpoint: http://localhost:${port}/health`);
  });
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    logger.info('🎬 Initializing Password Manager Discord Bot');
    logger.info(`📅 Started at: ${new Date().toISOString()}`);
    
    // Create bot instance
    const bot = new PasswordManagerBot();
    
    // Setup health check (optional, useful for production monitoring)
    if (config.nodeEnv === 'production') {
      setupHealthCheck(bot);
    }
    
    // Start the bot
    await bot.start();
    
  } catch (error) {
    logger.error('💥 Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Export bot class for testing
export { PasswordManagerBot };

// Start the bot if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('💥 Unhandled error in main:', error);
    process.exit(1);
  });
}