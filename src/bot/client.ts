import { Client, Collection, GatewayIntentBits, Events, REST, Routes, TextChannel, NewsChannel, ThreadChannel, DMChannel } from 'discord.js';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { testVaultwardenAdminConnection } from '../services/bitwarden';
import { startScheduledJobs } from '../services/scheduler';

// Import command modules
import * as requestVaultCommand from './commands/request-vault';

export interface Command {
  data: any;
  execute: (interaction: any) => Promise<void>;
}

export class DiscordClient {
  public client: Client;
  public commands: Collection<string, Command>;
  private isReady: boolean = false;

  constructor() {
    // Initialize Discord client with necessary intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        // Removed MessageContent and GuildMembers as they require special permissions
        // GatewayIntentBits.GuildMessages,
        // GatewayIntentBits.MessageContent,
        // GatewayIntentBits.GuildMembers
      ]
    });

    // Initialize commands collection
    this.commands = new Collection();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    // Load commands
    this.loadCommands();
  }

  /**
   * Setup Discord client event handlers
   */
  private setupEventHandlers(): void {
    // Bot ready event
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`✅ Discord bot logged in as ${readyClient.user.tag}`);
      logger.info(`🤖 Bot is in ${readyClient.guilds.cache.size} server(s)`);
      
      // Test Vaultwarden connection on startup
      await this.testConnections();
      
      // Start scheduled jobs
      this.startScheduledServices();
      
      this.isReady = true;
      logger.info('🚀 Discord bot is fully operational!');
    });

    // Interaction (slash commands) handler
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`❌ Unknown command: ${interaction.commandName}`);
        return;
      }

      try {
        logger.info(`🎯 Executing command: ${interaction.commandName} by ${interaction.user.username}`);
        await command.execute(interaction);
        logger.info(`✅ Command completed: ${interaction.commandName}`);
      } catch (error) {
        logger.error(`❌ Error executing command ${interaction.commandName}:`, error);
        
        const errorMessage = 'There was an error while executing this command!';
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      logger.error('Discord client error:', error);
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn('Discord client warning:', warning);
    });

    // Guild join/leave events for monitoring
    this.client.on(Events.GuildCreate, (guild) => {
      logger.info(`📥 Bot joined new server: ${guild.name} (${guild.id})`);
      logger.info(`👥 Server has ${guild.memberCount} members`);
    });

    this.client.on(Events.GuildDelete, (guild) => {
      logger.info(`📤 Bot left server: ${guild.name} (${guild.id})`);
    });
  }

  /**
   * Load all slash commands
   */
  private loadCommands(): void {
    logger.info('📚 Loading Discord slash commands...');

    // Add the request-vault command
    this.commands.set(requestVaultCommand.data.name, requestVaultCommand);
    logger.info(`✅ Loaded command: ${requestVaultCommand.data.name}`);

    // Add more commands here as needed
    // this.commands.set(anotherCommand.data.name, anotherCommand);

    logger.info(`📝 Total commands loaded: ${this.commands.size}`);
  }

  /**
   * Register slash commands with Discord
   */
  public async registerCommands(): Promise<void> {
    try {
      logger.info('🔄 Registering slash commands with Discord...');

      const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());

      const rest = new REST({ version: '10' }).setToken(config.discord.token);

      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandsData }
      );

      logger.info(`✅ Successfully registered ${commandsData.length} slash command(s)`);
    } catch (error) {
      logger.error('❌ Failed to register slash commands:', error);
      throw error;
    }
  }

  /**
   * Test connections to external services
   */
  private async testConnections(): Promise<void> {
    logger.info('🔍 Testing external service connections...');

    // Test Vaultwarden Admin API
    try {
      const vaultwardenStatus = await testVaultwardenAdminConnection();
      if (vaultwardenStatus) {
        logger.info('✅ Vaultwarden Admin API connection successful');
      } else {
        logger.error('❌ Vaultwarden Admin API connection failed');
      }
    } catch (error) {
      logger.error('❌ Error testing Vaultwarden connection:', error);
    }

    // Test Notion API (you can add this if you have a test function)
    // try {
    //   await testNotionConnection();
    //   logger.info('✅ Notion API connection successful');
    // } catch (error) {
    //   logger.error('❌ Notion API connection failed:', error);
    // }
  }

  /**
   * Start scheduled services and background jobs
   */
  private startScheduledServices(): void {
    logger.info('⏰ Starting scheduled services...');
    
    try {
      // Start the scheduled jobs for Vaultwarden management
      startScheduledJobs();
      logger.info('✅ Scheduled jobs started successfully');
    } catch (error) {
      logger.error('❌ Failed to start scheduled jobs:', error);
    }
  }

  /**
   * Login to Discord
   */
  public async login(): Promise<void> {
    try {
      logger.info('🔐 Logging into Discord...');
      await this.client.login(config.discord.token);
    } catch (error) {
      logger.error('❌ Failed to login to Discord:', error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown the bot
   */
  public async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Discord bot...');
    
    if (this.isReady) {
      await this.client.destroy();
      logger.info('✅ Discord bot shut down successfully');
    }
  }

  /**
   * Get bot statistics
   */
  public getStats(): {
    guilds: number;
    users: number;
    uptime: number;
    ready: boolean;
  } {
    return {
      guilds: this.client.guilds.cache.size,
      users: this.client.users.cache.size,
      uptime: this.client.uptime || 0,
      ready: this.isReady
    };
  }

  /**
   * Send a message to a specific channel (for admin notifications)
   */
  public async sendAdminNotification(channelId: string, message: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      
      // Type guard to check if channel supports sending messages
      if (channel && this.isMessageableChannel(channel)) {
        await channel.send(message);
        logger.info(`📢 Admin notification sent to channel ${channelId}`);
      } else {
        logger.warn(`❌ Channel ${channelId} does not support sending messages`);
      }
    } catch (error) {
      logger.error(`❌ Failed to send admin notification to ${channelId}:`, error);
    }
  }

  /**
   * Type guard to check if a channel can receive messages
   */
  private isMessageableChannel(channel: any): channel is TextChannel | NewsChannel | ThreadChannel | DMChannel {
    return channel && typeof channel.send === 'function';
  }
}