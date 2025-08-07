import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { lookupUserTeam } from '../../services/notion';
import { inviteUserToBitwarden } from '../../services/bitwarden';
import { logger } from '../../utils/logger';

export const requestVaultCommand = {
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Request access to team password vault')
    .addSubcommand(subcommand =>
      subcommand
        .setName('vault')
        .setDescription('Request vault access with your personal email')
        .addStringOption(option =>
          option
            .setName('personal_email')
            .setDescription('Your personal email address')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check if this is the vault subcommand
    if (interaction.options.getSubcommand() !== 'vault') {
      await interaction.reply({ 
        content: 'Invalid subcommand. Use `/request vault personal_email`', 
        ephemeral: true 
      });
      return;
    }

    const personalEmail = interaction.options.getString('personal_email', true);
    const discordUserId = interaction.user.id;
    const discordUsername = interaction.user.username;

    logger.info(`Vault request from ${discordUsername} (${discordUserId}) with email: ${personalEmail}`);

    // Defer reply since this might take a while
    await interaction.deferReply({ ephemeral: true });

    try {
      // Step 1: Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(personalEmail)) {
        await interaction.editReply({
          content: '❌ Please provide a valid email address.'
        });
        return;
      }

      // Step 2: Look up user in Notion directory
      logger.info(`Looking up team for email: ${personalEmail}`);
      const userInfo = await lookupUserTeam(personalEmail);
      
      if (!userInfo) {
        await interaction.editReply({
          content: `❌ Email \`${personalEmail}\` not found in the team directory. Please make sure you're using the email address registered with your team.`
        });
        return;
      }

      logger.info(`Found user: ${userInfo.name} in team: ${userInfo.team}`);

      // Step 3: Invite user to Bitwarden organization
      logger.info(`Inviting ${personalEmail} to Bitwarden organization`);
      const inviteResult = await inviteUserToBitwarden(personalEmail, userInfo);

      if (inviteResult.success) {
        await interaction.editReply({
          content: `✅ **Vault access requested successfully!**\n\n` +
                   `📧 **Email**: ${personalEmail}\n` +
                   `👥 **Team**: ${userInfo.team}\n` +
                   `👤 **Name**: ${userInfo.name}\n\n` +
                   `You should receive an invitation email shortly. Check your inbox and follow the instructions to join the organization.`
        });
        
        logger.info(`Successfully invited ${personalEmail} to Bitwarden`);
      } else {
        await interaction.editReply({
          content: `⚠️ **Request processed but with issues:**\n\n` +
                   `📧 **Email**: ${personalEmail}\n` +
                   `👥 **Team**: ${userInfo.team}\n` +
                   `❌ **Issue**: ${inviteResult.error}\n\n` +
                   `Please contact an admin if you don't receive an invitation email.`
        });
        
        logger.warn(`Bitwarden invite had issues for ${personalEmail}: ${inviteResult.error}`);
      }

    } catch (error) {
      logger.error(`Error processing vault request for ${personalEmail}:`, error);
      
      await interaction.editReply({
        content: '❌ **An error occurred while processing your request.**\n\n' +
                 'Please try again later or contact an administrator if the problem persists.'
      });
    }
  }
};