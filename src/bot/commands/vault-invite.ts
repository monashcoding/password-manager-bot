import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember } from 'discord.js';
import { lookupUserTeam, UserInfo } from '../../services/notion';
import { inviteUserToVaultwarden } from '../../services/bitwarden';
import { logger } from '../../utils/logger';

function isGuildMember(member: any): member is GuildMember {
  return member && typeof member === 'object' && 'displayName' in member;
}

export const data = new SlashCommandBuilder()
  .setName('invite')
  .setDescription('Invite someone to the password manager')
  .addSubcommand(subcommand =>
    subcommand
      .setName('vault')
      .setDescription('Invite user to password manager')
      .addStringOption(option =>
        option
          .setName('email')
          .setDescription('Email address to invite')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() !== 'vault') return;
  
  const email = interaction.options.getString('email', true);
  const discordUsername = interaction.user.username;
  
  // Safely get display name with type checking
  const discordDisplayName = (() => {
    if (isGuildMember(interaction.member)) {
      return interaction.member.displayName;
    }
    return interaction.user.displayName || interaction.user.globalName || discordUsername;
  })();

  logger.info(`Password manager access requested by ${discordUsername} (${discordDisplayName}) for email: ${email}`);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('Invalid Email')
      .setDescription('Please provide a valid email address. Contact the projects team if you need help.')
      .setColor(0xFF0000)
      .setTimestamp();

    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    return;
  }

  // Defer reply as this might take a while
  await interaction.deferReply({ ephemeral: true });

  try {
    const userInfo = await lookupUserTeam(email);
    
    if (!userInfo) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('Email Not Found')
        .setDescription(`Email "${email}" not found in team directory. Check the email or contact the projects team for help.`)
        .setColor(0xFF6B35)
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed] });
      return;
    }

    const inviteResult = await inviteUserToVaultwarden(email, {
      ...userInfo,
      discordUsername
    });

    if (inviteResult.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('Invitation Sent')
        .setDescription(`Invitation sent to ${email}. Check email and visit [vault.monashcoding.com](https://vault.monashcoding.com) to complete setup.`)
        .setColor(0x00B894)
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
      logger.info(`Successfully invited ${email} (${userInfo.name} from ${userInfo.team})`);

    } else {
      let errorTitle = 'Invitation Failed';
      let errorDescription = 'Something went wrong. Contact the projects team for help.';

      if (inviteResult.error?.includes('already')) {
        errorTitle = 'Already Invited';
        errorDescription = `${email} already invited. Check email or visit [vault.monashcoding.com](https://vault.monashcoding.com).`;
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle(errorTitle)
        .setDescription(errorDescription)
        .setColor(0xFF0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
      logger.error(`Failed to invite ${email}: ${inviteResult.error}`);
    }

  } catch (error) {
    logger.error('Error in request-vault command:', error);

    const crashEmbed = new EmbedBuilder()
      .setTitle('Something Went Wrong')
      .setDescription('An unexpected error occurred. Contact the projects team for help.')
      .setColor(0xFF0000)
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [crashEmbed] });
    } catch (replyError) {
      logger.error('Failed to send error message to user:', replyError);
    }
  }
}
