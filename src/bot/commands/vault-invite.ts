import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember } from 'discord.js';
import { lookupUserTeam, UserInfo } from '../../services/notion';
import { inviteUserToVaultwarden, getUserByEmail, reinviteUser, getCollectionNamesForRole } from '../../services/bitwarden';
import { logger } from '../../utils/logger';
import { mapErrorToUserMessage, createErrorDescription } from '../../utils/errors';

function isGuildMember(member: any): member is GuildMember {
  return member && typeof member === 'object' && 'displayName' in member;
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
        .setDescription(`Email "${email}" not found in team directory. The email must match the personal email in the team directory.`)
        .setColor(0xFF6B35)
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed] });
      return;
    }

    // Check if user already exists in the organization
    const existingUser = await getUserByEmail(email);
    
    if (existingUser) {
      // User exists - check their status
      if (existingUser.status === 2) {
        // User is already confirmed
        const alreadyConfirmedEmbed = new EmbedBuilder()
          .setTitle('Already Confirmed')
          .setDescription(`${existingUser.name} is already confirmed and can access the vault at [vault.monashcoding.com](https://vault.monashcoding.com).`)
          .setColor(0x00B894)
          .setTimestamp();

        await interaction.editReply({ embeds: [alreadyConfirmedEmbed] });
        return;
      } else if (existingUser.status === 0 || existingUser.status === 1) {
        // User is invited (status 0) or accepted (status 1) - resend invitation
        logger.info(`User ${email} already exists with status ${existingUser.status}, resending invitation`);
        
        const reinviteResult = await reinviteUser(existingUser.id);
        
        if (reinviteResult.success) {
          const collectionNames = getCollectionNamesForRole(userInfo.role || userInfo.team || 'default');
          const collectionsText = collectionNames.length > 0 ? `${collectionNames.join(', ')}` : '';
          
          const reinviteSuccessEmbed = new EmbedBuilder()
            .setTitle('Invitation Resent')
            .setDescription(
              `Invitation sent to **${email}** with access to: ${collectionsText}.\n\n` +
              `**Once you have created your account, you must run \`/confirm vault [email]\` to see the passwords!**`
            )
            .setColor(0x00B894)
            .setTimestamp();

          await interaction.editReply({ embeds: [reinviteSuccessEmbed] });
          logger.info(`Successfully resent invitation to ${email} (${existingUser.name})`);
          return;
        } else {
          // Reinvite failed, show error
          const errorMapping = mapErrorToUserMessage(reinviteResult.error || '');
          const { title: errorTitle, description: errorDescription } = errorMapping;

          const errorEmbed = new EmbedBuilder()
            .setTitle(errorTitle)
            .setDescription(errorDescription)
            .setColor(0xFF0000)
            .setTimestamp();

          await interaction.editReply({ embeds: [errorEmbed] });
          logger.error(`Failed to resend invitation to ${email}: ${reinviteResult.error}`);
          return;
        }
      }
    }

    // User doesn't exist or has an unexpected status - send new invitation
    const inviteResult = await inviteUserToVaultwarden(email, {
      ...userInfo,
      discordUsername
    });

    if (inviteResult.success) {
      const collectionNames = getCollectionNamesForRole(userInfo.role || userInfo.team || 'default');
      const collectionsText = collectionNames.length > 0 ? `${collectionNames.join(', ')}` : '';
      
      const successEmbed = new EmbedBuilder()
        .setTitle('Invitation Sent')
        .setDescription(
          `Invitation sent to **${email}** with access to: ${collectionsText}.\n\n` +
          `**Once you have created your account, you must run \`/confirm vault [email]\` to see the passwords!**`
        )
        .setColor(0x00B894)
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
      logger.info(`Successfully invited ${email} (${userInfo.name} from ${userInfo.team})`);

    } else {
      const errorMapping = mapErrorToUserMessage(inviteResult.error || '');
      const { title: errorTitle, description: errorDescription } = errorMapping;

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

    const errorDescription = createErrorDescription(error);

    const crashEmbed = new EmbedBuilder()
      .setTitle('Something Went Wrong')
      .setDescription(errorDescription)
      .setColor(0xFF0000)
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [crashEmbed] });
    } catch (replyError) {
      logger.error('Failed to send error message to user:', replyError);
    }
  }
}
