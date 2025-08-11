import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember } from 'discord.js';
import { lookupUserTeam, UserInfo } from '../../services/notion';
import { inviteUserToVaultwarden } from '../../services/bitwarden';
import { logger } from '../../utils/logger';

/**
 * Type guard to check if member is a GuildMember (not API version)
 */
function isGuildMember(member: any): member is GuildMember {
  return member && typeof member === 'object' && 'displayName' in member;
}

export const data = new SlashCommandBuilder()
  .setName('request-vault')
  .setDescription('Request access to the team password manager')
  .addStringOption(option =>
    option
      .setName('email')
      .setDescription('Your personal email address')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
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
    // Step 1: Look up user information in Notion directory by email
    logger.info(`Looking up user information for email: ${email}...`);
    
    const userInfo = await lookupUserTeam(email);
    
    if (!userInfo) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('❌ Email Not Found in Directory')
        .setDescription([
          `Sorry, I couldn't find the email "${email}" in our team directory.`,
          '',
          '**Possible reasons:**',
          '• The email address is not registered in our team directory',
          '• You may have used a different email address',
          '• You haven\'t been added to the team directory yet',
          '',
          '**What to do:**',
          '1. Double-check the email address you entered',
          '2. Try using your work/official email address if different',
          '3. Contact an admin to be added to the team directory',
          '4. Verify the email matches exactly what\'s in our records'
        ].join('\n'))
        .setColor(0xFF6B35)
        .addFields([
          {
            name: '📧 Email Searched',
            value: email,
            inline: true
          },
          {
            name: '👤 Discord User', 
            value: `${discordDisplayName} (@${discordUsername})`,
            inline: true
          }
        ])
        .setFooter({ text: 'Need help? Contact an admin with your correct email address' })
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed] });
      return;
    }

    logger.info(`Found user: ${userInfo.name} from team ${userInfo.team} for email ${email}`);

    // Step 2: Send invitation to Vaultwarden
    logger.info(`Sending Vaultwarden invitation to ${email}...`);
    
    const inviteResult = await inviteUserToVaultwarden(email, {
      ...userInfo,
      discordUsername
    });

    // Step 3: Respond based on result
    if (inviteResult.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Password Manager Access Granted!')
        .setDescription([
          `Great news! I've successfully sent you an invitation to our team password manager.`,
          '',
          '**What happens next:**',
          '1. 📧 Check your email at `' + email + '`',
          '2. 📬 Look for an invitation email from Vaultwarden',
          '3. 🔗 Click the invitation link to set up your account',
          '4. 🔐 Create a strong master password',
          '5. 📱 Download the Bitwarden app on your devices',
          '',
          '**Important notes:**',
          '• The invitation email might take a few minutes to arrive',
          '• Check your spam/junk folder if you don\'t see it',
          '• Your master password cannot be recovered - write it down safely!'
        ].join('\n'))
        .setColor(0x00B894)
        .addFields([
          {
            name: '👤 Team Member',
            value: userInfo.name,
            inline: true
          },
          {
            name: '🏢 Team',
            value: userInfo.team,
            inline: true
          },
          {
            name: '📧 Email',
            value: email,
            inline: true
          },
          {
            name: '🌐 Vault URL',
            value: '[vault.monashcoding.com](https://vault.monashcoding.com)',
            inline: false
          }
        ])
        .setFooter({ 
          text: 'Welcome to secure password management! 🔒',
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
      
      // Log success for admin monitoring
      logger.info(`✅ Successfully invited ${email} (${userInfo.name} from ${userInfo.team})`);

    } else {
      // Handle specific error cases
      let errorTitle = '❌ Invitation Failed';
      let errorDescription = 'Something went wrong while sending your invitation.';
      let color = 0xFF0000;

      if (inviteResult.error?.includes('already')) {
        errorTitle = '⚠️ Already Invited';
        errorDescription = [
          `It looks like ${email} has already been invited to our password manager!`,
          '',
          '**What to do:**',
          '1. 📧 Check your email for the original invitation',
          '2. 🔍 Look in your spam/junk folder',
          '3. 🌐 Try logging in directly at [vault.monashcoding.com](https://vault.monashcoding.com)',
          '',
          'If you still can\'t access your account, contact an admin for help.'
        ].join('\n');
        color = 0xFF6B35;
      } else if (inviteResult.error?.includes('authentication')) {
        errorDescription = [
          'There was an authentication issue with our password manager.',
          '',
          'This has been logged and an admin will investigate.',
          'Please try again later or contact an admin.'
        ].join('\n');
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle(errorTitle)
        .setDescription(errorDescription)
        .setColor(color)
        .addFields([
          {
            name: '🛠️ Error Details',
            value: inviteResult.error || 'Unknown error',
            inline: false
          },
          {
            name: '📧 Requested Email',
            value: email,
            inline: true
          },
          {
            name: '👤 Discord User',
            value: `${discordDisplayName} (@${discordUsername})`,
            inline: true
          }
        ])
        .setFooter({ text: 'Contact an admin if this problem persists' })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
      
      // Log error for admin attention
      logger.error(`❌ Failed to invite ${email}: ${inviteResult.error}`);
    }

  } catch (error) {
    logger.error('Error in request-vault command:', error);

    const crashEmbed = new EmbedBuilder()
      .setTitle('💥 Something Went Wrong')
      .setDescription([
        'An unexpected error occurred while processing your request.',
        '',
        'This has been logged and will be investigated.',
        'Please try again later or contact an admin.',
        '',
        '**Error ID:** `' + Date.now().toString(36) + '`'
      ].join('\n'))
      .setColor(0xFF0000)
      .addFields([
        {
          name: '📧 Requested Email',
          value: email,
          inline: true
        },
        {
          name: '👤 Discord User',
          value: `${discordDisplayName} (@${discordUsername})`,
          inline: true
        }
      ])
      .setFooter({ text: 'Please report this error to an admin' })
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [crashEmbed] });
    } catch (replyError) {
      logger.error('Failed to send error message to user:', replyError);
    }
  }
}

