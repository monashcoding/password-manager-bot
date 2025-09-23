import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember } from 'discord.js';
import { getUserByEmail, getUserPublicKey, confirmUserMembership } from '../../services/bitwarden';
import { logger } from '../../utils/logger';

/**
 * Type guard to check if member is a GuildMember (not API version)
 */
function isGuildMember(member: any): member is GuildMember {
  return member && typeof member === 'object' && 'displayName' in member;
}

export const data = new SlashCommandBuilder()
  .setName('confirm-membership')
  .setDescription('Confirm a user\'s membership in the password manager')
  .addStringOption(option =>
    option
      .setName('email')
      .setDescription('Email address of the user to confirm')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
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

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Invalid Email')
      .setDescription('Please provide a valid email address.')
      .setColor(0xFF0000)
      .setTimestamp();

    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    return;
  }

  // Defer reply as this might take a while
  await interaction.deferReply({ ephemeral: true });

  try {
    // Step 1: Find the user by email
    logger.info(`Looking up user with email: ${email}...`);
    
    const user = await getUserByEmail(email);
    
    if (!user) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('❌ User Not Found')
        .setDescription([
          `No user found with email "${email}" in the organization.`,
          '',
          '**Possible reasons:**',
          '• The email address is not registered in the password manager',
          '• The user hasn\'t been invited yet',
          '• The email address was entered incorrectly',
          '',
          '**What to do:**',
          '1. Double-check the email address',
          '2. Use the `/request-vault` command to invite them first',
          '3. Verify the email matches exactly what\'s in the system'
        ].join('\n'))
        .setColor(0xFF6B35)
        .addFields([
          {
            name: '📧 Email Searched',
            value: email,
            inline: true
          },
          {
            name: '👮 Admin',
            value: `${adminDisplayName} (@${adminUsername})`,
            inline: true
          }
        ])
        .setFooter({ text: 'User must be invited before they can be confirmed' })
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed] });
      return;
    }

    logger.info(`Found user: ${user.name} (${user.email}) - Status: ${user.status}, ID: ${user.id}, UserID: ${user.userId}`);

    // Step 2: Check user status
    if (user.status === 2) {
      const alreadyConfirmedEmbed = new EmbedBuilder()
        .setTitle('ℹ️ User Already Confirmed')
        .setDescription([
          `User "${user.name}" with email "${user.email}" is already confirmed.`,
          '',
          '**Current Status:** Confirmed and Active',
          '**User Status Code:** 2 (Confirmed)',
          '',
          'No further action is needed.'
        ].join('\n'))
        .setColor(0x00B894)
        .addFields([
          {
            name: '👤 User',
            value: user.name,
            inline: true
          },
          {
            name: '📧 Email',
            value: user.email,
            inline: true
          },
          {
            name: '🔐 2FA Enabled',
            value: user.twoFactorEnabled ? 'Yes' : 'No',
            inline: true
          },
          {
            name: '👮 Admin',
            value: `${adminDisplayName} (@${adminUsername})`,
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [alreadyConfirmedEmbed] });
      return;
    }

    // Step 3: Get user's public key (for verification)
    logger.info(`Getting public key for user ID: ${user.userId}...`);
    
    const publicKeyData = await getUserPublicKey(user.userId);
    
    if (!publicKeyData) {
      const noKeyEmbed = new EmbedBuilder()
        .setTitle('⚠️ Public Key Not Available')
        .setDescription([
          `User "${user.name}" was found but their public key is not available.`,
          '',
          '**This usually means:**',
          '• The user hasn\'t completed their account setup',
          '• The user hasn\'t logged in and generated keys yet',
          '• There might be a technical issue',
          '',
          '**Recommendation:**',
          'Ask the user to log in to the password manager first, then try confirming again.'
        ].join('\n'))
        .setColor(0xFF6B35)
        .addFields([
          {
            name: '👤 User',
            value: user.name,
            inline: true
          },
          {
            name: '📧 Email',
            value: user.email,
            inline: true
          },
          {
            name: '📊 Status',
            value: `${user.status} (${getStatusText(user.status)})`,
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [noKeyEmbed] });
      return;
    }

    logger.info(`Retrieved public key for user: ${user.userId}`);

    // Step 4: Confirm the user's membership
    logger.info(`Confirming membership for organization user ID: ${user.id}...`);
    
    const confirmResult = await confirmUserMembership(user.id, user.userId);

    // Step 5: Respond based on result
    if (confirmResult.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Membership Confirmed Successfully!')
        .setDescription([
          `User "${user.name}" has been successfully confirmed in the password manager.`,
          '',
          '**What this means:**',
          '• The user now has full access to their assigned collections',
          '• They can log in and start using the password manager',
          '• Their account is fully activated',
          '',
          '**Next steps for the user:**',
          '1. Log in to [vault.monashcoding.com](https://vault.monashcoding.com)',
          '2. Download the Bitwarden app on their devices',
          '3. Start using the password manager securely'
        ].join('\n'))
        .setColor(0x00B894)
        .addFields([
          {
            name: '👤 Confirmed User',
            value: user.name,
            inline: true
          },
          {
            name: '📧 Email',
            value: user.email,
            inline: true
          },
          {
            name: '🔐 2FA Enabled',
            value: user.twoFactorEnabled ? 'Yes' : 'No',
            inline: true
          },
          {
            name: '👮 Confirmed By',
            value: `${adminDisplayName} (@${adminUsername})`,
            inline: true
          },
          {
            name: '🏢 Organization ID',
            value: user.id,
            inline: true
          },
          {
            name: '🆔 User ID',
            value: user.userId,
            inline: true
          }
        ])
        .setFooter({ 
          text: 'User confirmation completed successfully! 🎉',
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
      
      // Log success for admin monitoring
      logger.info(`✅ Successfully confirmed membership for ${email} (${user.name}) by admin ${adminUsername}`);

    } else {
      // Handle confirmation failure
      let errorTitle = '❌ Confirmation Failed';
      let errorDescription = 'Something went wrong while confirming the user\'s membership.';
      let color = 0xFF0000;

      if (confirmResult.error?.includes('already confirmed') || confirmResult.error?.includes('404')) {
        errorTitle = '⚠️ User Already Confirmed or Not Found';
        errorDescription = [
          'The user might already be confirmed or there was an issue finding them.',
          '',
          '**Possible reasons:**',
          '• User was already confirmed by someone else',
          '• User ID changed or became invalid',
          '• Temporary server issue',
          '',
          'Try checking the user\'s current status or contact technical support.'
        ].join('\n');
        color = 0xFF6B35;
      } else if (confirmResult.error?.includes('authentication')) {
        errorDescription = [
          'There was an authentication issue with the password manager API.',
          '',
          'This has been logged and will be investigated.',
          'Please try again later or contact technical support.'
        ].join('\n');
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle(errorTitle)
        .setDescription(errorDescription)
        .setColor(color)
        .addFields([
          {
            name: '👤 Target User',
            value: user.name,
            inline: true
          },
          {
            name: '📧 Email',
            value: user.email,
            inline: true
          },
          {
            name: '👮 Admin',
            value: `${adminDisplayName} (@${adminUsername})`,
            inline: true
          },
          {
            name: '🛠️ Error Details',
            value: confirmResult.error || 'Unknown error',
            inline: false
          }
        ])
        .setFooter({ text: 'Contact technical support if this problem persists' })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
      
      // Log error for admin attention
      logger.error(`❌ Failed to confirm membership for ${email}: ${confirmResult.error}`);
    }

  } catch (error) {
    logger.error('Error in confirm-membership command:', error);

    const crashEmbed = new EmbedBuilder()
      .setTitle('💥 Something Went Wrong')
      .setDescription([
        'An unexpected error occurred while processing the membership confirmation.',
        '',
        'This has been logged and will be investigated.',
        'Please try again later or contact technical support.',
        '',
        '**Error ID:** `' + Date.now().toString(36) + '`'
      ].join('\n'))
      .setColor(0xFF0000)
      .addFields([
        {
          name: '📧 Target Email',
          value: email,
          inline: true
        },
        {
          name: '👮 Admin',
          value: `${adminDisplayName} (@${adminUsername})`,
          inline: true
        }
      ])
      .setFooter({ text: 'Please report this error to technical support' })
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [crashEmbed] });
    } catch (replyError) {
      logger.error('Failed to send error message to admin:', replyError);
    }
  }
}

/**
 * Helper function to convert status code to human-readable text
 */
function getStatusText(status: number): string {
  switch (status) {
    case 0: return 'Invited';
    case 1: return 'Accepted';
    case 2: return 'Confirmed';
    case -1: return 'Revoked';
    default: return 'Unknown';
  }
}
