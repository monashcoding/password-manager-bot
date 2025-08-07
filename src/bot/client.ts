import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { requestVaultCommand } from './commands/request-vault';

// Extend the Client type to include our commands collection
declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, any>;
  }
}

// Create the Discord client
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

// Initialize commands collection
client.commands = new Collection();

// Register commands
client.commands.set(requestVaultCommand.data.name, requestVaultCommand);

// Event handlers
client.once('ready', async (readyClient) => {
  logger.info(`Bot is ready! Logged in as ${readyClient.user.tag}`);
  
  try {
    // Register slash commands globally
    const commands = client.commands.map(command => command.data.toJSON());
    await client.application?.commands.set(commands);
    logger.info(`Successfully registered ${commands.length} application commands`);
  } catch (error) {
    logger.error('Failed to register commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`No command matching ${interaction.commandName} was found`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    
    const errorMessage = 'There was an error while executing this command!';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

client.on('error', (error) => {
  logger.error('Discord client error:', error);
});