// Additional helper function for admin commands
export async function handleAdminRequestVault(
  interaction: ChatInputCommandInteraction,
  targetEmail: string,
  targetUser?: string
) {
  const adminUsername = interaction.user.username;
  
  logger.info(`Admin ${adminUsername} manually inviting ${targetEmail} for user ${targetUser || 'unknown'}`);

  try {
    await interaction.deferReply({ ephemeral: true });

    // Try to look up the actual user first, or create proper UserInfo object
    let userInfo: UserInfo;
    
    if (targetUser) {
      // Create proper UserInfo object for admin invitations
      userInfo = {
        name: targetUser,
        email: targetEmail, // Include the email property
        team: 'Admin Invited',
        discordUsername: 'admin-invite'
      };
    } else {
      // Try to look up the user by email
      const foundUser = await lookupUserTeam(targetEmail);
      if (foundUser) {
        userInfo = foundUser;
      } else {
        // Create fallback UserInfo object
        userInfo = {
          name: 'Unknown User',
          email: targetEmail, // Include the email property
          team: 'Admin Invited',
          discordUsername: 'admin-invite'
        };
      }
    }

    const inviteResult = await inviteUserToVaultwarden(targetEmail, userInfo);

    if (inviteResult.success) {
      const adminSuccessEmbed = new EmbedBuilder()
        .setTitle('✅ Admin Invitation Sent')
        .setDescription(`Successfully sent password manager invitation to ${targetEmail}`)
        .setColor(0x00B894)
        .addFields([
          {
            name: '📧 Email',
            value: targetEmail,
            inline: true
          },
          {
            name: '👤 Target User',
            value: userInfo.name,
            inline: true
          },
          {
            name: '🏢 Team',
            value: userInfo.team,
            inline: true
          },
          {
            name: '👮 Admin',
            value: adminUsername,
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [adminSuccessEmbed] });
      logger.info(`✅ Admin invitation successful: ${targetEmail}`);

    } else {
      const adminErrorEmbed = new EmbedBuilder()
        .setTitle('❌ Admin Invitation Failed')
        .setDescription(`Failed to invite ${targetEmail}: ${inviteResult.error}`)
        .setColor(0xFF0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [adminErrorEmbed] });
      logger.error(`❌ Admin invitation failed: ${inviteResult.error}`);
    }

  } catch (error) {
    logger.error('Error in admin request-vault:', error);
    
    const adminCrashEmbed = new EmbedBuilder()
      .setTitle('💥 Admin Command Error')
      .setDescription(`Unexpected error in admin invitation: ${error}`)
      .setColor(0xFF0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [adminCrashEmbed] });
  }
}