import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember } from 'discord.js';
import { getUserByEmail, confirmUserMembership } from '../../services/bitwarden';
import { logger } from '../../utils/logger';

function isGuildMember(member: any): member is GuildMember {
  return member && typeof member === 'object' && 'displayName' in member;
}

export const data = new SlashCommandBuilder()
  .setName('confirm')
  .setDescription('Confirm user access to password manager')
  .addSubcommand(subcommand =>
    subcommand
      .setName('vault')
      .setDescription('Confirm user access to password manager')
      .addStringOption(option =>
        option
          .setName('email')
          .setDescription('Email address to confirm')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() !== 'vault') return;
  
  const email = interaction.options.getString('email', true);
  const adminUsername = interaction.user.username;
  
  // Safely get display name with type checking
  const adminDisplayName = (() => {
    if (isGuildMember(interaction.member)) {
      return interaction.member.displayName;
    }
    return interaction.user.displayName || interaction.user.globalName || adminUsername;
  })();

  logger.info(`Membership confirmation requested by ${adminUsername} (${adminDisplayName}) for email: ${email}`);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('Invalid Email')
      .setDescription('Please provide a valid email address.')
      .setColor(0xFF0000)
      .setTimestamp();

    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    return;
  }

  // Defer reply as this might take a while
  await interaction.deferReply({ ephemeral: true });

  try {
    const user = await getUserByEmail(email);
    
    if (!user) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('User Not Found')
        .setDescription(`No user found with email "${email}". Use /invite vault [email] first.`)
        .setColor(0xFF6B35)
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed] });
      return;
    }

    if (user.status === 2) {
      const alreadyConfirmedEmbed = new EmbedBuilder()
        .setTitle('Already Confirmed')
        .setDescription(`${user.name} is already confirmed and can access the vault.`)
        .setColor(0x00B894)
        .setTimestamp();

      await interaction.editReply({ embeds: [alreadyConfirmedEmbed] });
      return;
    }


    const confirmResult = await confirmUserMembership(user.id, user.userId);

    if (confirmResult.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('User Confirmed')
        .setDescription(`${user.name} can now access the vault at [vault.monashcoding.com](https://vault.monashcoding.com).`)
        .setColor(0x00B894)
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
      logger.info(`Successfully confirmed membership for ${email} (${user.name}) by admin ${adminUsername}`);

    } else {
      let errorTitle = 'Confirmation Failed';
      let errorDescription = 'Something went wrong. Contact the projects team for help.';

      if (confirmResult.error?.includes('already confirmed') || confirmResult.error?.includes('404')) {
        errorTitle = 'Already Confirmed';
        errorDescription = 'User might already be confirmed. Contact the projects team for help.';
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle(errorTitle)
        .setDescription(errorDescription)
        .setColor(0xFF0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
      logger.error(`Failed to confirm membership for ${email}: ${confirmResult.error}`);
    }

  } catch (error) {
    logger.error('Error in confirm membership command:', error);

    const crashEmbed = new EmbedBuilder()
      .setTitle('Something Went Wrong')
      .setDescription('An unexpected error occurred. Contact the projects team for help.')
      .setColor(0xFF0000)
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [crashEmbed] });
    } catch (replyError) {
      logger.error('Failed to send error message to admin:', replyError);
    }
  }
}

function getStatusText(status: number): string {
  switch (status) {
    case 0: return 'Invited';
    case 1: return 'Accepted';
    case 2: return 'Confirmed';
    case -1: return 'Revoked';
    default: return 'Unknown';
  }
}
