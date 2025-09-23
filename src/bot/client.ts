import { Client, Collection, GatewayIntentBits, Events, REST, Routes, TextChannel, NewsChannel, ThreadChannel, DMChannel, EmbedBuilder } from 'discord.js';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { createErrorDescription, createErrorTitle } from '../utils/errors';

// Import command modules
import * as inviteCommand from './commands/vault-invite';
import * as confirmCommand from './commands/vault-confirm';

export interface Command {
  data: any;
  execute: (interaction: any) => Promise<void>;
}

export class DiscordClient {
  public client: Client;
  public commands: Collection<string, Command>;
  private isReady: boolean = false;

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });

    this.commands = new Collection();
    this.setupEventHandlers();
    this.loadCommands();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Discord bot logged in as ${readyClient.user.tag}`);
      logger.info(`Bot is in ${readyClient.guilds.cache.size} server(s)`);
      this.isReady = true;
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Unknown command: ${interaction.commandName}`);
        return;
      }

      try {
        logger.info(`Executing command: ${interaction.commandName} by ${interaction.user.username}`);
        await command.execute(interaction);
      } catch (error) {
        logger.error(`Error executing command ${interaction.commandName}:`, error);
        
        const errorTitle = createErrorTitle(error);
        const errorDescription = createErrorDescription(error);

        const errorEmbed = new EmbedBuilder()
          .setTitle(errorTitle)
          .setDescription(errorDescription)
          .setColor(0xFF0000)
          .setTimestamp();
        
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
          } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
          }
        } catch (replyError) {
          logger.error('Failed to send error message to user:', replyError);
          // Fallback to simple text message if embed fails
          try {
            const fallbackMessage = `Error: ${errorDescription}`;
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: fallbackMessage, ephemeral: true });
            } else {
              await interaction.reply({ content: fallbackMessage, ephemeral: true });
            }
          } catch (finalError) {
            logger.error('Failed to send fallback error message:', finalError);
          }
        }
      }
    });

    this.client.on(Events.Error, (error) => {
      logger.error('Discord client error:', error);
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn('Discord client warning:', warning);
    });

    this.client.on(Events.GuildCreate, (guild) => {
      logger.info(`Bot joined server: ${guild.name} (${guild.id})`);
    });

    this.client.on(Events.GuildDelete, (guild) => {
      logger.info(`Bot left server: ${guild.name} (${guild.id})`);
    });
  }

  private loadCommands(): void {
    logger.info('Loading Discord slash commands...');

    this.commands.set(inviteCommand.data.name, inviteCommand);
    this.commands.set(confirmCommand.data.name, confirmCommand);

    logger.info(`Total commands loaded: ${this.commands.size}`);
  }

  public async registerCommands(): Promise<void> {
    try {
      logger.info('Registering slash commands with Discord...');

      const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());
      const rest = new REST({ version: '10' }).setToken(config.discord.token);

      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commandsData }
      );

      logger.info(`Successfully registered ${commandsData.length} slash command(s)`);
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
      throw error;
    }
  }

  public async login(): Promise<void> {
    try {
      logger.info('Logging into Discord...');
      await this.client.login(config.discord.token);
    } catch (error) {
      logger.error('Failed to login to Discord:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Discord bot...');
    
    if (this.isReady) {
      await this.client.destroy();
      logger.info('Discord bot shut down successfully');
    }
  }
}